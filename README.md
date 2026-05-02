# Immich Favorite RAW Downloader

Download the RAW versions of your favorite Immich images or images from a chosen Immich album. You can also switch the download mode to save the selected images directly without looking for RAW matches.

The app is a dependency-free Node.js command-line tool for macOS, Linux, and Windows. It can be run from a terminal or from the generated clickable launchers.

## What You Need

- Node.js 22 or newer
- Your Immich server URL, for example `http://immich.example.local:2283`
- An Immich API key with `asset.read`, `asset.download`, and `album.read` permissions
- An existing folder where downloads should be saved

## Quick Start

Run the tool:

```sh
npm start
```

If settings are missing, enter them in the terminal:

```text
Current settings
  Immich URL: not set
  Immich API key: not set
  Download destination: not set
  Download source: favorites
  Download mode: raw

Immich URL: http://immich.example.local:2283
Immich API key: your-api-key
Download destination: /path/to/download-folder
```

After you enter the required settings, the tool creates a local `.env` file automatically and uses those saved values the next time it runs.

You can also create or edit `.env` yourself if you want to prefill settings before launching the tool:

```sh
cp .env.example .env
```

Edit `.env`:

```sh
IMMICH_URL=http://immich.example.local:2283
IMMICH_API_KEY=your-api-key
DOWNLOAD_DESTINATION=/path/to/download-folder
IMMICH_DOWNLOAD_SOURCE=favorites
IMMICH_ALBUM_ID=
IMMICH_DOWNLOAD_MODE=raw
```

When settings are already present, the tool shows them before planning:

```text
Current settings
  Immich URL: http://immich.example.local:2283
  Immich API key: abcd...wxyz
  Download destination: /path/to/download-folder
  Download source: favorites
  Download mode: raw

Press Enter to continue planning, or type anything to edit settings:
```

Press Return once to keep the settings and start planning. Type anything else, then press Return, to open the settings menu before planning. From there, choose a setting by number, or press Return when done. Type `back` inside any setting prompt to return to the settings menu without changing that value. The API key is masked on screen. If you choose `album`, the tool loads your Immich albums and lets you pick one by number. If you choose `original` mode, the tool downloads selected images directly and skips RAW matching. Your selected settings are saved to `.env` and become the default for the next run.

## Download Flow

After the prompts, the tool scans Immich and shows a plan before downloading:

```text
download destination: /path/to/download-folder
Planning download...

Download plan
  Source: favorite images
  Mode: RAW versions
  Favorites scanned: 135
  Files to download: 123
  Estimated size: 6.00 GB
  RAW matches: 118
  Original images: 0
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

Each folder contains the app, a launcher, `README-FIRST.txt`, and a copy of `.env` if one exists. Copy the correct folder to the target computer, make sure Node.js 22 or newer is installed there, then double-click the launcher. If there is no `.env`, the launcher asks for the missing settings in the terminal.

If double-click is blocked by the OS or file manager, open a terminal in that bundle folder and run the launcher manually.

## How RAW Matching Works

- The tool loads Immich image assets marked as favorite by default.
- If `IMMICH_DOWNLOAD_SOURCE=album`, the tool loads images from the selected `IMMICH_ALBUM_ID` instead.
- If `IMMICH_DOWNLOAD_MODE=raw`, for each selected image, it searches nearby image assets taken within 2 minutes.
- If `IMMICH_DOWNLOAD_MODE=original`, it downloads the selected image itself and does not search for RAW candidates.
- A RAW candidate must have the same filename stem, such as `DSC01234.JPG` and `DSC01234.ARW`.
- Common RAW formats are recognized, including `.arw`, `.cr2`, `.cr3`, `.nef`, `.raf`, `.rw2`, `.orf`, `.dng`, and others.
- If multiple RAW candidates match, the closest capture time wins.
- If no RAW match exists, the selected image itself is downloaded.

## Notes

- The download destination folder must already exist.
- The tool does not delete or overwrite existing files.
- `.env` is ignored by git because it may contain your API key.
- Generated `dist/` bundles are ignored by git because they may contain a copied `.env`.

## Tests

```sh
npm test
```
