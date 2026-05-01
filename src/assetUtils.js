import path from 'node:path';

export const RAW_EXTENSIONS = new Set([
  '.3fr',
  '.arw',
  '.cr2',
  '.cr3',
  '.dng',
  '.erf',
  '.fff',
  '.iiq',
  '.kdc',
  '.mef',
  '.mos',
  '.mrw',
  '.nef',
  '.nrw',
  '.orf',
  '.pef',
  '.raf',
  '.raw',
  '.rwl',
  '.rw2',
  '.srw',
  '.x3f',
]);

const TWO_MINUTES_MS = 2 * 60 * 1000;

export function getAssetFilename(asset) {
  return (
    asset.originalFileName ||
    asset.originalFilename ||
    asset.fileName ||
    asset.filename ||
    filenameFromPath(asset.originalPath) ||
    `${asset.id || 'asset'}`
  );
}

export function filenameFromPath(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const normalized = value.replaceAll('\\', '/');
  const filename = normalized.split('/').filter(Boolean).at(-1);
  return filename || null;
}

export function getExtension(filename) {
  return path.posix.extname(String(filename || '').trim()).toLowerCase();
}

export function getStem(filename) {
  const base = filenameFromPath(filename) || String(filename || '');
  const ext = getExtension(base);
  return ext ? base.slice(0, -ext.length) : base;
}

export function normalizeStem(filename) {
  return getStem(filename).normalize('NFC').toLocaleLowerCase();
}

export function isRawFilename(filename) {
  return RAW_EXTENSIONS.has(getExtension(filename));
}

export function isImageAsset(asset) {
  return String(asset.type || asset.assetType || '').toUpperCase() === 'IMAGE';
}

export function getCaptureDate(asset) {
  const value =
    asset.fileCreatedAt ||
    asset.localDateTime ||
    asset.exifInfo?.dateTimeOriginal ||
    asset.exifInfo?.modifyDate ||
    asset.createdAt;

  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getAssetSizeBytes(asset) {
  const value =
    asset.exifInfo?.fileSizeInByte ||
    asset.exifInfo?.fileSizeInBytes ||
    asset.fileSizeInByte ||
    asset.fileSizeInBytes ||
    asset.size;
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getDateFolderName(asset) {
  const date = getCaptureDate(asset);
  if (!date) {
    return 'unknown-date';
  }

  return date.toISOString().slice(0, 10);
}

export function pickBestRawMatch(favorite, candidates, options = {}) {
  const toleranceMs = options.toleranceMs ?? TWO_MINUTES_MS;
  const favoriteName = getAssetFilename(favorite);
  const favoriteStem = normalizeStem(favoriteName);
  const favoriteDate = getCaptureDate(favorite);

  if (!favoriteStem || !favoriteDate) {
    return null;
  }

  const matches = candidates
    .filter((candidate) => candidate.id !== favorite.id)
    .filter((candidate) => isImageAsset(candidate))
    .filter((candidate) => isRawFilename(getAssetFilename(candidate)))
    .map((candidate) => {
      const candidateName = getAssetFilename(candidate);
      const candidateDate = getCaptureDate(candidate);
      const deltaMs = candidateDate
        ? Math.abs(candidateDate.getTime() - favoriteDate.getTime())
        : Number.POSITIVE_INFINITY;

      return {
        asset: candidate,
        candidateName,
        deltaMs,
        sameStem: normalizeStem(candidateName) === favoriteStem,
      };
    })
    .filter((match) => match.sameStem && match.deltaMs <= toleranceMs)
    .sort((a, b) => {
      if (a.deltaMs !== b.deltaMs) {
        return a.deltaMs - b.deltaMs;
      }

      return String(a.asset.id || '').localeCompare(String(b.asset.id || ''));
    });

  return matches[0]?.asset || null;
}

export function shouldDownloadFavoriteDirectly(favorite) {
  return isRawFilename(getAssetFilename(favorite));
}
