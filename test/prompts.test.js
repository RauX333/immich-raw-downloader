import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import {
  chooseDestination,
  chooseImmichConnection,
  chooseRunConfig,
  confirmDownloadPlan,
  formatRunConfig,
  maskApiKey,
} from '../src/prompts.js';

function nullOutput() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function captureOutput() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  stream.text = () => text;
  return stream;
}

function feedLines(input, lines) {
  const writeNext = (index) => {
    if (index >= lines.length) {
      input.end();
      return;
    }

    input.write(`${lines[index]}\n`);
    setTimeout(() => writeNext(index + 1), 5);
  };

  writeNext(0);
}

function defaultProfileResult() {
  return {
    profileName: 'default',
  };
}

test('confirmDownloadPlan accepts yes answers', async () => {
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = confirmDownloadPlan({ inputStream: input, outputStream: output });
  input.end('yes\n');

  assert.equal(await resultPromise, true);
});

test('confirmDownloadPlan rejects empty answers by default', async () => {
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = confirmDownloadPlan({ inputStream: input, outputStream: output });
  input.end('\n');

  assert.equal(await resultPromise, false);
});

test('chooseDestination accepts the provided folder when user presses return', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-dest-default-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseDestination({
    providedDestination: root,
    inputStream: input,
    outputStream: output,
  });
  input.end('\n');

  assert.equal(await resultPromise, root);
});

test('chooseDestination lets user override the provided folder before planning', async () => {
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-dest-default-'));
  const overrideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-dest-override-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseDestination({
    providedDestination: defaultRoot,
    inputStream: input,
    outputStream: output,
  });
  input.end(`${overrideRoot}\n`);

  assert.equal(await resultPromise, overrideRoot);
});

test('chooseDestination does not ask when change is disabled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-dest-fixed-'));
  const input = new PassThrough();
  const output = nullOutput();

  const result = await chooseDestination({
    providedDestination: root,
    allowChange: false,
    inputStream: input,
    outputStream: output,
  });

  assert.equal(result, root);
});

test('maskApiKey keeps API key display short and private', () => {
  assert.equal(maskApiKey('12345678'), '********');
  assert.equal(maskApiKey('1234567890abcdef'), '1234...cdef');
  assert.equal(maskApiKey(''), 'not set');
});

test('chooseImmichConnection accepts current URL and API key when user presses return', async () => {
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseImmichConnection({
    immichUrl: 'http://immich.test:2283',
    apiKey: 'current-api-key',
    inputStream: input,
    outputStream: output,
  });
  input.write('\n');
  setImmediate(() => {
    input.end('\n');
  });

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://immich.test:2283',
    apiKey: 'current-api-key',
  });
});

test('chooseImmichConnection lets user override URL and API key before planning', async () => {
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseImmichConnection({
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    inputStream: input,
    outputStream: output,
  });
  input.write('https://new.test\n');
  setImmediate(() => {
    input.end('new-key\n');
  });

  assert.deepEqual(await resultPromise, {
    immichUrl: 'https://new.test',
    apiKey: 'new-key',
  });
});

test('chooseImmichConnection rejects invalid configured URL before prompting', async () => {
  await assert.rejects(() => chooseImmichConnection({
    immichUrl: 'not a url',
    apiKey: 'key',
    allowChange: false,
    inputStream: new PassThrough(),
    outputStream: nullOutput(),
  }), /valid http:\/\/ or https:\/\//);
});

test('formatRunConfig shows editable settings with masked API key', () => {
  const text = formatRunConfig({
    immichUrl: 'http://immich.test',
    apiKey: '1234567890abcdef',
    destination: '/downloads',
  });

  assert.match(text, /Current settings/);
  assert.match(text, /Immich URL: http:\/\/immich\.test/);
  assert.match(text, /Immich API key: 1234\.\.\.cdef/);
  assert.match(text, /Download destination: \/downloads/);
  assert.match(text, /Download source: favorites/);
  assert.match(text, /Download mode: raw/);
});

test('chooseRunConfig continues with current settings when user presses enter', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-config-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://immich.test',
    apiKey: 'api-key',
    destination: root,
    inputStream: input,
    outputStream: output,
  });
  input.end('\n');

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://immich.test',
    apiKey: 'api-key',
    destination: root,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
    ...defaultProfileResult(),
  });
});

test('chooseRunConfig edits settings after non-empty menu input', async () => {
  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-old-'));
  const newRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-new-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: oldRoot,
    inputStream: input,
    outputStream: output,
  });
  feedLines(input, ['e', '1', 'https://new.test', '2', 'new-key', '4', newRoot, '']);

  assert.deepEqual(await resultPromise, {
    immichUrl: 'https://new.test',
    apiKey: 'new-key',
    destination: newRoot,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
    ...defaultProfileResult(),
  });
});

