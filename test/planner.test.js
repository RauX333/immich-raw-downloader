import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  chooseDownloadAsset,
  downloadFavorites,
  executeDownloadPlan,
  formatDownloadPlan,
  formatPlanSize,
  formatSummary,
  getSearchWindow,
  planDownloads,
  planToSummary,
} from '../src/planner.js';

test('getSearchWindow uses a two-minute capture window', () => {
  const window = getSearchWindow({ fileCreatedAt: '2026-05-01T10:00:00.000Z' });
  assert.deepEqual(window, {
    takenAfter: '2026-05-01T09:58:00.000Z',
    takenBefore: '2026-05-01T10:02:00.000Z',
  });
});

test('chooseDownloadAsset falls back when no RAW candidate exists', async () => {
  const favorite = {
    id: 'favorite',
    type: 'IMAGE',
    originalFileName: 'DSC001.JPG',
    fileCreatedAt: '2026-05-01T10:00:00.000Z',
  };
  const client = {
    async searchRawCandidates() {
      return [];
    },
  };

  assert.deepEqual(await chooseDownloadAsset(client, favorite), {
    asset: favorite,
    reason: 'no-raw-match',
  });
});

test('chooseDownloadAsset can skip RAW matching and select the original image', async () => {
  const favorite = {
    id: 'favorite',
    type: 'IMAGE',
    originalFileName: 'DSC001.JPG',
    fileCreatedAt: '2026-05-01T10:00:00.000Z',
  };
  const client = {
    async searchRawCandidates() {
      throw new Error('original mode should not search for RAW candidates');
    },
  };

  assert.deepEqual(await chooseDownloadAsset(client, favorite, { downloadMode: 'original' }), {
    asset: favorite,
    reason: 'original-selected',
  });
});

test('downloadFavorites supports dry-run summary without writing files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-dry-'));
  const client = {
    async listFavoriteImages() {
      return [
        {
          id: 'favorite',
          type: 'IMAGE',
          originalFileName: 'DSC001.JPG',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
      ];
    },
    async searchRawCandidates() {
      return [
        {
          id: 'raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.ARW',
          fileCreatedAt: '2026-05-01T10:00:02.000Z',
        },
      ];
    },
    async downloadAsset() {
      throw new Error('dry run should not download');
    },
  };

  const summary = await downloadFavorites({ client, destination: root, dryRun: true });

  assert.equal(summary.favoritesScanned, 1);
  assert.equal(summary.rawMatches, 1);
  assert.equal(summary.originalDownloads, 0);
  assert.equal(summary.dryRunPlanned, 1);
  assert.equal(summary.downloaded, 0);
  assert.deepEqual(await fs.readdir(root), []);
});

test('planDownloads counts files, skipped targets, and known bytes before downloading', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-plan-'));
  await fs.mkdir(path.join(root, '2026-05-01'));
  await fs.writeFile(path.join(root, '2026-05-01', 'EXISTING.ARW'), 'exists');
  const client = {
    async listFavoriteImages() {
      return [
        {
          id: 'favorite-raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.JPG',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
        {
          id: 'favorite-fallback',
          type: 'IMAGE',
          originalFileName: 'DSC002.JPG',
          fileCreatedAt: '2026-05-01T11:00:00.000Z',
          exifInfo: { fileSizeInByte: 100 },
        },
        {
          id: 'favorite-existing',
          type: 'IMAGE',
          originalFileName: 'EXISTING.JPG',
          fileCreatedAt: '2026-05-01T12:00:00.000Z',
        },
      ];
    },
    async searchRawCandidates({ takenAfter }) {
      if (takenAfter === '2026-05-01T09:58:00.000Z') {
        return [
          {
            id: 'raw',
            type: 'IMAGE',
            originalFileName: 'DSC001.ARW',
            fileCreatedAt: '2026-05-01T10:00:01.000Z',
            exifInfo: { fileSizeInByte: 200 },
          },
        ];
      }

      if (takenAfter === '2026-05-01T11:58:00.000Z') {
        return [
          {
            id: 'existing-raw',
            type: 'IMAGE',
            originalFileName: 'EXISTING.ARW',
            fileCreatedAt: '2026-05-01T12:00:00.000Z',
            exifInfo: { fileSizeInByte: 300 },
          },
        ];
      }

      return [];
    },
  };

  const plan = await planDownloads({ client, destination: root });

  assert.equal(plan.favoritesScanned, 3);
  assert.equal(plan.plannedDownloads.length, 2);
  assert.equal(plan.skippedExisting, 1);
  assert.equal(plan.rawMatches, 1);
  assert.equal(plan.originalDownloads, 0);
  assert.equal(plan.fallbackOriginals, 1);
  assert.equal(plan.totalKnownBytes, 300);
  assert.equal(plan.unknownSizeFiles, 0);
  assert.match(formatDownloadPlan(plan), /Files to download: 2/);
  assert.match(formatDownloadPlan(plan), /Estimated size: 300 B/);
});

