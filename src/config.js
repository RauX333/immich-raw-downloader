import fs from 'node:fs';
import path from 'node:path';

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

  return { immichUrl, apiKey, downloadDestination };
}

export function helpText() {
  return `Immich Favorite RAW Downloader

Usage:
  immich-raw-downloader [--dry-run] [--verbose] [--dest <folder>]

Environment:
  IMMICH_URL       Immich server URL, e.g. http://immich.example.local:2283
  IMMICH_API_KEY   Immich API key with asset.read and asset.download permissions
  DOWNLOAD_DESTINATION
                   Optional default destination folder

Options:
  --dest <folder>  Destination folder. Overrides DOWNLOAD_DESTINATION.
  --dry-run        Print planned downloads without writing asset files.
  --verbose        Print detailed matching decisions.
  -h, --help       Show this help.
`;
}
