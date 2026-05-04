import {
  getAssetFilename,
  getCaptureDate,
  getExtension,
  isImageAsset,
  normalizeStem,
} from './assetUtils.js';

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

export function isRawFilename(filename) {
  return RAW_EXTENSIONS.has(getExtension(filename));
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