test('planDownloads downloads original images when original mode is selected', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-original-plan-'));
  const client = {
    async listFavoriteImages() {
      return [
        {
          id: 'favorite',
          type: 'IMAGE',
          originalFileName: 'DSC001.JPG',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
          exifInfo: { fileSizeInByte: 100 },
        },
      ];
    },
    async searchRawCandidates() {
      throw new Error('original mode should not search for RAW candidates');
    },
  };

  const plan = await planDownloads({
    client,
    destination: root,
    downloadMode: 'original',
  });

  assert.equal(plan.downloadMode, 'original');
  assert.equal(plan.rawMatches, 0);
  assert.equal(plan.originalDownloads, 1);
  assert.equal(plan.fallbackOriginals, 0);
  assert.equal(plan.plannedDownloads[0].asset.id, 'favorite');
  assert.match(formatDownloadPlan(plan), /Mode: original images/);
  assert.match(formatSummary(planToSummary(plan)), /Original images: 1/);
});

test('planDownloads downloads RAW and original images when both mode is selected', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-both-plan-'));
  const client = {
    async listFavoriteImages() {
      return [
        {
          id: 'favorite',
          type: 'IMAGE',
          originalFileName: 'DSC001.JPG',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
          exifInfo: { fileSizeInByte: 100 },
        },
      ];
    },
    async searchRawCandidates() {
      return [
        {
          id: 'raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.ARW',
          fileCreatedAt: '2026-05-01T10:00:01.000Z',
          exifInfo: { fileSizeInByte: 200 },
        },
      ];
    },
  };

  const plan = await planDownloads({
    client,
    destination: root,
    downloadMode: 'both',
  });

  assert.equal(plan.downloadMode, 'both');
  assert.equal(plan.plannedDownloads.length, 2);
  assert.deepEqual(plan.plannedDownloads.map((item) => item.asset.id), ['favorite', 'raw']);
  assert.equal(plan.rawMatches, 1);
  assert.equal(plan.originalDownloads, 1);
  assert.equal(plan.fallbackOriginals, 0);
  assert.equal(plan.totalKnownBytes, 300);
  assert.match(formatDownloadPlan(plan), /Mode: RAW versions and original images/);
  assert.match(formatSummary(planToSummary(plan)), /Original images: 1/);
});

test('planDownloads avoids duplicate downloads in both mode when source is RAW', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-both-raw-plan-'));
  const client = {
    async listFavoriteImages() {
      return [
        {
          id: 'favorite-raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.ARW',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
          exifInfo: { fileSizeInByte: 200 },
        },
      ];
    },
    async searchRawCandidates() {
      throw new Error('source RAW should not search for RAW candidates');
    },
  };

  const plan = await planDownloads({
    client,
    destination: root,
    downloadMode: 'both',
  });

  assert.equal(plan.plannedDownloads.length, 1);
  assert.equal(plan.rawMatches, 1);
  assert.equal(plan.originalDownloads, 0);
  assert.equal(plan.plannedDownloads[0].asset.id, 'favorite-raw');
});

