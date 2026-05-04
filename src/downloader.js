import { pipeline } from 'node:stream/promises';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import {
  DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
  DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
  DEFAULT_DOWNLOAD_MODE,
  DEFAULT_DOWNLOAD_SOURCE,
  DOWNLOAD_MODE_BOTH,
  DOWNLOAD_MODE_ORIGINAL,
  DOWNLOAD_SOURCE_ALBUM,
  normalizeDownloadMode,
  normalizeDownloadSource,
} from './config.js';
import { getAssetFilename } from './assetUtils.js';
import { pathExists } from './fileUtils.js';
import { createProgressStream } from './progress.js';
import { isAssetDownloaded, recordDownload as recordHistory, saveDownloadHistory } from './downloadHistory.js';
import * as log from './logger.js';

const DEFAULT_RETRY_BACKOFF_MS = 500;

export class DownloadIdleTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DownloadIdleTimeoutError';
  }
}

export async function executeDownloadPlan({
  client,
  plan,
  progressReporter = null,
  maxAttempts = DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
  downloadIdleTimeoutMs = client?.downloadIdleTimeoutMs ?? DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
  sleep = delay,
  retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
  historyDb = null,
  profileId = null,
  dryRun = false,
} = {}) {
  const summary = planToSummary(plan);
  summary.dryRunPlanned = 0;
  summary.historyWriteFailures = [];
  const attempts = normalizeMaxAttempts(maxAttempts);
  log.info('downloader', 'Starting download execution', {
    totalItems: plan.plannedDownloads.length,
    maxAttempts: attempts,
    hasHistoryDb: !!historyDb,
    profileId,
    dryRun,
  });

  for (const [index, item] of plan.plannedDownloads.entries()) {
    const assetFilename = getAssetFilename(item.asset);
    try {
      await downloadPlanItem({
        client,
        item,
        index,
        total: plan.plannedDownloads.length,
        progressReporter,
        maxAttempts: attempts,
        downloadIdleTimeoutMs,
        sleep,
        retryBackoffMs,
      });
      summary.downloaded += 1;
      log.info('downloader', 'File downloaded successfully', {
        filename: assetFilename, assetId: item.asset.id, index: index + 1, total: plan.plannedDownloads.length,
      });

      if (historyDb && profileId && !dryRun) {
        const historyRecord = {
          profileId,
          assetId: item.asset.id,
          sourceAssetId: item.sourceAsset?.id || item.favorite?.id || null,
          filename: item.target.fileName,
          downloadMode: plan.downloadMode,
          fileSize: item.sizeBytes,
        };
        log.info('downloader', 'Attempting to record history for downloaded file', {
          assetId: item.asset.id, filename: item.target.fileName,
          hasHistoryDb: !!historyDb, profileId, dryRun,
        });
        try {
          recordHistory(historyDb, historyRecord);
          await saveDownloadHistory(historyDb);
          log.info('downloader', 'History recorded and saved after successful download', {
            assetId: item.asset.id, filename: item.target.fileName,
          });
        } catch (error) {
          log.error('downloader', 'History write failed after successful download', {
            assetId: item.asset.id, filename: assetFilename,
            error: error.message, stack: error.stack,
          });
          summary.historyWriteFailures.push({
            assetId: item.asset.id,
            filename: getAssetFilename(item.asset),
            message: error.message,
          });
        }
      } else {
        log.debug('downloader', 'Skipping history recording', {
          hasHistoryDb: !!historyDb, profileId, dryRun,
        });
      }
    } catch (error) {
      log.error('downloader', 'Download failed', {
        filename: assetFilename, assetId: item.asset.id, error: error.message,
      });
      summary.failures.push({
        assetId: item.asset.id,
        filename: getAssetFilename(item.asset),
        message: error.message,
      });
    }
  }

  log.info('downloader', 'Download execution complete', {
    downloaded: summary.downloaded,
    failures: summary.failures.length,
    historyWriteFailures: summary.historyWriteFailures.length,
  });
  return summary;
}

