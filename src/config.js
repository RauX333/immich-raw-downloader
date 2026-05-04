import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const DOWNLOAD_SOURCE_FAVORITES = 'favorites';
export const DOWNLOAD_SOURCE_ALBUM = 'album';
export const DEFAULT_DOWNLOAD_SOURCE = DOWNLOAD_SOURCE_FAVORITES;
export const DOWNLOAD_MODE_RAW = 'raw';
export const DOWNLOAD_MODE_ORIGINAL = 'original';
export const DOWNLOAD_MODE_BOTH = 'both';
export const DEFAULT_DOWNLOAD_MODE = DOWNLOAD_MODE_RAW;
export const DEFAULT_DOWNLOAD_MAX_ATTEMPTS = 3;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS = 120_000;
export const DEFAULT_PROFILE_NAME = 'default';
export const DEFAULT_LOG_LEVEL = 'warn';

export function generateProfileId() {
  return crypto.randomUUID();
}

export function normalizeDownloadOnlyNew(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

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
  const profileName = normalizeProfileName(env.IMMICH_PROFILE_NAME);
  const profiles = readProfilesFromEnv(env);
  const activeProfile = findProfile(profiles, profileName)
    || findProfile(profiles, DEFAULT_PROFILE_NAME);
  const downloadDestination = activeProfile?.downloadDestination || null;
  const downloadSource = normalizeDownloadSource(activeProfile?.downloadSource);
  const albumId = activeProfile?.albumId || null;
  const downloadMode = normalizeDownloadMode(activeProfile?.downloadMode);
  const downloadOnlyNew = normalizeDownloadOnlyNew(activeProfile?.downloadOnlyNew);
  const downloadMaxAttempts = parsePositiveInteger(
    env.IMMICH_DOWNLOAD_MAX_ATTEMPTS,
    DEFAULT_DOWNLOAD_MAX_ATTEMPTS,
  );
  const requestTimeoutMs = parsePositiveSeconds(
    env.IMMICH_REQUEST_TIMEOUT_SECONDS,
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const downloadIdleTimeoutMs = parsePositiveSeconds(
    env.IMMICH_DOWNLOAD_IDLE_TIMEOUT_SECONDS,
    DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
  );
  const logLevel = normalizeLogLevel(env.IMMICH_LOG_LEVEL);

  return {
    immichUrl,
    apiKey,
    downloadDestination,
    downloadSource,
    albumId,
    downloadMode,
    downloadOnlyNew,
    profileName: activeProfile?.name || DEFAULT_PROFILE_NAME,
    profiles,
    downloadMaxAttempts,
    requestTimeoutMs,
    downloadIdleTimeoutMs,
    logLevel,
  };
}

function readProfilesFromEnv(env) {
  const profiles = new Map();
  const defaultProfile = {
    name: DEFAULT_PROFILE_NAME,
    profileId: env.PROFILE_ID || env.IMMICH_PROFILE_ID || null,
    downloadDestination: env.DOWNLOAD_DESTINATION || null,
    downloadSource: normalizeDownloadSource(env.IMMICH_DOWNLOAD_SOURCE),
    albumId: env.IMMICH_ALBUM_ID || null,
    downloadMode: normalizeDownloadMode(env.IMMICH_DOWNLOAD_MODE),
    downloadOnlyNew: normalizeDownloadOnlyNew(env.IMMICH_DOWNLOAD_ONLY_NEW),
  };
  profiles.set(profileKey(defaultProfile.name), defaultProfile);

  const profilePattern = /^IMMICH_PROFILE_([A-Z0-9_]+)_(PROFILE_ID|DOWNLOAD_DESTINATION|DOWNLOAD_SOURCE|ALBUM_ID|DOWNLOAD_MODE|DOWNLOAD_ONLY_NEW)$/;
  for (const [key, value] of Object.entries(env)) {
    const match = key.match(profilePattern);
    if (!match) {
      continue;
    }

    const name = envTokenToProfileName(match[1]);
    const field = match[2];
    const mapKey = profileKey(name);
    const profile = profiles.get(mapKey) || {
      name,
      profileId: null,
      downloadDestination: null,
      downloadSource: DEFAULT_DOWNLOAD_SOURCE,
      albumId: null,
      downloadMode: DEFAULT_DOWNLOAD_MODE,
      downloadOnlyNew: false,
    };

    if (field === 'PROFILE_ID') {
      profile.profileId = value || null;
    } else if (field === 'DOWNLOAD_DESTINATION') {
      profile.downloadDestination = value || null;
    } else if (field === 'DOWNLOAD_SOURCE') {
      profile.downloadSource = normalizeDownloadSource(value);
    } else if (field === 'ALBUM_ID') {
      profile.albumId = value || null;
    } else if (field === 'DOWNLOAD_MODE') {
      profile.downloadMode = normalizeDownloadMode(value);
    } else if (field === 'DOWNLOAD_ONLY_NEW') {
      profile.downloadOnlyNew = normalizeDownloadOnlyNew(value);
    }

    profiles.set(mapKey, profile);
  }

  readLegacyScopedProfilesFromEnv(env, profiles);

  return Array.from(profiles.values()).sort(compareProfiles);
}

function readLegacyScopedProfilesFromEnv(env, profiles) {
  const legacyPattern = /^IMMICH_(DEFAULT|GLOBAL|PROJECT)_PROFILE_([A-Z0-9_]+)_(PROFILE_ID|DOWNLOAD_DESTINATION|DOWNLOAD_SOURCE|ALBUM_ID|DOWNLOAD_MODE|DOWNLOAD_ONLY_NEW)$/;
  for (const [key, value] of Object.entries(env)) {
    const match = key.match(legacyPattern);
    if (!match) {
      continue;
    }

    const name = envTokenToProfileName(match[2]);
    const field = match[3];
    const mapKey = profileKey(name);
    const profile = profiles.get(mapKey) || {
      name,
      profileId: null,
      downloadDestination: null,
      downloadSource: DEFAULT_DOWNLOAD_SOURCE,
      albumId: null,
      downloadMode: DEFAULT_DOWNLOAD_MODE,
      downloadOnlyNew: false,
    };

    if (field === 'PROFILE_ID') {
      profile.profileId = value || null;
    } else if (field === 'DOWNLOAD_DESTINATION') {
      profile.downloadDestination = value || null;
    } else if (field === 'DOWNLOAD_SOURCE') {
      profile.downloadSource = normalizeDownloadSource(value);
    } else if (field === 'ALBUM_ID') {
      profile.albumId = value || null;
    } else if (field === 'DOWNLOAD_MODE') {
      profile.downloadMode = normalizeDownloadMode(value);
    } else if (field === 'DOWNLOAD_ONLY_NEW') {
      profile.downloadOnlyNew = normalizeDownloadOnlyNew(value);
    }

    profiles.set(mapKey, profile);
  }
}

function findProfile(profiles, name) {
  return profiles.find((profile) => {
    return profile.name === normalizeProfileName(name);
  });
}

function profileKey(name) {
  return normalizeProfileName(name);
}

function compareProfiles(left, right) {
  if (left.name === DEFAULT_PROFILE_NAME) {
    return -1;
  }
  if (right.name === DEFAULT_PROFILE_NAME) {
    return 1;
  }
  return left.name.localeCompare(right.name);
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

export function normalizeLogLevel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['debug', 'info', 'warn', 'error'].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_LOG_LEVEL;
}

export function normalizeProfileName(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_PROFILE_NAME;
}

export async function saveConfigToEnv(config, filePath = path.resolve(process.cwd(), '.env')) {
  const profileName = normalizeProfileName(config.profileName);
  const updates = {
    IMMICH_URL: config.immichUrl,
    IMMICH_API_KEY: config.apiKey,
    IMMICH_PROFILE_NAME: profileName,
    IMMICH_LOG_LEVEL: config.logLevel != null ? normalizeLogLevel(config.logLevel) : undefined,
    ...profileUpdatesForConfig({
      ...config,
      profileId: config.profileId,
    }, profileName),
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

function profileUpdatesForConfig(config, name) {
  const profileValues = {
    PROFILE_ID: config.profileId || '',
    DOWNLOAD_DESTINATION: config.downloadDestination,
    IMMICH_DOWNLOAD_SOURCE: normalizeDownloadSource(config.downloadSource),
    IMMICH_ALBUM_ID: config.albumId,
    IMMICH_DOWNLOAD_MODE: normalizeDownloadMode(config.downloadMode),
    IMMICH_DOWNLOAD_ONLY_NEW: normalizeDownloadOnlyNew(config.downloadOnlyNew) ? 'true' : 'false',
  };

  if (name === DEFAULT_PROFILE_NAME) {
    return profileValues;
  }

  const prefix = profileEnvPrefix(name);
  return {
    [`${prefix}_PROFILE_ID`]: profileValues.PROFILE_ID,
    [`${prefix}_DOWNLOAD_DESTINATION`]: profileValues.DOWNLOAD_DESTINATION,
    [`${prefix}_DOWNLOAD_SOURCE`]: profileValues.IMMICH_DOWNLOAD_SOURCE,
    [`${prefix}_ALBUM_ID`]: profileValues.IMMICH_ALBUM_ID,
    [`${prefix}_DOWNLOAD_MODE`]: profileValues.IMMICH_DOWNLOAD_MODE,
    [`${prefix}_DOWNLOAD_ONLY_NEW`]: profileValues.IMMICH_DOWNLOAD_ONLY_NEW,
  };
}

function profileEnvPrefix(name) {
  return `IMMICH_PROFILE_${profileNameToEnvToken(name)}`;
}

function profileNameToEnvToken(name) {
  return normalizeProfileName(name).replace(/-/g, '_').toUpperCase();
}

function envTokenToProfileName(token) {
  return normalizeProfileName(String(token || '').replace(/_/g, '-'));
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

function parsePositiveSeconds(value, fallbackMs) {
  const parsed = parsePositiveInteger(value, null);
  return parsed === null ? fallbackMs : parsed * 1000;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(String(value || '').trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function helpText() {
  return `Immich Favorite RAW Downloader

Usage:
  immich-raw-downloader [--dry-run] [--verbose] [--dest <folder>]

Environment:
  IMMICH_URL       Immich server URL, e.g. http://immich.example.local:2283
  IMMICH_API_KEY   Immich API key with asset.read, asset.download, and album.read permissions
  IMMICH_LOG_LEVEL Optional console log level: debug, info, warn (default), or error
  DOWNLOAD_DESTINATION
                   Optional default destination folder
  IMMICH_DOWNLOAD_SOURCE
                   Optional default source: favorites or album
  IMMICH_ALBUM_ID  Album ID or album URL to use when IMMICH_DOWNLOAD_SOURCE=album
  IMMICH_DOWNLOAD_MODE
                   Optional download mode: raw, original, or both
  IMMICH_PROFILE_NAME
                   Optional last-used profile name, default default
  IMMICH_PROFILE_<NAME>_DOWNLOAD_DESTINATION
  IMMICH_PROFILE_<NAME>_DOWNLOAD_SOURCE
  IMMICH_PROFILE_<NAME>_ALBUM_ID
  IMMICH_PROFILE_<NAME>_DOWNLOAD_MODE
                   Optional named profile settings
  IMMICH_DOWNLOAD_MAX_ATTEMPTS
                   Optional download retry attempts, default 3
  IMMICH_REQUEST_TIMEOUT_SECONDS
                   Optional request timeout before response starts, default 30
  IMMICH_DOWNLOAD_IDLE_TIMEOUT_SECONDS
                   Optional download idle timeout between chunks, default 120

Options:
  --dest <folder>  Destination folder. Overrides DOWNLOAD_DESTINATION.
  --dry-run        Print planned downloads without writing asset files.
  --verbose        Print detailed matching decisions.
  -h, --help       Show this help.
`;
}