test('planDownloads appends asset id when planned downloads share a target filename', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-duplicate-plan-'));
  const client = {
    async listFavoriteImages() {
      return [
        {
          id: 'asset-one',
          type: 'IMAGE',
          originalFileName: 'DUP.JPG',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
        {
          id: 'asset-two',
          type: 'IMAGE',
          originalFileName: 'DUP.JPG',
          fileCreatedAt: '2026-05-01T10:00:30.000Z',
        },
      ];
    },
    async searchRawCandidates() {
      return [];
    },
  };

  const plan = await planDownloads({ client, destination: root });

  assert.deepEqual(plan.plannedDownloads.map((item) => item.target.fileName), [
    'DUP.JPG',
    'DUP.asset-two.JPG',
  ]);
  assert.equal(plan.skippedExisting, 0);
});

test('planDownloads can scan album images instead of favorites', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-album-plan-'));
  const client = {
    async listFavoriteImages() {
      throw new Error('favorite images should not be scanned in album mode');
    },
    async listAlbumImages(albumId) {
      assert.equal(albumId, 'album-id');
      return [
        {
          id: 'album-image',
          type: 'IMAGE',
          originalFileName: 'ALBUM001.JPG',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
          exifInfo: { fileSizeInByte: 100 },
        },
      ];
    },
    async searchRawCandidates() {
      return [];
    },
  };

  const plan = await planDownloads({
    client,
    destination: root,
    downloadSource: 'album',
    albumId: 'album-id',
  });

  assert.equal(plan.downloadSource, 'album');
  assert.equal(plan.imagesScanned, 1);
  assert.equal(plan.fallbackOriginals, 1);
  assert.match(formatDownloadPlan(plan), /Source: Immich album/);
  assert.match(formatDownloadPlan(plan), /Album images scanned: 1/);
  assert.match(formatSummary(planToSummary(plan)), /Album images scanned: 1/);
});

test('formatPlanSize includes unknown-size files', () => {
  assert.equal(formatPlanSize({ totalKnownBytes: 1024, unknownSizeFiles: 2 }), '1.00 KB + 2 unknown-size files');
});

test('executeDownloadPlan downloads only preplanned items', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-execute-'));
  const plan = {
    favoritesScanned: 1,
    rawMatches: 1,
    fallbackOriginals: 0,
    skippedExisting: 0,
    plannedDownloads: [
      {
        asset: {
          id: 'raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.ARW',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
        target: {
          fileName: 'DSC001.ARW',
          directoryPath: path.join(root, '2026-05-01'),
          filePath: path.join(root, '2026-05-01', 'DSC001.ARW'),
        },
        sizeBytes: 9,
      },
    ],
    totalKnownBytes: 9,
    unknownSizeFiles: 0,
    failures: [],
  };
  const client = {
    async downloadAsset(assetId) {
      assert.equal(assetId, 'raw');
      return {
        stream: Readable.from(['raw-bytes']),
        totalBytes: 9,
      };
    },
  };

  const summary = await executeDownloadPlan({ client, plan });
  assert.equal(summary.downloaded, 1);
  assert.equal(await fs.readFile(path.join(root, '2026-05-01', 'DSC001.ARW'), 'utf8'), 'raw-bytes');
});

test('executeDownloadPlan writes to part file before renaming on success', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-part-success-'));
  const finalPath = path.join(root, '2026-05-01', 'DSC001.ARW');
  const plan = {
    favoritesScanned: 1,
    rawMatches: 1,
    fallbackOriginals: 0,
    skippedExisting: 0,
    plannedDownloads: [
      {
        asset: {
          id: 'raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.ARW',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
        target: {
          fileName: 'DSC001.ARW',
          directoryPath: path.dirname(finalPath),
          filePath: finalPath,
        },
        sizeBytes: 9,
      },
    ],
    totalKnownBytes: 9,
    unknownSizeFiles: 0,
    failures: [],
  };
  const client = {
    async downloadAsset() {
      return Readable.from(['raw-bytes']);
    },
  };

  const summary = await executeDownloadPlan({ client, plan });

  assert.equal(summary.downloaded, 1);
  assert.equal(await fs.readFile(finalPath, 'utf8'), 'raw-bytes');
  await assert.rejects(() => fs.stat(`${finalPath}.part`), { code: 'ENOENT' });
});