async function downloadPlanItem({
  client,
  item,
  index,
  total,
  progressReporter,
  maxAttempts,
  downloadIdleTimeoutMs,
  sleep,
  retryBackoffMs,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await downloadPlanItemOnce({
        client,
        item,
        index,
        total,
        progressReporter,
        downloadIdleTimeoutMs,
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableDownloadError(error)) {
        throw error;
      }

      const delayMs = retryDelayMs(attempt, retryBackoffMs);
      log.warn('downloader', 'Retrying download', {
        filename: item.target.fileName, attempt, maxAttempts,
        delayMs, error: error.message,
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function downloadPlanItemOnce({
  client,
  item,
  index,
  total,
  progressReporter,
  downloadIdleTimeoutMs,
}) {
  let progressStarted = false;
  const partialPath = `${item.target.filePath}.part`;
  try {
    await fs.mkdir(item.target.directoryPath, { recursive: true });
    await fs.rm(partialPath, { force: true });
    const download = await client.downloadAsset(item.asset.id);
    const stream = download.stream || download;
    const totalBytes = download.totalBytes ?? item.sizeBytes ?? null;
    progressReporter?.startFile({
      filename: item.target.fileName,
      index: index + 1,
      total,
      totalBytes,
    });
    progressStarted = true;

    const idleTimeoutStream = createIdleTimeoutStream({
      idleTimeoutMs: downloadIdleTimeoutMs,
      filename: item.target.fileName,
    });
    const streams = [
      stream,
      ...(idleTimeoutStream ? [idleTimeoutStream] : []),
      createProgressStream({ totalBytes, reporter: progressReporter }),
      createWriteStream(partialPath, { flags: 'wx' }),
    ];

    await pipeline(...streams);

    if (await pathExists(item.target.filePath)) {
      throw new Error(`Target already exists: ${item.target.filePath}`);
    }

    await fs.rename(partialPath, item.target.filePath);
    progressReporter?.finishFile();
    progressStarted = false;
  } catch (error) {
    await fs.rm(partialPath, { force: true });
    if (progressStarted) {
      progressReporter?.failFile(error.message);
    }
    throw error;
  }
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
    skippedByHistory: plan.skippedByHistory || 0,
    dryRunPlanned: plan.plannedDownloads.length,
    downloaded: 0,
    failures: [...plan.failures],
    historyWriteFailures: [],
  };
}

function createIdleTimeoutStream({ idleTimeoutMs, filename }) {
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
    return null;
  }

  let timeout = null;
  let stream = null;
  const resetTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      stream.destroy(new DownloadIdleTimeoutError(
        `Download stalled for ${Math.round(idleTimeoutMs / 1000)} seconds: ${filename}`,
      ));
    }, idleTimeoutMs);
  };
  const clearIdleTimeout = () => clearTimeout(timeout);

  stream = new Transform({
    transform(chunk, encoding, callback) {
      resetTimeout();
      callback(null, chunk);
    },
    flush(callback) {
      clearIdleTimeout();
      callback();
    },
    destroy(error, callback) {
      clearIdleTimeout();
      callback(error);
    },
  });
  resetTimeout();

  return stream;
}

function isRetryableDownloadError(error) {
  if (!error) {
    return false;
  }

  if ([408, 429].includes(error.status) || (error.status >= 500 && error.status <= 599)) {
    return true;
  }

  if (['AbortError', 'TimeoutError', 'ImmichRequestTimeoutError', 'DownloadIdleTimeoutError'].includes(error.name)) {
    return true;
  }

  if (['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENETDOWN', 'ENETRESET', 'ECONNABORTED'].includes(error.code)) {
    return true;
  }

  return error instanceof TypeError;
}

function retryDelayMs(attempt, retryBackoffMs) {
  return Math.max(0, retryBackoffMs) * (2 ** Math.max(0, attempt - 1));
}

function normalizeMaxAttempts(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_DOWNLOAD_MAX_ATTEMPTS;
}

function delay(ms) {
  if (!ms) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
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
