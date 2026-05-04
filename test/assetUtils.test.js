import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAssetSizeBytes,
  getDateFolderName,
  getStem,
  formatLocalDateFolder,
  normalizeStem,
} from '../src/assetUtils.js';
import { isRawFilename, pickBestRawMatch } from '../src/rawMatching.js';

test('detects common RAW extensions case-insensitively', () => {
  assert.equal(isRawFilename('DSC001.ARW'), true);
  assert.equal(isRawFilename('IMG_0001.cr3'), true);
  assert.equal(isRawFilename('photo.jpg'), false);
});

test('extracts stems from Windows-looking and POSIX-looking paths', () => {
  assert.equal(getStem('C:\\photos\\DSC001.JPG'), 'DSC001');
  assert.equal(getStem('/photos/DSC002.jpeg'), 'DSC002');
  assert.equal(normalizeStem('Ä.RAF'), normalizeStem('ä.jpg'));
});

test('uses computer-local date folders from capture date', () => {
  const date = new Date('2026-04-30T16:05:00.000Z');
  assert.equal(
    getDateFolderName({ fileCreatedAt: '2026-04-30T16:05:00.000Z' }),
    formatLocalDateFolder(date),
  );
  assert.equal(getDateFolderName({}), 'unknown-date');
});

test('local date folder formatting follows host timezone boundaries', () => {
  const date = new Date('2026-05-01T00:30:00.000Z');
  const expected = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

  assert.equal(getDateFolderName({ fileCreatedAt: date.toISOString() }), expected);
});

test('extracts asset sizes from common Immich metadata fields', () => {
  assert.equal(getAssetSizeBytes({ exifInfo: { fileSizeInByte: '1234' } }), 1234);
  assert.equal(getAssetSizeBytes({ fileSizeInBytes: 5678 }), 5678);
  assert.equal(getAssetSizeBytes({ size: 'bad' }), null);
});

test('picks closest RAW with same basename within two minutes', () => {
  const favorite = {
    id: 'favorite',
    type: 'IMAGE',
    originalFileName: 'DSC001.JPG',
    fileCreatedAt: '2026-05-01T10:00:00.000Z',
  };

  const candidates = [
    {
      id: 'too-late',
      type: 'IMAGE',
      originalFileName: 'DSC001.ARW',
      fileCreatedAt: '2026-05-01T10:03:00.000Z',
    },
    {
      id: 'best',
      type: 'IMAGE',
      originalFileName: 'DSC001.CR3',
      fileCreatedAt: '2026-05-01T10:00:05.000Z',
    },
    {
      id: 'wrong-stem',
      type: 'IMAGE',
      originalFileName: 'DSC002.ARW',
      fileCreatedAt: '2026-05-01T10:00:00.000Z',
    },
  ];

  assert.equal(pickBestRawMatch(favorite, candidates).id, 'best');
});

test('returns null when favorite has no usable capture date', () => {
  const favorite = {
    id: 'favorite',
    type: 'IMAGE',
    originalFileName: 'DSC001.JPG',
  };

  assert.equal(pickBestRawMatch(favorite, []), null);
});
