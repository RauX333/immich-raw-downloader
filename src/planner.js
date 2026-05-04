import fs from 'node:fs/promises';
import {
  DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
  DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
  DEFAULT_DOWNLOAD_MODE,
  DEFAULT_DOWNLOAD_SOURCE,
  DOWNLOAD_MODE_BOTH,
  DOWNLOAD_MODE_ORIGINAL,
  DOWNLOAD_MODE_RAW,
  DOWNLOAD_SOURCE_ALBUM,
  normalizeDownloadMode,
  normalizeDownloadSource,
} from './config.js';
import {
  getAssetSizeBytes,
  getAssetFilename,
  getCaptureDate,
  pickBestRawMatch,
  shouldDownloadFavoriteDirectly,
} from './assetUtils.js';
import { buildConflictFilename, pathExists, prepareDownloadPath } from './fileUtils.js';
import { formatBytes } from './progress.js';
import { plainStyle } from './terminalStyle.js';
import { isAssetDownloaded } from './downloadHistory.js';
import * as log from './logger.js';
import { executeDownloadPlan, planToSummary } from './downloader.js';

const TWO_MINUTES_MS = 2 * 60 * 1000;
const DEFAULT_RETRY_BACKOFF_MS = 500;

export function getSearchWindow(asset, toleranceMs = TWO_MINUTES_MS) {
  const date = getCaptureDate(asset);
  if (!date) {
    return null;
  }

  return {
    takenAfter: new Date(date.getTime() - toleranceMs).toISOString(),
    takenBefore: new Date(date.getTime() + toleranceMs).toISOString(),
  };
}

export async function chooseDownloadAsset(client, sourceAsset, options = {}) {
  if (normalizeDownloadMode(options.downloadMode) === DOWNLOAD_MODE_ORIGINAL) {
    return {
      asset: sourceAsset,
      reason: 'original-selected',
    };
  }

  if (shouldDownloadFavoriteDirectly(sourceAsset)) {
    return {
      asset: sourceAsset,
      reason: 'source-is-raw',
    };
  }

  const window = getSearchWindow(sourceAsset, options.toleranceMs);
  if (!window) {
    return {
      asset: sourceAsset,
      reason: 'missing-capture-date',
    };
  }

  const candidates = await client.searchRawCandidates({
    ...window,
  });
  const match = pickBestRawMatch(sourceAsset, candidates, options);

  return match
    ? { asset: match, reason: 'raw-match' }
    : { asset: sourceAsset, reason: 'no-raw-match' };
}

export async function chooseDownloadAssets(client, sourceAsset, options = {}) {
  const mode = normalizeDownloadMode(options.downloadMode);
  if (mode !== DOWNLOAD_MODE_BOTH) {
    return [await chooseDownloadAsset(client, sourceAsset, { ...options, downloadMode: mode })];
  }

  const choices = [
    {
      asset: sourceAsset,
      reason: 'original-selected',
    },
  ];
  const rawChoice = await chooseDownloadAsset(client, sourceAsset, {
    ...options,
    downloadMode: DOWNLOAD_MODE_RAW,
  });

  if (rawChoice.asset.id !== sourceAsset.id) {
    choices.push(rawChoice);
  } else if (rawChoice.reason !== 'no-raw-match') {
    choices[0] = rawChoice;
  }

  return choices;
}

export async function downloadFavorites({
  client,
  destination,
  dryRun = false,
  verbose = false,
  downloadSource = DEFAULT_DOWNLOAD_SOURCE,
  albumId = null,
  downloadMode = DEFAULT_DOWNLOAD_MODE,
  progressReporter = null,
  maxAttempts = DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
  downloadIdleTimeoutMs = client?.downloadIdleTimeoutMs ?? DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
  sleep = delay,
  retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
}) {
  const plan = await planDownloads({
    client,
    destination,
    verbose,
    downloadSource,
    albumId,
    downloadMode,
  });
  if (dryRun) {
    return planToSummary(plan);
  }

  return executeDownloadPlan({
    client,
    plan,
    progressReporter,
    maxAttempts,
    downloadIdleTimeoutMs,
    sleep,
    retryBackoffMs,
  });
}

