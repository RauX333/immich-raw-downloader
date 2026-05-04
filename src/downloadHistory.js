import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from '../node_modules/sql.js/dist/sql-wasm.js';
import * as log from './logger.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WASM_PATH = path.resolve(moduleDir, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS download_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  source_asset_id TEXT,
  filename TEXT,
  download_mode TEXT,
  file_size INTEGER,
  downloaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(profile_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_history_profile_asset
  ON download_history(profile_id, asset_id);
`;

export async function initDownloadHistory(dbPath, { wasmPath = DEFAULT_WASM_PATH } = {}) {
  log.info('history', 'Initializing download history database', { dbPath });
  const dir = path.dirname(dbPath);
  await fs.mkdir(dir, { recursive: true });

  let SQL;
  try {
    SQL = await initSqlJs({ locateFile: () => wasmPath });
    log.debug('history', 'SQLite WASM loaded successfully');
  } catch (error) {
    log.error('history', 'Failed to initialize SQLite WASM', { wasmPath, error: error.message });
    throw new DownloadHistoryError(
      `Failed to initialize SQLite. The WASM file should be at: ${wasmPath}. `
      + 'Try deleting the download-history.db file and run again.',
      error,
    );
  }

  let buffer = null;
  try {
    buffer = await fs.readFile(dbPath);
    log.debug('history', 'Existing database file loaded', { sizeBytes: buffer.length });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      log.error('history', 'Cannot read database file', { dbPath, error: error.message });
      throw new DownloadHistoryError(
        `Cannot read download history database: ${dbPath}. `
        + 'Try deleting this file and run again.',
        error,
      );
    }
    log.debug('history', 'No existing database file, creating new one');
  }

  let db;
  try {
    db = buffer ? new SQL.Database(buffer) : new SQL.Database();
    db.run(SCHEMA);
    log.info('history', 'Database opened and schema ensured', { existing: !!buffer });
  } catch (error) {
    log.error('history', 'Database open/schema failed', { error: error.message });
    if (db) {
      db.close();
    }
    throw new DownloadHistoryError(
      `Download history database is corrupted: ${dbPath}. `
      + 'Try deleting this file and run again.',
      error,
    );
  }

  return { db, SQL, dbPath };
}

export function recordDownload(historyDb, { profileId, assetId, sourceAssetId, filename, downloadMode, fileSize }) {
  const { db } = historyDb;
  log.info('history', 'Recording download to history', {
    profileId, assetId, sourceAssetId, filename, downloadMode, fileSize,
  });
  try {
    db.run(
      `INSERT OR REPLACE INTO download_history
         (profile_id, asset_id, source_asset_id, filename, download_mode, file_size, downloaded_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [profileId, assetId, sourceAssetId || null, filename || null, downloadMode || null, fileSize || null],
    );
    log.info('history', 'Download recorded in memory', { assetId, filename });
  } catch (error) {
    log.error('history', 'Failed to record download in memory', {
      assetId, filename, error: error.message,
    });
    throw error;
  }
}

export function isAssetDownloaded(historyDb, profileId, assetId) {
  const { db } = historyDb;
  const result = db.exec(
    'SELECT 1 FROM download_history WHERE profile_id = ? AND asset_id = ? LIMIT 1',
    [profileId, assetId],
  );
  return result.length > 0 && result[0].values.length > 0;
}

export function filterDownloadedAssets(historyDb, profileId, assetIds) {
  if (!assetIds.length) {
    return new Set();
  }

  const { db } = historyDb;
  const placeholders = assetIds.map(() => '?').join(',');
  const result = db.exec(
    `SELECT asset_id FROM download_history WHERE profile_id = ? AND asset_id IN (${placeholders})`,
    [profileId, ...assetIds],
  );

  const downloaded = new Set();
  if (result.length > 0) {
    for (const row of result[0].values) {
      downloaded.add(row[0]);
    }
  }
  return downloaded;
}

export function clearProfileHistory(historyDb, profileId) {
  const { db } = historyDb;
  db.run('DELETE FROM download_history WHERE profile_id = ?', [profileId]);
}

export function getHistoryCount(historyDb, profileId) {
  const { db } = historyDb;
  const result = db.exec(
    'SELECT COUNT(*) FROM download_history WHERE profile_id = ?',
    [profileId],
  );
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  return 0;
}

export async function saveDownloadHistory(historyDb) {
  const { db, dbPath } = historyDb;
  log.info('history', 'Saving download history to disk', { dbPath });
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    await fs.writeFile(dbPath, buffer);
    log.info('history', 'Download history saved successfully', {
      dbPath, sizeBytes: buffer.length,
    });
  } catch (error) {
    log.error('history', 'Failed to save download history', {
      dbPath, error: error.message,
    });
    throw error;
  }
}

export function saveDownloadHistorySync(historyDb) {
  const { db, dbPath } = historyDb;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fsSync.writeFileSync(dbPath, buffer);
    log.info('history', 'Download history saved (sync)', { dbPath, sizeBytes: buffer.length });
  } catch (error) {
    log.error('history', 'Failed to save download history (sync)', { dbPath, error: error.message });
  }
}

export function closeDownloadHistory(historyDb) {
  const { db } = historyDb;
  log.info('history', 'Closing download history database');
  db.close();
}

export async function saveAndCloseDownloadHistory(historyDb) {
  log.info('history', 'saveAndClose called');
  try {
    await saveDownloadHistory(historyDb);
  } finally {
    closeDownloadHistory(historyDb);
  }
}

export function resolveDbPath(envPath) {
  const envDir = path.dirname(path.resolve(envPath));
  return path.join(envDir, 'download-history.db');
}

export class DownloadHistoryError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DownloadHistoryError';
    this.cause = cause;
  }
}
