# Immich RAW Downloader

Search and download matching RAW version of images from Immich for favorite photos or photos in an album.

## What it does

- Searches and downloads RAW versions of images for Immich favorites
- Searches and downloads RAW versions of images for a selected Immich album
- Can download RAW files, original files, or both
- Can download only new images (skips previously downloaded ones)
- Skips files that already exist on disk
- Supports dry run before downloading
- Supports named profiles for different download configurations
- Works on macOS, Windows, and Linux

## How RAW matching works

The tool matches files by:

- Same filename stem
- Close capture time (within 2 minutes)
- RAW file extension

Example:

```text
DSC01234.JPG  ->  DSC01234.ARW
IMG_1001.HEIC ->  IMG_1001.DNG
```

Supported RAW extensions include:

```text
.arw, .cr2, .cr3, .nef, .raf, .rw2, .orf, .dng
```

If multiple RAW candidates match, the closest capture time wins.

## Requirements

- Node.js 22 or newer
- Your Immich server URL, for example `http://immich.example.local:2283`
- Your Immich API key

Your Immich API key needs those permissions:

- `asset.read`
- `asset.download`
- `album.read`

The download folder must already exist.

## Download

Download the latest release from GitHub Releases:

https://github.com/RauX333/immich-raw-downloader/releases

Choose the package for your system:

- macOS
- Windows
- Linux

Extract the downloaded file.

## Run

Open the extracted folder and run the launcher:

```text
macOS:   Immich RAW Downloader.command
Windows: Immich RAW Downloader.cmd
Linux:   run-immich-raw-downloader.sh
```

Or run from source:

```bash
npm start
```

On first run, enter:

```text
Immich URL
Immich API key
Download destination
```

Example:

```text
Immich URL: http://immich.example.local:2283
Immich API key: your-api-key
Download destination: /Users/you/Pictures/RAW
```


## Configuration
Edit settings through the interactive CLI menu.

Or edit `.env` yourself:

```sh
cp .env.example .env
```

## Download sources

### Favorites

Download files based on your Immich favorite photos.


### Album

Download files based on a specific Immich album.

You can also select an album from the interactive menu.

## Download modes

### RAW only

Downloads matching RAW files. If no RAW match is found, the original selected image is downloaded as a fallback.

### Original only

Downloads the selected Immich image itself.

### Both

Downloads both the selected image and the matching RAW file when available.

## Download only new images

When enabled, the tool skips images that were already downloaded before. It tracks downloads in a local SQLite database (`download-history.db`). This is useful when you run the tool regularly and only want to pull newly favorited photos or newly added album photos, even if you edited or moved the local already downloaded files.



## Output folder

Files are saved into date-based folders using the computer's local timezone:

```text
DOWNLOAD_DESTINATION/
  2026-05-01/
    DSC01234.ARW
    DSC01235.ARW
  2026-05-02/
    DSC01320.ARW
```

## Command-line options

Preview what would be downloaded without writing files:

```bash
npm start -- --dry-run
```

Show detailed matching decisions:

```bash
npm start -- --verbose
```

Use a destination folder for one run:

```bash
npm start -- --dest /path/to/downloads
```

Show help:

```bash
npm start -- --help
```

Windows example:

```bat
npm start -- --dest C:\Users\you\Pictures\ImmichRaw
```

## Build

To create portable platform folders, run:

```bash
npm run build:bundles
```

Then run the script for your platform:

- `dist/immich-raw-downloader-macos/Run Immich RAW Downloader.command`
- `dist/immich-raw-downloader-linux/run-immich-raw-downloader.sh`
- `dist/immich-raw-downloader-windows/Run Immich RAW Downloader.cmd`

Each folder contains the app, a launcher, and a copy of `.env` if one exists.

## Development

Run from source:

```bash
git clone https://github.com/RauX333/immich-raw-downloader.git
cd immich-raw-downloader
npm install
npm start
```

Run tests:

```bash
npm test
```

Build release folders:

```bash
npm run build:bundles
```
