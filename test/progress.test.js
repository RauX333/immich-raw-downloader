import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  createProgressStream,
  formatBytes,
  formatProgressLine,
  formatSpeed,
  ProgressReporter,
} from '../src/progress.js';

test('formats bytes and speeds for readable progress output', () => {
  assert.equal(formatBytes(25), '25 B');
  assert.equal(formatBytes(1024 * 25), '25.0 KB');
  assert.equal(formatBytes(1024 * 1024 * 25), '25.0 MB');
  assert.equal(formatSpeed(1024 * 1024 * 25, 1000), '25.0 MB/s');
});

test('formats progress line with filename, item count, bytes, and speed', () => {
  const line = formatProgressLine({
    prefix: 'Downloading',
    filename: 'DSC01234.ARW',
    index: 111,
    total: 324,
    downloadedBytes: 25 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024,
    elapsedMs: 1000,
  });

  assert.equal(
    line,
    'Downloading DSC01234.ARW  111/324  25.0 MB / 100.0 MB  25.0 MB/s',
  );
});

test('createProgressStream reports cumulative downloaded bytes', async () => {
  const updates = [];
  const reporter = {
    update(update) {
      updates.push(update.downloadedBytes);
    },
  };

  const chunks = [];
  await pipeline(
    Readable.from([Buffer.from('abc'), Buffer.from('defg')]),
    createProgressStream({ totalBytes: 7, reporter }),
    async function* collect(source) {
      for await (const chunk of source) {
        chunks.push(chunk);
        yield chunk;
      }
    },
  );

  assert.deepEqual(updates, [3, 7]);
  assert.equal(Buffer.concat(chunks).toString('utf8'), 'abcdefg');
});

test('ProgressReporter prints start and finish lines in non-TTY streams', () => {
  let output = '';
  const stream = {
    isTTY: false,
    write(chunk) {
      output += chunk;
    },
  };
  let now = 0;
  const reporter = new ProgressReporter({
    stream,
    now: () => now,
    minIntervalMs: 0,
  });

  reporter.startFile({
    filename: 'DSC01234.ARW',
    index: 1,
    total: 2,
    totalBytes: 10,
  });
  now = 1000;
  reporter.update({ downloadedBytes: 10 });
  reporter.finishFile();

  assert.match(output, /Downloading DSC01234\.ARW  1\/2  0 B \/ 10 B  0 B\/s/);
  assert.match(output, /Finished\s+DSC01234\.ARW  1\/2  10 B \/ 10 B  10 B\/s/);
});
