import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
  DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  parseArgs,
  readConfigFromEnv,
  saveConfigToEnv,
} from '../src/config.js';

const defaultAdvancedConfig = {
  downloadMaxAttempts: DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
  requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  downloadIdleTimeoutMs: DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
};

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
    ...defaultAdvancedConfig,
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
    ...defaultAdvancedConfig,
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
    ...defaultAdvancedConfig,
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
    ...defaultAdvancedConfig,
  });
});

test('reads both download mode from environment', () => {
  assert.equal(readConfigFromEnv({
    IMMICH_DOWNLOAD_MODE: 'both',
  }).downloadMode, 'both');
});

test('reads advanced retry and timeout settings from environment', () => {
  const config = readConfigFromEnv({
    IMMICH_DOWNLOAD_MAX_ATTEMPTS: '5',
    IMMICH_REQUEST_TIMEOUT_SECONDS: '10',
    IMMICH_DOWNLOAD_IDLE_TIMEOUT_SECONDS: '45',
  });

  assert.equal(config.downloadMaxAttempts, 5);
  assert.equal(config.requestTimeoutMs, 10_000);
  assert.equal(config.downloadIdleTimeoutMs, 45_000);
});

test('uses defaults for invalid advanced retry and timeout settings', () => {
  const config = readConfigFromEnv({
    IMMICH_DOWNLOAD_MAX_ATTEMPTS: '0',
    IMMICH_REQUEST_TIMEOUT_SECONDS: 'bad',
    IMMICH_DOWNLOAD_IDLE_TIMEOUT_SECONDS: '-1',
  });

  assert.equal(config.downloadMaxAttempts, DEFAULT_DOWNLOAD_MAX_ATTEMPTS);
  assert.equal(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  assert.equal(config.downloadIdleTimeoutMs, DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS);
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
    downloadMode: 'both',
  }, envPath);

  const content = await fs.readFile(envPath, 'utf8');
  assert.match(content, /^EXTRA=value/m);
  assert.match(content, /^IMMICH_URL=http:\/\/immich\.test/m);
  assert.match(content, /^IMMICH_API_KEY="secret key"/m);
  assert.match(content, /^DOWNLOAD_DESTINATION=\/downloads/m);
  assert.match(content, /^IMMICH_DOWNLOAD_SOURCE=album/m);
  assert.match(content, /^IMMICH_ALBUM_ID=album-id/m);
  assert.match(content, /^IMMICH_DOWNLOAD_MODE=both/m);
});

test('saveConfigToEnv creates .env when it does not exist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-env-create-'));
  const envPath = path.join(root, '.env');

  await saveConfigToEnv({
    immichUrl: 'http://immich.test',
    apiKey: 'key',
    downloadDestination: '/downloads',
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
  }, envPath);

  const content = await fs.readFile(envPath, 'utf8');
  assert.match(content, /^IMMICH_URL=http:\/\/immich\.test/m);
  assert.match(content, /^IMMICH_API_KEY=key/m);
  assert.match(content, /^DOWNLOAD_DESTINATION=\/downloads/m);
  assert.match(content, /^IMMICH_DOWNLOAD_SOURCE=favorites/m);
  assert.match(content, /^IMMICH_ALBUM_ID=$/m);
  assert.match(content, /^IMMICH_DOWNLOAD_MODE=raw/m);
});

test('command-line destination still parses as an override', () => {
  assert.equal(parseArgs(['--dest', '/override']).destination, '/override');
  assert.equal(parseArgs(['--destination=/override']).destination, '/override');
});