export async function planDownloads({
  client,
  destination,
  verbose = false,
  downloadSource = DEFAULT_DOWNLOAD_SOURCE,
  albumId = null,
  downloadMode = DEFAULT_DOWNLOAD_MODE,
  downloadOnlyNew = false,
  historyDb = null,
  profileId = null,
}) {
  const source = normalizeDownloadSource(downloadSource);
  const mode = normalizeDownloadMode(downloadMode);
  log.info('planner', 'Starting download planning', {
    source, mode, destination, downloadOnlyNew, hasHistoryDb: !!historyDb, profileId,
  });
  const sourceImages = await listSourceImages(client, { downloadSource: source, albumId });
  log.info('planner', 'Source images loaded', { count: sourceImages.length });
  const plan = {
    downloadSource: source,
    downloadMode: mode,
    albumId: source === DOWNLOAD_SOURCE_ALBUM ? albumId : null,
    sourceLabel: formatSourceLabel(source),
    modeLabel: formatModeLabel(mode),
    imagesScanned: sourceImages.length,
    favoritesScanned: sourceImages.length,
    rawMatches: 0,
    originalDownloads: 0,
    fallbackOriginals: 0,
    skippedExisting: 0,
    skippedByHistory: 0,
    plannedDownloads: [],
    totalKnownBytes: 0,
    unknownSizeFiles: 0,
    failures: [],
  };

  for (const sourceAsset of sourceImages) {
    try {
      const choices = await chooseDownloadAssets(client, sourceAsset, { downloadMode: mode });
      for (const choice of choices) {
        if (downloadOnlyNew && historyDb && profileId) {
          if (isAssetDownloaded(historyDb, profileId, choice.asset.id)) {
            plan.skippedByHistory += 1;
            log.info('planner', 'Skipped by history', {
              assetId: choice.asset.id, filename: getAssetFilename(sourceAsset),
            });
            if (verbose) {
              console.log(
                `${getAssetFilename(sourceAsset)} -> ${getAssetFilename(choice.asset)} (skipped: in history)`,
              );
            }
            continue;
          }
        }
        await addChoiceToPlan({ plan, destination, sourceAsset, choice, verbose });
      }
    } catch (error) {
      plan.failures.push({
        assetId: sourceAsset.id,
        filename: getAssetFilename(sourceAsset),
        message: error.message,
      });
    }
  }

  return plan;
}

async function addChoiceToPlan({ plan, destination, sourceAsset, choice, verbose }) {
  const downloadAsset = choice.asset;
  const isRawMatch = choice.reason === 'raw-match'
    || choice.reason === 'source-is-raw'
    || choice.reason === 'favorite-is-raw';
  const target = await resolvePlanTarget({ plan, destination, asset: downloadAsset });

  if (verbose) {
    console.log(
      `${getAssetFilename(sourceAsset)} -> ${getAssetFilename(downloadAsset)} (${choice.reason})`,
    );
  }

  if (!target) {
    plan.skippedExisting += 1;
    return;
  }

  const sizeBytes = getAssetSizeBytes(downloadAsset);
  if (sizeBytes === null) {
    plan.unknownSizeFiles += 1;
  } else {
    plan.totalKnownBytes += sizeBytes;
  }

  plan.plannedDownloads.push({
    favorite: sourceAsset,
    sourceAsset,
    asset: downloadAsset,
    target,
    reason: choice.reason,
    isRawMatch,
    sizeBytes,
  });

  if (choice.reason === 'original-selected') {
    plan.originalDownloads += 1;
  } else if (isRawMatch) {
    plan.rawMatches += 1;
  } else {
    plan.fallbackOriginals += 1;
  }
}

async function resolvePlanTarget({ plan, destination, asset }) {
  const baseTarget = await prepareDownloadPath(destination, asset);
  if (await pathExists(baseTarget.filePath)) {
    return null;
  }

  if (!hasPlannedTarget(plan, baseTarget.filePath)) {
    return baseTarget;
  }

  for (let conflictIndex = 1; conflictIndex < 1000; conflictIndex += 1) {
    const fileName = buildConflictFilename(
      baseTarget.fileName,
      asset.id || 'asset',
      conflictIndex,
    );
    const target = await prepareDownloadPath(destination, asset, { fileName });
    if (hasPlannedTarget(plan, target.filePath)) {
      continue;
    }
    if (await pathExists(target.filePath)) {
      return null;
    }

    return target;
  }

  throw new Error(`Could not find a unique filename for ${baseTarget.fileName}`);
}

function hasPlannedTarget(plan, filePath) {
  return plan.plannedDownloads.some((item) => item.target.filePath === filePath);
}

export { executeDownloadPlan, planToSummary, DownloadIdleTimeoutError } from './downloader.js';