test('executeDownloadPlan removes part file after failed download', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-part-fail-'));
  const finalPath = path.join(root, '2026-05-01', 'DSC001.ARW');
  const plan = {
    favoritesScanned: 1,
    rawMatches: 1,
    fallbackOriginals: 0,
    skippedExisting: 0,
    plannedDownloads: [
      {
        asset: {
          id: 'raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.ARW',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
        target: {
          fileName: 'DSC001.ARW',
          directoryPath: path.dirname(finalPath),
          filePath: finalPath,
        },
        sizeBytes: 9,
      },
    ],
    totalKnownBytes: 9,
    unknownSizeFiles: 0,
    failures: [],
  };
  const client = {
    async downloadAsset() {
      return Readable.from((async function* failAfterChunk() {
        yield 'raw';
        throw new Error('stream failed');
      })());
    },
  };

  const summary = await executeDownloadPlan({ client, plan, maxAttempts: 1 });

  assert.equal(summary.downloaded, 0);
  assert.equal(summary.failures.length, 1);
  await assert.rejects(() => fs.stat(finalPath), { code: 'ENOENT' });
  await assert.rejects(() => fs.stat(`${finalPath}.part`), { code: 'ENOENT' });
});

test('executeDownloadPlan retries transient download failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-retry-'));
  const finalPath = path.join(root, '2026-05-01', 'DSC001.ARW');
  let attempts = 0;
  const plan = {
    favoritesScanned: 1,
    rawMatches: 1,
    fallbackOriginals: 0,
    skippedExisting: 0,
    plannedDownloads: [
      {
        asset: {
          id: 'raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.ARW',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
        target: {
          fileName: 'DSC001.ARW',
          directoryPath: path.dirname(finalPath),
          filePath: finalPath,
        },
        sizeBytes: 9,
      },
    ],
    totalKnownBytes: 9,
    unknownSizeFiles: 0,
    failures: [],
  };
  const client = {
    async downloadAsset() {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error('temporary server error'), { status: 500 });
      }
      return Readable.from(['raw-bytes']);
    },
  };

  const summary = await executeDownloadPlan({
    client,
    plan,
    maxAttempts: 3,
    retryBackoffMs: 0,
    sleep: async () => {},
  });

  assert.equal(attempts, 2);
  assert.equal(summary.downloaded, 1);
  assert.equal(await fs.readFile(finalPath, 'utf8'), 'raw-bytes');
});

test('executeDownloadPlan does not retry non-transient download failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-no-retry-'));
  const finalPath = path.join(root, '2026-05-01', 'DSC001.ARW');
  let attempts = 0;
  const plan = {
    favoritesScanned: 1,
    rawMatches: 1,
    fallbackOriginals: 0,
    skippedExisting: 0,
    plannedDownloads: [
      {
        asset: {
          id: 'raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.ARW',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
        target: {
          fileName: 'DSC001.ARW',
          directoryPath: path.dirname(finalPath),
          filePath: finalPath,
        },
        sizeBytes: 9,
      },
    ],
    totalKnownBytes: 9,
    unknownSizeFiles: 0,
    failures: [],
  };
  const client = {
    async downloadAsset() {
      attempts += 1;
      throw Object.assign(new Error('not found'), { status: 404 });
    },
  };

  const summary = await executeDownloadPlan({
    client,
    plan,
    maxAttempts: 3,
    retryBackoffMs: 0,
    sleep: async () => {},
  });

  assert.equal(attempts, 1);
  assert.equal(summary.downloaded, 0);
  assert.equal(summary.failures.length, 1);
});

