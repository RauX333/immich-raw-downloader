import { Transform } from 'node:stream';
import { plainStyle, styleForStream } from './terminalStyle.js';

export class ProgressReporter {
  constructor({
    stream = process.stderr,
    now = () => Date.now(),
    minIntervalMs = 250,
  } = {}) {
    this.stream = stream;
    this.now = now;
    this.minIntervalMs = minIntervalMs;
    this.isTTY = Boolean(stream.isTTY);
    this.style = styleForStream(stream);
    this.lastLineLength = 0;
    this.current = null;
  }

  startFile({ filename, index, total, totalBytes }) {
    this.current = {
      filename,
      index,
      total,
      totalBytes,
      downloadedBytes: 0,
      startedAt: this.now(),
      lastRenderAt: 0,
    };

    this.#render(true);
  }

  update({ downloadedBytes }) {
    if (!this.current) {
      return;
    }

    this.current.downloadedBytes = downloadedBytes;
    this.#render(false);
  }

  finishFile() {
    if (!this.current) {
      return;
    }

    const line = formatProgressLine({
      ...this.current,
      elapsedMs: Math.max(1, this.now() - this.current.startedAt),
      prefix: 'Finished',
      style: this.style,
    });
    this.#writeLine(line, true);
    this.current = null;
  }

  failFile(message) {
    if (!this.current) {
      return;
    }

    const line = `${this.style.error('Failed'.padEnd(11))} ${this.current.filename}  ${this.current.index}/${this.current.total}  ${message}`;
    this.#writeLine(line, true);
    this.current = null;
  }

  #render(force) {
    if (!this.current) {
      return;
    }

    const now = this.now();
    if (!force && now - this.current.lastRenderAt < this.minIntervalMs) {
      return;
    }

    this.current.lastRenderAt = now;
    const line = formatProgressLine({
      ...this.current,
      elapsedMs: Math.max(1, now - this.current.startedAt),
      prefix: 'Downloading',
      style: this.style,
    });
    this.#writeLine(line, false);
  }

  #writeLine(line, complete) {
    if (this.isTTY) {
      const padding = ' '.repeat(Math.max(0, this.lastLineLength - line.length));
      this.stream.write(`\r${line}${padding}`);
      this.lastLineLength = line.length;
      if (complete) {
        this.stream.write('\n');
        this.lastLineLength = 0;
      }
      return;
    }

    if (complete || !this.current || this.current.downloadedBytes === 0) {
      this.stream.write(`${line}\n`);
    }
  }
}

export function createProgressStream({ totalBytes, reporter }) {
  let downloadedBytes = 0;

  return new Transform({
    transform(chunk, encoding, callback) {
      downloadedBytes += getChunkSize(chunk, encoding);
      reporter?.update({ downloadedBytes, totalBytes });
      callback(null, chunk);
    },
  });
}

export function formatProgressLine({
  prefix,
  filename,
  index,
  total,
  downloadedBytes,
  totalBytes,
  elapsedMs,
  style = plainStyle,
}) {
  const totalPart = totalBytes === null || totalBytes === undefined
    ? `${formatBytes(downloadedBytes)} / unknown`
    : `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
  const speed = formatSpeed(downloadedBytes, elapsedMs);

  return `${style.accent(prefix.padEnd(11))} ${filename}  ${style.muted(`${index}/${total}`)}  ${style.value(totalPart)}  ${style.accent(speed)}`;
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${value} ${units[unitIndex]}`;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatSpeed(bytes, elapsedMs) {
  if (!elapsedMs || elapsedMs <= 0) {
    return '0 B/s';
  }

  return `${formatBytes((bytes * 1000) / elapsedMs)}/s`;
}

function getChunkSize(chunk, encoding) {
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk, encoding);
  }

  return chunk.length;
}
