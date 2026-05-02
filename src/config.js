import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

export const DOWNLOAD_SOURCE_FAVORITES = 'favorites';
export const DOWNLOAD_SOURCE_ALBUM = 'album';
export const DEFAULT_DOWNLOAD_SOURCE = DOWNLOAD_SOURCE_FAVORITES;
export const DOWNLOAD_MODE_RAW = 'raw';
export const DOWNLOAD_MODE_ORIGINAL = 'original';
export const DOWNLOAD_MODE_BOTH = 'both';
export const DEFAULT_DOWNLOAD_MODE = DOWNLOAD_MODE_RAW;

export function loadDotenv(filePath = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    const value = stripEnvQuotes(rawValue);
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function parseArgs(argv) {
  const options = {
    dryRun: false,
    verbose: false,
    destination: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dest' || arg === '--destination') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a folder path`);
      }
      options.destination = value;
      index += 1;
    } else if (arg.startsWith('--dest=')) {
      options.destination = arg.slice('--dest='.length);
    } else if (arg.startsWith('--destination=')) {
      options.destination = arg.slice('--destination='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function readConfigFromEnv(env = process.env) {
  const immichUrl = env.IMMICH_URL || null;
  const apiKey = env.IMMICH_API_KEY || null;
  const downloadDestination = env.DOWNLOAD_DESTINATION || null;
  const downloadSource = normalizeDownloadSource(env.IMMICH_DOWNLOAD_SOURCE);
  const albumId = env.IMMICH_ALBUM_ID || null;
  const downloadMode = normalizeDownloadMode(env.IMMICH_DOWNLOAD_MODE);

  return { immichUrl, apiKey, downloadDestination, downloadSource, albumId, downloadMode };
}

export function normalizeDownloadSource(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === DOWNLOAD_SOURCE_ALBUM) {
    return DOWNLOAD_SOURCE_ALBUM;
  }

  return DOWNLOAD_SOURCE_FAVORITES;
}

export function normalizeDownloadMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === DOWNLOAD_MODE_ORIGINAL) {
    return DOWNLOAD_MODE_ORIGINAL;
  }
  if (normalized === DOWNLOAD_MODE_BOTH) {
    return DOWNLOAD_MODE_BOTH;
  }

  return DOWNLOAD_MODE_RAW;
}

export async function saveConfigToEnv(config, filePath = path.resolve(process.cwd(), '.env')) {
  const updates = {
    IMMICH_URL: config.immichUrl,
    IMMICH_API_KEY: config.apiKey,
    DOWNLOAD_DESTINATION: config.downloadDestination,
    IMMICH_DOWNLOAD_SOURCE: normalizeDownloadSource(config.downloadSource),
    IMMICH_ALBUM_ID: config.albumId,
    IMMICH_DOWNLOAD_MODE: normalizeDownloadMode(config.downloadMode),
  };

  const existing = await readEnvFileLines(filePath);
  const seen = new Set();
  const nextLines = existing.map((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed || !(parsed.key in updates)) {
      return line;
    }

    seen.add(parsed.key);
    const value = updates[parsed.key];
    if (value === undefined) {
      return line;
    }

    return `${parsed.key}=${formatEnvValue(value || '')}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || seen.has(key)) {
      continue;
    }
    nextLines.push(`${key}=${formatEnvValue(value || '')}`);
  }

  await fsPromises.writeFile(filePath, `${nextLines.join('\n').replace(/\n*$/g, '')}\n`, 'utf8');
}

async function readEnvFileLines(filePath) {
  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    return content.split(/\r?\n/).filter((line, index, lines) => {
      return index < lines.length - 1 || line.length > 0;
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const equalsIndex = trimmed.indexOf('=');
  if (equalsIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, equalsIndex).trim();
  return key ? { key } : null;
}

function formatEnvValue(value) {
  const text = String(value);
  if (!text || /^[A-Za-z0-9_./:@-]+$/.test(text)) {
    return text;
  }

  return JSON.stringify(text);
}

export function helpText() {
  return `Immich Favorite RAW Downloader

Usage:
  immich-raw-downloader [--dry-run] [--verbose] [--dest <folder>]

Environment:
  IMMICH_URL       Immich server URL, e.g. http://immich.example.local:2283
  IMMICH_API_KEY   Immich API key with asset.read, asset.download, and album.read permissions
  DOWNLOAD_DESTINATION
                   Optional default destination folder
  IMMICH_DOWNLOAD_SOURCE
                   Optional default source: favorites or album
  IMMICH_ALBUM_ID  Album ID or album URL to use when IMMICH_DOWNLOAD_SOURCE=album
  IMMICH_DOWNLOAD_MODE
                   Optional download mode: raw, original, or both

Options:
  --dest <folder>  Destination folder. Overrides DOWNLOAD_DESTINATION.
  --dry-run        Print planned downloads without writing asset files.
  --verbose        Print detailed matching decisions.
  -h, --help       Show this help.
`;
}