test('executeDownloadPlan fails stalled downloads with idle timeout', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-idle-timeout-'));
  const finalPath = path.join(root, '2026-05-01', 'DSC001.ARW');
  const plan = {
    favoritesScanned: 1,
    rawMatches: 1,
    fallbackOriginals: 0,
    skippedExisting: 0,
    plannedDownloads: [
      {
        asset: {
          id: 'raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.ARW',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
        target: {
          fileName: 'DSC001.ARW',
          directoryPath: path.dirname(finalPath),
          filePath: finalPath,
        },
        sizeBytes: 9,
      },
    ],
    totalKnownBytes: 9,
    unknownSizeFiles: 0,
    failures: [],
  };
  const client = {
    async downloadAsset() {
      return new Readable({
        read() {},
      });
    },
  };

  const summary = await executeDownloadPlan({
    client,
    plan,
    maxAttempts: 1,
    downloadIdleTimeoutMs: 5,
  });

  assert.equal(summary.downloaded, 0);
  assert.equal(summary.failures.length, 1);
  assert.match(summary.failures[0].message, /stalled/);
  await assert.rejects(() => fs.stat(`${finalPath}.part`), { code: 'ENOENT' });
});

test('planToSummary reports planned downloads for dry-run output', () => {
  const summary = planToSummary({
    favoritesScanned: 2,
    rawMatches: 1,
    fallbackOriginals: 1,
    skippedExisting: 3,
    plannedDownloads: [{}, {}],
    failures: [],
  });

  assert.equal(summary.dryRunPlanned, 2);
  assert.equal(summary.downloaded, 0);
});

test('downloadFavorites skips existing target files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-skip-'));
  await fs.mkdir(path.join(root, '2026-05-01'));
  await fs.writeFile(path.join(root, '2026-05-01', 'DSC001.ARW'), 'exists');

  const client = {
    async listFavoriteImages() {
      return [
        {
          id: 'favorite',
          type: 'IMAGE',
          originalFileName: 'DSC001.JPG',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
      ];
    },
    async searchRawCandidates() {
      return [
        {
          id: 'raw',
          type: 'IMAGE',
          originalFileName: 'DSC001.ARW',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
      ];
    },
    async downloadAsset() {
      throw new Error('existing file should not download');
    },
  };

  const summary = await downloadFavorites({ client, destination: root });
  assert.equal(summary.skippedExisting, 1);
  assert.equal(summary.downloaded, 0);
});

test('downloadFavorites downloads fallback original when no RAW match exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-download-'));
  const client = {
    async listFavoriteImages() {
      return [
        {
          id: 'favorite',
          type: 'IMAGE',
          originalFileName: 'DSC001.JPG',
          fileCreatedAt: '2026-05-01T10:00:00.000Z',
        },
      ];
    },
    async searchRawCandidates() {
      return [];
    },
    async downloadAsset(assetId) {
      assert.equal(assetId, 'favorite');
      return Readable.from(['jpg-bytes']);
    },
  };

  const summary = await downloadFavorites({ client, destination: root });
  const bytes = await fs.readFile(path.join(root, '2026-05-01', 'DSC001.JPG'), 'utf8');

  assert.equal(summary.fallbackOriginals, 1);
  assert.equal(summary.downloaded, 1);
  assert.equal(bytes, 'jpg-bytes');
});

test('formatSummary includes dry-run planned downloads', () => {
  const text = formatSummary({
    favoritesScanned: 2,
    rawMatches: 1,
    fallbackOriginals: 1,
    skippedExisting: 0,
    dryRunPlanned: 2,
    downloaded: 0,
    failures: [],
  }, { dryRun: true });

  assert.match(text, /Favorites scanned: 2/);
  assert.match(text, /Planned downloads: 2/);
});
