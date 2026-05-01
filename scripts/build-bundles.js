import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const distRoot = path.join(projectRoot, 'dist');

const commonEntries = [
  'bin',
  'src',
  'package.json',
  'README.md',
  '.env.example',
];

const platforms = [
  {
    name: 'macos',
    launcherName: 'Run Immich RAW Downloader.command',
    launcherContent: macosLauncher(),
    executableLaunchers: ['Run Immich RAW Downloader.command'],
  },
  {
    name: 'linux',
    launcherName: 'run-immich-raw-downloader.sh',
    launcherContent: linuxLauncher(),
    executableLaunchers: ['run-immich-raw-downloader.sh'],
  },
  {
    name: 'windows',
    launcherName: 'Run Immich RAW Downloader.cmd',
    launcherContent: windowsLauncher(),
    executableLaunchers: [],
  },
];

await fs.rm(distRoot, { recursive: true, force: true });
await fs.mkdir(distRoot, { recursive: true });

for (const platform of platforms) {
  const bundleRoot = path.join(distRoot, `immich-raw-downloader-${platform.name}`);
  await fs.mkdir(bundleRoot, { recursive: true });

  for (const entry of commonEntries) {
    await copyEntry(path.join(projectRoot, entry), path.join(bundleRoot, entry));
  }

  const localEnvPath = path.join(projectRoot, '.env');
  if (await exists(localEnvPath)) {
    await fs.copyFile(localEnvPath, path.join(bundleRoot, '.env'));
  }

  await fs.writeFile(
    path.join(bundleRoot, platform.launcherName),
    platform.launcherContent,
    platform.name === 'windows' ? 'utf8' : { encoding: 'utf8', mode: 0o755 },
  );

  for (const launcherName of platform.executableLaunchers) {
    await fs.chmod(path.join(bundleRoot, launcherName), 0o755);
  }

  await fs.writeFile(path.join(bundleRoot, 'README-FIRST.txt'), readmeFirst(platform), 'utf8');
}

console.log(`Bundles written to ${distRoot}`);

async function copyEntry(source, destination) {
  const stats = await fs.stat(source);
  if (stats.isDirectory()) {
    await fs.cp(source, destination, { recursive: true, verbatimSymlinks: true });
  } else {
    await fs.copyFile(source, destination);
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function readmeFirst(platform) {
  const launcher = platform.launcherName;
  return `Immich Favorite RAW Downloader

This folder is a portable bundle for ${platform.name}.

How to run:
1. Install Node.js 22 or newer if this computer does not have it.
2. Double-click:
   ${launcher}

The launcher opens or uses a terminal window. If .env is missing or incomplete, enter IMMICH_URL, IMMICH_API_KEY, and the download destination when prompted.

After settings are entered, the launcher shows the download plan, asks for confirmation, and then downloads files.

If double-click is blocked by your file manager, open a terminal in this folder and run the launcher from there.
`;
}

function macosLauncher() {
  return `#!/bin/sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required."
  echo "Install it from https://nodejs.org/ and run this launcher again."
  printf "\\nPress Return to close..."
  read _
  exit 1
fi

node ./bin/immich-raw-downloader.js "$@"
status=$?

printf "\\nDone. Press Return to close..."
read _
exit "$status"
`;
}

function linuxLauncher() {
  return `#!/bin/sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required."
  echo "Install it from https://nodejs.org/ or your package manager, then run this launcher again."
  printf "\\nPress Return to close..."
  read _
  exit 1
fi

node ./bin/immich-raw-downloader.js "$@"
status=$?

printf "\\nDone. Press Return to close..."
read _
exit "$status"
`;
}

function windowsLauncher() {
  return `@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  echo Install it from https://nodejs.org/ and run this launcher again.
  echo.
  pause
  exit /b 1
)

node ".\\bin\\immich-raw-downloader.js" %*
set EXIT_CODE=%ERRORLEVEL%

echo.
pause
exit /b %EXIT_CODE%
`;
}