export function formatDownloadPlan(plan, { style = plainStyle } = {}) {
  return [
    '',
    style.heading('Download plan'),
    formatPlanLine('Source', plan.sourceLabel || formatSourceLabel(plan.downloadSource), style),
    formatPlanLine('Mode', plan.modeLabel || formatModeLabel(plan.downloadMode), style),
    formatPlanLine(formatScannedLabel(plan), plan.imagesScanned ?? plan.favoritesScanned, style),
    formatPlanLine('Files to download', plan.plannedDownloads.length, style),
    formatPlanLine('Estimated size', formatPlanSize(plan), style),
    formatPlanLine('RAW matches', plan.rawMatches, style),
    formatPlanLine('Original images', plan.originalDownloads || 0, style),
    formatPlanLine('Fallback originals', plan.fallbackOriginals, style),
    formatPlanLine('Skipped existing', plan.skippedExisting, style),
    ...(plan.skippedByHistory ? [formatPlanLine('Skipped by history', plan.skippedByHistory, style)] : []),
    formatPlanLine(
      'Preflight failures',
      plan.failures.length,
      style,
      { warning: plan.failures.length > 0 },
    ),
  ].join('\n');
}

export function formatPlanSize(plan) {
  const knownSize = formatBytes(plan.totalKnownBytes);
  if (plan.unknownSizeFiles === 0) {
    return knownSize;
  }

  return `${knownSize} + ${plan.unknownSizeFiles} unknown-size file${plan.unknownSizeFiles === 1 ? '' : 's'}`;
}

export function formatSummary(summary, { dryRun = false, style = plainStyle } = {}) {
  const lines = [
    '',
    style.heading('Summary'),
    formatPlanLine(formatScannedLabel(summary), summary.imagesScanned ?? summary.favoritesScanned, style),
    formatPlanLine('RAW matches', summary.rawMatches, style),
    formatPlanLine('Original images', summary.originalDownloads || 0, style),
    formatPlanLine('Fallback originals', summary.fallbackOriginals, style),
    formatPlanLine('Skipped existing', summary.skippedExisting, style),
    ...(summary.skippedByHistory ? [formatPlanLine('Skipped by history', summary.skippedByHistory, style)] : []),
  ];

  if (dryRun) {
    lines.push(formatPlanLine('Planned downloads', summary.dryRunPlanned, style));
  } else {
    lines.push(formatPlanLine('Downloaded', summary.downloaded, style));
  }

  lines.push(formatPlanLine(
    'Failures',
    summary.failures.length,
    style,
    { warning: summary.failures.length > 0 },
  ));

  for (const failure of summary.failures) {
    lines.push(`    - ${style.error(failure.filename)} ${style.muted(`(${failure.assetId})`)}: ${failure.message}`);
  }

  if (summary.historyWriteFailures?.length > 0) {
    lines.push('');
    lines.push(style.warning(`History write failures (${summary.historyWriteFailures.length}):`));
    for (const failure of summary.historyWriteFailures) {
      lines.push(`    - ${style.warning(failure.filename)}: ${failure.message}`);
    }
    lines.push(style.muted('Downloads succeeded but history may be incomplete.'));
  }

  return lines.join('\n');
}

function formatPlanLine(label, value, style, { warning = false } = {}) {
  const formatValue = warning ? style.warning : style.value;
  return `  ${style.label(`${label}:`)} ${formatValue(String(value))}`;
}

async function listSourceImages(client, { downloadSource, albumId }) {
  if (downloadSource === DOWNLOAD_SOURCE_ALBUM) {
    return client.listAlbumImages(albumId);
  }

  return client.listFavoriteImages();
}

function formatSourceLabel(downloadSource = DEFAULT_DOWNLOAD_SOURCE) {
  return normalizeDownloadSource(downloadSource) === DOWNLOAD_SOURCE_ALBUM
    ? 'Immich album'
    : 'favorite images';
}

function formatModeLabel(downloadMode = DEFAULT_DOWNLOAD_MODE) {
  const mode = normalizeDownloadMode(downloadMode);
  if (mode === DOWNLOAD_MODE_ORIGINAL) {
    return 'original images';
  }
  if (mode === DOWNLOAD_MODE_BOTH) {
    return 'RAW versions and original images';
  }

  return 'RAW versions';
}

function formatScannedLabel(value) {
  return normalizeDownloadSource(value?.downloadSource) === DOWNLOAD_SOURCE_ALBUM
    ? 'Album images scanned'
    : 'Favorites scanned';
}

function delay(ms) {
  if (!ms) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}
