import fs from 'node:fs/promises';
import path from 'node:path';
import { getAssetFilename, getDateFolderName } from './assetUtils.js';

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

export function sanitizeFilename(filename, fallbackName = 'asset') {
  const rawName = String(filename || '').replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
  let safeName = (rawName || fallbackName)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  safeName = safeName.replace(/[ .]+$/g, '');

  if (!safeName) {
    safeName = fallbackName;
  }

  const ext = path.extname(safeName);
  const stem = ext ? safeName.slice(0, -ext.length) : safeName;

  if (WINDOWS_RESERVED_NAMES.has(stem.toUpperCase())) {
    safeName = `_${safeName}`;
  }

  if (safeName.length > 240) {
    const extension = path.extname(safeName);
    const base = extension ? safeName.slice(0, -extension.length) : safeName;
    safeName = `${base.slice(0, 240 - extension.length)}${extension}`;
  }

  return safeName;
}

export function resolveInside(root, ...segments) {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(rootPath, ...segments);
  const relative = path.relative(rootPath, targetPath);

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return targetPath;
  }

  throw new Error(`Refusing to write outside destination: ${targetPath}`);
}

export async function ensureExistingDirectory(directoryPath) {
  const stats = await fs.stat(directoryPath);
  if (!stats.isDirectory()) {
    throw new Error(`Destination is not a folder: ${directoryPath}`);
  }
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function prepareDownloadPath(destinationRoot, asset, options = {}) {
  const dateFolder = getDateFolderName(asset);
  const fileName = options.fileName
    ? sanitizeFilename(options.fileName, `${asset.id || 'asset'}`)
    : sanitizeFilename(getAssetFilename(asset), `${asset.id || 'asset'}`);
  const directoryPath = resolveInside(destinationRoot, dateFolder);
  const filePath = resolveInside(directoryPath, fileName);

  return { dateFolder, fileName, directoryPath, filePath };
}

export function buildConflictFilename(filename, assetId, conflictIndex = 1) {
  const safeFilename = sanitizeFilename(filename);
  const extension = path.extname(safeFilename);
  const stem = extension ? safeFilename.slice(0, -extension.length) : safeFilename;
  const suffix = sanitizeConflictSuffix(assetId);
  const counter = conflictIndex > 1 ? `-${conflictIndex}` : '';

  return sanitizeFilename(`${stem}.${suffix}${counter}${extension}`);
}

function sanitizeConflictSuffix(value) {
  const suffix = sanitizeFilename(value || 'asset', 'asset')
    .replace(/\.+/g, '_')
    .slice(0, 12)
    .replace(/[ .]+$/g, '');

  return suffix || 'asset';
}
