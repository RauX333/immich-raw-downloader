import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  initDownloadHistory,
  recordDownload,
  isAssetDownloaded,
  filterDownloadedAssets,
  clearProfileHistory,
  getHistoryCount,
  saveAndCloseDownloadHistory,
  resolveDbPath,
  DownloadHistoryError,
} from '../src/downloadHistory.js';

const WASM_PATH = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm');

async function createTestDb() {
  const tmpDir = await fs.mkdtemp('/tmp/download-history-test-');
  const dbPath = path.join(tmpDir, 'test.db');
  const historyDb = await initDownloadHistory(dbPath, { wasmPath: WASM_PATH });
  return { historyDb, dbPath, tmpDir };
}

async function cleanupTestDb({ historyDb, tmpDir }) {
  try {
    await saveAndCloseDownloadHistory(historyDb);
  } catch {
    // already closed
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
}

describe('initDownloadHistory', () => {
  it('creates a new database', async () => {
    const { historyDb, tmpDir } = await createTestDb();
    assert.ok(historyDb.db);
    assert.ok(historyDb.SQL);
    await cleanupTestDb({ historyDb, tmpDir });
  });

  it('creates the directory if missing', async () => {
    const tmpDir = await fs.mkdtemp('/tmp/download-history-test-');
    const nestedPath = path.join(tmpDir, 'nested', 'dir', 'test.db');
    const historyDb = await initDownloadHistory(nestedPath, { wasmPath: WASM_PATH });
    assert.ok(historyDb.db);
    await saveAndCloseDownloadHistory(historyDb);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('opens an existing database', async () => {
    const { historyDb, dbPath, tmpDir } = await createTestDb();
    recordDownload(historyDb, { profileId: 'p1', assetId: 'a1' });
    await saveAndCloseDownloadHistory(historyDb);

    const reopened = await initDownloadHistory(dbPath, { wasmPath: WASM_PATH });
    assert.equal(getHistoryCount(reopened, 'p1'), 1);
    await saveAndCloseDownloadHistory(reopened);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

describe('recordDownload', () => {
  it('records a download', async () => {
    const ctx = await createTestDb();
    recordDownload(ctx.historyDb, {
      profileId: 'profile-1',
      assetId: 'asset-1',
      sourceAssetId: 'source-1',
      filename: 'photo.NEF',
      downloadMode: 'raw',
      fileSize: 1000,
    });
    assert.equal(getHistoryCount(ctx.historyDb, 'profile-1'), 1);
    await cleanupTestDb(ctx);
  });

  it('updates on duplicate (same profile + asset)', async () => {
    const ctx = await createTestDb();
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a1', filename: 'old.NEF' });
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a1', filename: 'new.NEF' });
    assert.equal(getHistoryCount(ctx.historyDb, 'p1'), 1);
    await cleanupTestDb(ctx);
  });

  it('allows same asset in different profiles', async () => {
    const ctx = await createTestDb();
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a1' });
    recordDownload(ctx.historyDb, { profileId: 'p2', assetId: 'a1' });
    assert.equal(getHistoryCount(ctx.historyDb, 'p1'), 1);
    assert.equal(getHistoryCount(ctx.historyDb, 'p2'), 1);
    await cleanupTestDb(ctx);
  });
});

describe('isAssetDownloaded', () => {
  it('returns false for unknown asset', async () => {
    const ctx = await createTestDb();
    assert.equal(isAssetDownloaded(ctx.historyDb, 'p1', 'a1'), false);
    await cleanupTestDb(ctx);
  });

  it('returns true for recorded asset', async () => {
    const ctx = await createTestDb();
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a1' });
    assert.equal(isAssetDownloaded(ctx.historyDb, 'p1', 'a1'), true);
    await cleanupTestDb(ctx);
  });

  it('is profile-scoped', async () => {
    const ctx = await createTestDb();
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a1' });
    assert.equal(isAssetDownloaded(ctx.historyDb, 'p2', 'a1'), false);
    await cleanupTestDb(ctx);
  });
});

describe('filterDownloadedAssets', () => {
  it('returns empty set for empty input', async () => {
    const ctx = await createTestDb();
    const result = filterDownloadedAssets(ctx.historyDb, 'p1', []);
    assert.deepEqual(result, new Set());
    await cleanupTestDb(ctx);
  });

  it('returns only downloaded asset IDs', async () => {
    const ctx = await createTestDb();
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a1' });
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a3' });
    const result = filterDownloadedAssets(ctx.historyDb, 'p1', ['a1', 'a2', 'a3']);
    assert.deepEqual(result, new Set(['a1', 'a3']));
    await cleanupTestDb(ctx);
  });
});

describe('clearProfileHistory', () => {
  it('deletes all history for a profile', async () => {
    const ctx = await createTestDb();
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a1' });
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a2' });
    recordDownload(ctx.historyDb, { profileId: 'p2', assetId: 'a1' });
    clearProfileHistory(ctx.historyDb, 'p1');
    assert.equal(getHistoryCount(ctx.historyDb, 'p1'), 0);
    assert.equal(getHistoryCount(ctx.historyDb, 'p2'), 1);
    await cleanupTestDb(ctx);
  });
});

describe('getHistoryCount', () => {
  it('returns 0 for empty profile', async () => {
    const ctx = await createTestDb();
    assert.equal(getHistoryCount(ctx.historyDb, 'p1'), 0);
    await cleanupTestDb(ctx);
  });

  it('returns correct count', async () => {
    const ctx = await createTestDb();
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a1' });
    recordDownload(ctx.historyDb, { profileId: 'p1', assetId: 'a2' });
    assert.equal(getHistoryCount(ctx.historyDb, 'p1'), 2);
    await cleanupTestDb(ctx);
  });
});

describe('resolveDbPath', () => {
  it('places db next to .env', () => {
    const result = resolveDbPath('/home/user/project/.env');
    assert.equal(result, '/home/user/project/download-history.db');
  });

  it('handles relative paths', () => {
    const result = resolveDbPath('.env');
    assert.ok(result.endsWith('download-history.db'));
    assert.ok(!result.endsWith('/.env/download-history.db'));
  });
});
