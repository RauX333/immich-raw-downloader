import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, readConfigFromEnv } from '../src/config.js';

test('reads optional download destination from environment', () => {
  assert.deepEqual(readConfigFromEnv({
    IMMICH_URL: 'http://immich.test',
    IMMICH_API_KEY: 'key',
    DOWNLOAD_DESTINATION: '/downloads',
  }), {
    immichUrl: 'http://immich.test',
    apiKey: 'key',
    downloadDestination: '/downloads',
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
  });
});

test('connection settings can be missing before first-run prompts', () => {
  assert.deepEqual(readConfigFromEnv({}), {
    immichUrl: null,
    apiKey: null,
    downloadDestination: null,
  });
});

test('command-line destination still parses as an override', () => {
  assert.equal(parseArgs(['--dest', '/override']).destination, '/override');
  assert.equal(parseArgs(['--destination=/override']).destination, '/override');
});