test('settings menu shows connection settings before profile settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-menu-layout-'));
  const input = new PassThrough();
  const output = captureOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    inputStream: input,
    outputStream: output,
  });
  feedLines(input, ['e', 'done']);
  await resultPromise;

  const text = output.text();
  const urlIndex = text.indexOf('1. Immich URL');
  const keyIndex = text.indexOf('2. Immich API key');
  const profileIndex = text.indexOf('Now use profile default');
  const switchIndex = text.indexOf('3. Switch profile');
  const scopedIndex = text.indexOf('Profile settings');
  const destinationIndex = text.indexOf('4. Download destination');

  assert.ok(urlIndex !== -1);
  assert.ok(urlIndex < keyIndex);
  assert.ok(keyIndex < profileIndex);
  assert.ok(profileIndex < switchIndex);
  assert.ok(switchIndex < scopedIndex);
  assert.ok(scopedIndex < destinationIndex);
});

test('chooseRunConfig lets user pick an album from Immich albums', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-album-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    inputStream: input,
    outputStream: output,
    listAlbums: async () => [
      { id: 'album-one', albumName: 'Trip', assetCount: 12 },
      { id: 'album-two', albumName: 'Family', assetCount: 34 },
    ],
  });
  feedLines(input, ['e', '5', 'album', '2', '']);

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    downloadSource: 'album',
    albumId: 'album-two',
    downloadMode: 'raw',
    ...defaultProfileResult(),
  });
});

test('chooseRunConfig lets user choose original image download mode', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-original-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    inputStream: input,
    outputStream: output,
  });
  feedLines(input, ['e', '6', 'original', '']);

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'original',
    ...defaultProfileResult(),
  });
});

test('chooseRunConfig lets user choose both download mode', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-both-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    inputStream: input,
    outputStream: output,
  });
  feedLines(input, ['e', '6', 'both', '']);

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'both',
    ...defaultProfileResult(),
  });
});

test('chooseRunConfig switches to a saved profile', async () => {
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-default-profile-'));
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-project-profile-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: defaultRoot,
    profiles: [
      {
        name: 'default',
        downloadDestination: defaultRoot,
        downloadSource: 'favorites',
        albumId: null,
        downloadMode: 'raw',
      },
      {
        name: 'trip',
        downloadDestination: projectRoot,
        downloadSource: 'album',
        albumId: 'album-trip',
        downloadMode: 'both',
      },
    ],
    inputStream: input,
    outputStream: output,
  });
  feedLines(input, ['e', '3', '2', '']);

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: projectRoot,
    downloadSource: 'album',
    albumId: 'album-trip',
    downloadMode: 'both',
    profileName: 'trip',
  });
});

test('chooseRunConfig creates a profile from current settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-new-profile-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    inputStream: input,
    outputStream: output,
  });
  feedLines(input, ['e', '3', 'c', 'Trip 2026', '']);

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
    profileName: 'trip-2026',
  });
});

test('chooseRunConfig can go back from a setting prompt without changing it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-back-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    inputStream: input,
    outputStream: output,
  });
  feedLines(input, ['e', '1', 'back', '']);

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
    ...defaultProfileResult(),
  });
});

test('chooseRunConfig can go back from album selection and keep previous source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-album-back-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    inputStream: input,
    outputStream: output,
    listAlbums: async () => [
      { id: 'album-one', albumName: 'Trip', assetCount: 12 },
    ],
  });
  feedLines(input, ['e', '5', 'album', 'back', '']);

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://old.test',
    apiKey: 'old-key',
    destination: root,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
    ...defaultProfileResult(),
  });
});

test('chooseRunConfig asks for destination on enter when none is configured', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-missing-dest-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: 'http://immich.test',
    apiKey: 'api-key',
    destination: null,
    inputStream: input,
    outputStream: output,
  });
  feedLines(input, ['', root]);

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://immich.test',
    apiKey: 'api-key',
    destination: root,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
    ...defaultProfileResult(),
  });
});

test('chooseRunConfig prompts for missing first-run settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immich-run-first-use-'));
  const input = new PassThrough();
  const output = nullOutput();

  const resultPromise = chooseRunConfig({
    immichUrl: null,
    apiKey: null,
    destination: null,
    inputStream: input,
    outputStream: output,
  });
  feedLines(input, ['http://immich.test:2283', 'new-api-key', root]);

  assert.deepEqual(await resultPromise, {
    immichUrl: 'http://immich.test:2283',
    apiKey: 'new-api-key',
    destination: root,
    downloadSource: 'favorites',
    albumId: null,
    downloadMode: 'raw',
    ...defaultProfileResult(),
  });
});
