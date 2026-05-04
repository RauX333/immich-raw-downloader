import fs from 'node:fs';
import path from 'node:path';

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const MAX_LOG_SIZE = 30 * 1024 * 1024; // 30 MB

let logStream = null;
let logFilePath = null;
let minConsoleLevel = LOG_LEVELS.WARN;
let minFileLevel = LOG_LEVELS.INFO;

export function initLogger({ filePath, consoleLevel = 'WARN', fileLevel = 'INFO' } = {}) {
  if (logStream) {
    logStream.end();
    logStream = null;
  }

  minConsoleLevel = LOG_LEVELS[consoleLevel] ?? LOG_LEVELS.WARN;
  minFileLevel = LOG_LEVELS[fileLevel] ?? LOG_LEVELS.INFO;

  if (!filePath) {
    return;
  }

  logFilePath = filePath;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  rollLogIfNeeded(filePath);

  logStream = fs.createWriteStream(filePath, { flags: 'a' });
  logStream.on('error', (err) => {
    process.stderr.write(`[logger] failed to write log file: ${err.message}\n`);
  });

  log(LOG_LEVELS.INFO, 'logger', 'Log system initialized', { logFile: filePath });
}

function rollLogIfNeeded(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < MAX_LOG_SIZE) {
      return;
    }

    const rotated = `${filePath}.1`;
    if (fs.existsSync(rotated)) {
      fs.unlinkSync(rotated);
    }
    fs.renameSync(filePath, rotated);
  } catch {
    // File doesn't exist yet, nothing to roll.
  }
}

export function setConsoleLogLevel(level) {
  minConsoleLevel = LOG_LEVELS[level] ?? LOG_LEVELS.WARN;
}

export function closeLogger() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

export function getLogFilePath() {
  return logFilePath;
}

export function debug(component, message, data = null) {
  log(LOG_LEVELS.DEBUG, component, message, data);
}

export function info(component, message, data = null) {
  log(LOG_LEVELS.INFO, component, message, data);
}

export function warn(component, message, data = null) {
  log(LOG_LEVELS.WARN, component, message, data);
}

export function error(component, message, data = null) {
  log(LOG_LEVELS.ERROR, component, message, data);
}

function log(level, component, message, data) {
  const levelName = Object.keys(LOG_LEVELS).find((k) => LOG_LEVELS[k] === level) || 'UNKNOWN';
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} [${levelName}] [${component}]`;
  const text = data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;

  if (level >= minFileLevel && logStream) {
    logStream.write(`${text}\n`);
  }

  if (level >= minConsoleLevel) {
    process.stderr.write(`${text}\n`);
  }
}

export function resolveLogPath(envPath) {
  const envDir = path.dirname(path.resolve(envPath));
  return path.join(envDir, 'immich-raw-downloader.log');
}

export { LOG_LEVELS };
