import { pipeline } from 'node:stream/promises';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import {
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
import { pathExists, prepareDownloadPath } from './fileUtils.js';
import { createProgressStream, formatBytes } from './progress.js';

const TWO_MINUTES_MS = 2 * 60 * 1000;

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

  return executeDownloadPlan({ client, plan, progressReporter });
}

export async function planDownloads({
  client,
  destination,
  verbose = false,
  downloadSource = DEFAULT_DOWNLOAD_SOURCE,
  albumId = null,
  downloadMode = DEFAULT_DOWNLOAD_MODE,
}) {
  const source = normalizeDownloadSource(downloadSource);
  const mode = normalizeDownloadMode(downloadMode);
  const sourceImages = await listSourceImages(client, { downloadSource: source, albumId });
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
    plannedDownloads: [],
    totalKnownBytes: 0,
    unknownSizeFiles: 0,
    failures: [],
  };

  for (const sourceAsset of sourceImages) {
    try {
      const choices = await chooseDownloadAssets(client, sourceAsset, { downloadMode: mode });
      for (const choice of choices) {
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
  const target = await prepareDownloadPath(destination, downloadAsset);
  const exists = await pathExists(target.filePath);

  if (verbose) {
    console.log(
      `${getAssetFilename(sourceAsset)} -> ${getAssetFilename(downloadAsset)} (${choice.reason})`,
    );
  }

  if (exists) {
    plan.skippedExisting += 1;
    return;
  }

  if (plan.plannedDownloads.some((item) => item.target.filePath === target.filePath)) {
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

export async function executeDownloadPlan({ client, plan, progressReporter = null }) {
  const summary = planToSummary(plan);
  summary.dryRunPlanned = 0;

  for (const [index, item] of plan.plannedDownloads.entries()) {
    let progressStarted = false;
    try {
      await fs.mkdir(item.target.directoryPath, { recursive: true });
      const download = await client.downloadAsset(item.asset.id);
      const stream = download.stream || download;
      const totalBytes = download.totalBytes ?? item.sizeBytes ?? null;
      progressReporter?.startFile({
        filename: item.target.fileName,
        index: index + 1,
        total: plan.plannedDownloads.length,
        totalBytes,
      });
      progressStarted = true;
      await pipeline(
        stream,
        createProgressStream({ totalBytes, reporter: progressReporter }),
        createWriteStream(item.target.filePath, { flags: 'wx' }),
      );
      progressReporter?.finishFile();
      progressStarted = false;
      summary.downloaded += 1;
    } catch (error) {
      if (progressStarted) {
        progressReporter?.failFile(error.message);
      }
      summary.failures.push({
        assetId: item.asset.id,
        filename: getAssetFilename(item.asset),
        message: error.message,
      });
    }
  }

  return summary;
}

export function planToSummary(plan) {
  return {
    downloadSource: plan.downloadSource || DEFAULT_DOWNLOAD_SOURCE,
    downloadMode: plan.downloadMode || DEFAULT_DOWNLOAD_MODE,
    sourceLabel: plan.sourceLabel || formatSourceLabel(plan.downloadSource),
    modeLabel: plan.modeLabel || formatModeLabel(plan.downloadMode),
    imagesScanned: plan.imagesScanned ?? plan.favoritesScanned,
    favoritesScanned: plan.favoritesScanned,
    rawMatches: plan.rawMatches,
    originalDownloads: plan.originalDownloads || 0,
    fallbackOriginals: plan.fallbackOriginals,
    skippedExisting: plan.skippedExisting,
    dryRunPlanned: plan.plannedDownloads.length,
    downloaded: 0,
    failures: [...plan.failures],
  };
}

export function formatDownloadPlan(plan) {
  return [
    '',
    'Download plan',
    `  Source: ${plan.sourceLabel || formatSourceLabel(plan.downloadSource)}`,
    `  Mode: ${plan.modeLabel || formatModeLabel(plan.downloadMode)}`,
    `  ${formatScannedLabel(plan)}: ${plan.imagesScanned ?? plan.favoritesScanned}`,
    `  Files to download: ${plan.plannedDownloads.length}`,
    `  Estimated size: ${formatPlanSize(plan)}`,
    `  RAW matches: ${plan.rawMatches}`,
    `  Original images: ${plan.originalDownloads || 0}`,
    `  Fallback originals: ${plan.fallbackOriginals}`,
    `  Skipped existing: ${plan.skippedExisting}`,
    `  Preflight failures: ${plan.failures.length}`,
  ].join('\n');
}

export function formatPlanSize(plan) {
  const knownSize = formatBytes(plan.totalKnownBytes);
  if (plan.unknownSizeFiles === 0) {
    return knownSize;
  }

  return `${knownSize} + ${plan.unknownSizeFiles} unknown-size file${plan.unknownSizeFiles === 1 ? '' : 's'}`;
}

export function formatSummary(summary, { dryRun = false } = {}) {
  const lines = [
    '',
    'Summary',
    `  ${formatScannedLabel(summary)}: ${summary.imagesScanned ?? summary.favoritesScanned}`,
    `  RAW matches: ${summary.rawMatches}`,
    `  Original images: ${summary.originalDownloads || 0}`,
    `  Fallback originals: ${summary.fallbackOriginals}`,
    `  Skipped existing: ${summary.skippedExisting}`,
  ];

  if (dryRun) {
    lines.push(`  Planned downloads: ${summary.dryRunPlanned}`);
  } else {
    lines.push(`  Downloaded: ${summary.downloaded}`);
  }

  lines.push(`  Failures: ${summary.failures.length}`);

  for (const failure of summary.failures) {
    lines.push(`    - ${failure.filename} (${failure.assetId}): ${failure.message}`);
  }

  return lines.join('\n');
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
