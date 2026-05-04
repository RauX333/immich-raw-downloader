import path from 'node:path';

export { RAW_EXTENSIONS, isRawFilename, pickBestRawMatch, shouldDownloadFavoriteDirectly } from './rawMatching.js';

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

  return formatLocalDateFolder(date);
}

export function formatLocalDateFolder(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

