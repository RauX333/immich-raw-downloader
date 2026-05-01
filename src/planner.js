import { pipeline } from 'node:stream/promises';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
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

export async function chooseDownloadAsset(client, favorite, options = {}) {
  if (shouldDownloadFavoriteDirectly(favorite)) {
    return {
      asset: favorite,
      reason: 'favorite-is-raw',
    };
  }

  const window = getSearchWindow(favorite, options.toleranceMs);
  if (!window) {
    return {
      asset: favorite,
      reason: 'missing-capture-date',
    };
  }

  const candidates = await client.searchRawCandidates({
    ...window,
  });
  const match = pickBestRawMatch(favorite, candidates, options);

  return match
    ? { asset: match, reason: 'raw-match' }
    : { asset: favorite, reason: 'no-raw-match' };
}

export async function downloadFavorites({
  client,
  destination,
  dryRun = false,
  verbose = false,
  progressReporter = null,
}) {
  const plan = await planDownloads({ client, destination, verbose });
  if (dryRun) {
    return planToSummary(plan);
  }

  return executeDownloadPlan({ client, plan, progressReporter });
}

export async function planDownloads({
  client,
  destination,
  verbose = false,
}) {
  const favorites = await client.listFavoriteImages();
  const plan = {
    favoritesScanned: favorites.length,
    rawMatches: 0,
    fallbackOriginals: 0,
    skippedExisting: 0,
    plannedDownloads: [],
    totalKnownBytes: 0,
    unknownSizeFiles: 0,
    failures: [],
  };

  for (const favorite of favorites) {
    try {
      const choice = await chooseDownloadAsset(client, favorite);
      const downloadAsset = choice.asset;
      const isRawMatch = choice.reason === 'raw-match' || choice.reason === 'favorite-is-raw';
      const target = await prepareDownloadPath(destination, downloadAsset);
      const exists = await pathExists(target.filePath);

      if (verbose) {
        console.log(
          `${getAssetFilename(favorite)} -> ${getAssetFilename(downloadAsset)} (${choice.reason})`,
        );
      }

      if (exists) {
        plan.skippedExisting += 1;
        continue;
      }

      const sizeBytes = getAssetSizeBytes(downloadAsset);
      if (sizeBytes === null) {
        plan.unknownSizeFiles += 1;
      } else {
        plan.totalKnownBytes += sizeBytes;
      }

      plan.plannedDownloads.push({
        favorite,
        asset: downloadAsset,
        target,
        reason: choice.reason,
        isRawMatch,
        sizeBytes,
      });

      if (isRawMatch) {
        plan.rawMatches += 1;
      } else {
        plan.fallbackOriginals += 1;
      }
    } catch (error) {
      plan.failures.push({
        assetId: favorite.id,
        filename: getAssetFilename(favorite),
        message: error.message,
      });
    }
  }

  return plan;
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
    favoritesScanned: plan.favoritesScanned,
    rawMatches: plan.rawMatches,
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
    `  Files to download: ${plan.plannedDownloads.length}`,
    `  Estimated size: ${formatPlanSize(plan)}`,
    `  RAW matches: ${plan.rawMatches}`,
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
    `  Favorites scanned: ${summary.favoritesScanned}`,
    `  RAW matches: ${summary.rawMatches}`,
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
