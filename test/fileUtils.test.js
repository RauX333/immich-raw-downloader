import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  buildConflictFilename,
  prepareDownloadPath,
  resolveInside,
  sanitizeFilename,
} from '../src/fileUtils.js';
import { pathExists } from '../src/fileUtils.js';

test('sanitizes filenames for Windows, Linux, and macOS', () => {
  assert.equal(sanitizeFilename('a<b>c:d"e/f\\g|h?i*.ARW'), 'g_h_i_.ARW');
  assert.equal(sanitizeFilename('CON.CR2'), '_CON.CR2');
  assert.equal(sanitizeFilename('name. '), 'name');
  assert.equal(sanitizeFilename('文件.RAF'), '文件.RAF');
  assert.equal(sanitizeFilename('../escape.NEF'), 'escape.NEF');
  assert.equal(sanitizeFilename('', 'asset-id'), 'asset-id');
});

test('resolveInside refuses destination escape', () => {
  const root = path.resolve(os.tmpdir(), 'immich-raw-downloader-test');
  assert.equal(resolveInside(root, '2026-05-01', 'a.arw'), path.join(root, '2026-05-01', 'a.arw'));
  assert.throws(() => resolveInside(root, '..', 'outside.arw'), /outside destination/);
});

test('prepareDownloadPath builds safe date-folder target path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-'));
  const target = await prepareDownloadPath(root, {
    id: 'asset-1',
    originalFileName: '../CON.ARW',
    fileCreatedAt: '2026-05-01T00:00:00Z',
  });

  assert.equal(target.dateFolder, '2026-05-01');
  assert.equal(target.fileName, '_CON.ARW');
  assert.equal(path.relative(root, target.filePath), path.join('2026-05-01', '_CON.ARW'));
});

test('buildConflictFilename appends a short sanitized asset id before extension', () => {
  assert.equal(buildConflictFilename('DSC001.ARW', 'asset:1234567890abcdef'), 'DSC001.asset_123456.ARW');
  assert.equal(buildConflictFilename('DSC001.ARW', 'asset-id', 2), 'DSC001.asset-id-2.ARW');
});

test('pathExists reports missing and existing files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-raw-exists-'));
  const filePath = path.join(root, 'file.txt');

  assert.equal(await pathExists(filePath), false);
  await fs.writeFile(filePath, 'ok');
  assert.equal(await pathExists(filePath), true);
});
