# Immich Favorite RAW Downloader

Download the RAW versions of your favorite Immich images. When a favorite image has no matching RAW asset, the tool downloads the favorite image itself.

The app is a dependency-free Node.js command-line tool for macOS, Linux, and Windows. It can be run from a terminal or from the generated clickable launchers.

## What You Need

- Node.js 22 or newer
- Your Immich server URL, for example `http://immich.example.local:2283`
- An Immich API key with `asset.read` and `asset.download` permissions
- An existing folder where downloads should be saved

## Quick Start

Create your local config:

```sh
cp .env.example .env
```

Edit `.env`:

```sh
IMMICH_URL=http://immich.example.local:2283
IMMICH_API_KEY=your-api-key
DOWNLOAD_DESTINATION=/path/to/download-folder
```

Run the tool:

```sh
npm start
```

At startup, the tool shows the current settings:

```text
Current settings
  Immich URL: http://immich.example.local:2283
  Immich API key: abcd...wxyz
  Download destination: /path/to/download-folder

Press Enter to continue planning, or type anything to edit settings:
```

Press Return once to keep the settings and start planning. Type anything else, then press Return, to edit the Immich URL, API key, and download destination before planning. The API key is masked on screen.

## Download Flow

After the prompts, the tool scans Immich and shows a plan before downloading:

```text
download destination: /path/to/download-folder
Planning download...

Download plan
  Files to download: 123
  Estimated size: 6.00 GB
  RAW matches: 118
  Fallback originals: 5
  Skipped existing: 12
  Preflight failures: 0
Start download? [y/N]
```

Type `y` or `yes` to start. Any other answer cancels without downloading.

During downloads, progress is shown per file:

```text
Downloading DSC01234.ARW  111/324  25.0 MB / 100.0 MB  25.0 MB/s
```

Files are saved into `YYYY-MM-DD` subfolders inside the destination folder. Existing files are skipped.

## Useful Commands

Preview what would be downloaded without writing files:

```sh
npm start -- --dry-run
```

Show detailed matching decisions:

```sh
npm start -- --verbose
```

Use a destination folder for one run:

```sh
npm start -- --dest /path/to/downloads
```

When `--dest` is used, the settings menu still lets you edit the Immich URL and API key, but the destination stays fixed for that run.

On Windows:

```bat
npm start -- --dest C:\Users\you\Pictures\ImmichRaw
```

## Clickable Launchers

Build platform folders:

```sh
npm run build:bundles
```

This creates:

- `dist/immich-raw-downloader-macos/Run Immich RAW Downloader.command`
- `dist/immich-raw-downloader-linux/run-immich-raw-downloader.sh`
- `dist/immich-raw-downloader-windows/Run Immich RAW Downloader.cmd`

Each folder contains the app, a launcher, `README-FIRST.txt`, and a copy of `.env` if one exists. Copy the correct folder to the target computer, make sure Node.js 22 or newer is installed there, then double-click the launcher.

If double-click is blocked by the OS or file manager, open a terminal in that bundle folder and run the launcher manually.

## How RAW Matching Works

- The tool loads Immich image assets marked as favorite.
- For each favorite, it searches nearby image assets taken within 2 minutes.
- A RAW candidate must have the same filename stem, such as `DSC01234.JPG` and `DSC01234.ARW`.
- Common RAW formats are recognized, including `.arw`, `.cr2`, `.cr3`, `.nef`, `.raf`, `.rw2`, `.orf`, `.dng`, and others.
- If multiple RAW candidates match, the closest capture time wins.
- If no RAW match exists, the favorite image itself is downloaded.

## Notes

- The download destination folder must already exist.
- The tool does not delete or overwrite existing files.
- `.env` is ignored by git because it may contain your API key.
- Generated `dist/` bundles are ignored by git because they may contain a copied `.env`.

## Tests

```sh
npm test
```
