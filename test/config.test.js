import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, readConfigFromEnv, saveConfigToEnv } from '../src/config.js';

test('reads optional download destination from environment', () => {
  assert.deepEqual(readConfigFromEnv({
    IMMICH_URL: 'http://immich.test',
    IMMICH_API_KEY: 'key',
    DOWNLOAD_DESTINATION: '/downloads',
  }), {
    immichUrl: 'http://immich.test',
    apiKey: 'key',
    downloadDestination: '/downloads',
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
  });
});

test('download destination is optional when env is missing', () => {
  assert.deepEqual(readConfigFromEnv({
    IMMICH_URL: 'http://immich.test',
    IMMICH_API_KEY: 'key',
  }), {
    immichUrl: 'http://immich.test',
    apiKey: 'key',
    downloadDestination: null,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
  });
});

test('connection settings can be missing before first-run prompts', () => {
  assert.deepEqual(readConfigFromEnv({}), {
    immichUrl: null,
    apiKey: null,
    downloadDestination: null,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
  });
});

test('reads album download source and original download mode from environment', () => {
  assert.deepEqual(readConfigFromEnv({
    IMMICH_URL: 'http://immich.test',
    IMMICH_API_KEY: 'key',
    IMMICH_DOWNLOAD_SOURCE: 'album',
    IMMICH_ALBUM_ID: 'album-id',
    IMMICH_DOWNLOAD_MODE: 'original',
  }), {
    immichUrl: 'http://immich.test',
    apiKey: 'key',
    downloadDestination: null,
    downloadSource: 'album',
    albumId: 'album-id',
    downloadMode: 'original',
  });
});

test('saveConfigToEnv persists settings while preserving unrelated lines', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-env-save-'));
  const envPath = path.join(root, '.env');
  await fs.writeFile(envPath, 'EXTRA=value\nIMMICH_DOWNLOAD_SOURCE=favorites\n', 'utf8');

  await saveConfigToEnv({
    immichUrl: 'http://immich.test',
    apiKey: 'secret key',
    downloadDestination: '/downloads',
    downloadSource: 'album',
    albumId: 'album-id',
    downloadMode: 'original',
  }, envPath);

  const content = await fs.readFile(envPath, 'utf8');
  assert.match(content, /^EXTRA=value/m);
  assert.match(content, /^IMMICH_URL=http:\/\/immich\.test/m);
  assert.match(content, /^IMMICH_API_KEY="secret key"/m);
  assert.match(content, /^DOWNLOAD_DESTINATION=\/downloads/m);
  assert.match(content, /^IMMICH_DOWNLOAD_SOURCE=album/m);
  assert.match(content, /^IMMICH_ALBUM_ID=album-id/m);
  assert.match(content, /^IMMICH_DOWNLOAD_MODE=original/m);
});

test('command-line destination still parses as an override', () => {
  assert.equal(parseArgs(['--dest', '/override']).destination, '/override');
  assert.equal(parseArgs(['--destination=/override']).destination, '/override');
});
