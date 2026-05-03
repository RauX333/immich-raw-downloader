import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  DEFAULT_PROFILE_NAME,
  DEFAULT_DOWNLOAD_MODE,
  DEFAULT_DOWNLOAD_SOURCE,
  DOWNLOAD_MODE_BOTH,
  DOWNLOAD_MODE_ORIGINAL,
  DOWNLOAD_MODE_RAW,
  DOWNLOAD_SOURCE_ALBUM,
  DOWNLOAD_SOURCE_FAVORITES,
  normalizeDownloadMode,
  normalizeDownloadSource,
  normalizeProfileName,
} from './config.js';
import { ensureExistingDirectory } from './fileUtils.js';
import { plainStyle, styleForStream } from './terminalStyle.js';

const BACK = Symbol('back');

export async function chooseRunConfig({
  immichUrl,
  apiKey,
  destination,
  downloadSource = DEFAULT_DOWNLOAD_SOURCE,
  albumId = null,
  downloadMode = DEFAULT_DOWNLOAD_MODE,
  profileName = DEFAULT_PROFILE_NAME,
  profiles = [],
  allowDestinationChange = true,
  listAlbums = null,
  inputStream = input,
  outputStream = output,
} = {}) {
  const current = {
    immichUrl,
    apiKey,
    destination: destination ? path.resolve(destination) : null,
    downloadSource: normalizeDownloadSource(downloadSource),
    albumId: normalizeAlbumIdInput(albumId),
    downloadMode: normalizeDownloadMode(downloadMode),
    profileName: normalizeProfileName(profileName),
  };
  const availableProfiles = normalizeProfiles(profiles, current);

  if (current.destination) {
    await ensureExistingDirectory(current.destination);
  }

  const style = styleForStream(outputStream);
  outputStream.write(formatRunConfig(current, { style }));
  const rl = readline.createInterface({ input: inputStream, output: outputStream });

  try {
    const completedInitialSetup = await promptForMissingRunConfig(
      rl,
      outputStream,
      current,
      listAlbums,
    );
    if (completedInitialSetup) {
      return current;
    }

    const action = await rl.question('Press Enter to continue planning, or type anything to edit settings: ');
    if (!action.trim()) {
      if (!current.destination) {
        current.destination = await promptForDestinationValue(rl, outputStream, current.destination);
      }
      return current;
    }

    await editRunConfigMenu({
      rl,
      outputStream,
      current,
      profiles: availableProfiles,
      allowDestinationChange,
      listAlbums,
    });
    await promptForMissingRunConfig(
      rl,
      outputStream,
      current,
      listAlbums,
      { allowDestinationChange },
    );

    return current;
  } finally {
    rl.close();
  }
}

async function editRunConfigMenu({
  rl,
  outputStream,
  current,
  profiles,
  allowDestinationChange,
  listAlbums,
}) {
  while (true) {
    const style = styleForStream(outputStream);
    outputStream.write(formatSettingsEditMenu(current, { allowDestinationChange, style }));
    const action = await rl.question('Choose a setting to edit, or press Enter when done: ');
    const selected = action.trim().toLowerCase();

    if (!selected || ['done', 'continue', 'c'].includes(selected)) {
      return;
    }

    if (['1', 'url', 'immich url'].includes(selected)) {
      const value = await promptForImmichUrl(rl, outputStream, current.immichUrl, { allowBack: true });
      if (value !== BACK) {
        current.immichUrl = value;
      }
    } else if (['2', 'key', 'api key'].includes(selected)) {
      const value = await promptForApiKey(rl, outputStream, current.apiKey, { allowBack: true });
      if (value !== BACK) {
        current.apiKey = value;
      }
    } else if (['3', 'profile', 'profiles', 'switch profile'].includes(selected)) {
      const profile = await promptForProfileSwitch(rl, outputStream, current, profiles);
      if (profile !== BACK) {
        upsertProfile(profiles, profile);
        applyProfileToCurrent(profile, current, { allowDestinationChange });
      }
    } else if (['4', 'destination', 'dest'].includes(selected)) {
      if (!allowDestinationChange) {
        outputStream.write(`${style.warning('Download destination is fixed for this run because --dest was used.')}\n`);
        continue;
      }
      const value = await promptForDestinationValue(
        rl,
        outputStream,
        current.destination,
        { allowBack: true },
      );
      if (value !== BACK) {
        current.destination = value;
      }
    } else if (['5', 'source', 'download source'].includes(selected)) {
      const previousSource = current.downloadSource;
      const previousAlbumId = current.albumId;
      const source = await promptForDownloadSource(rl, current.downloadSource, { allowBack: true });
      if (source === BACK) {
        continue;
      }
      current.downloadSource = source;
      if (current.downloadSource === DOWNLOAD_SOURCE_ALBUM) {
        const albumId = await promptForAlbumChoice(rl, outputStream, current, listAlbums, {
          allowBack: true,
        });
        if (albumId === BACK) {
          current.downloadSource = previousSource;
          current.albumId = previousAlbumId;
          continue;
        }
        current.albumId = albumId;
      }
    } else if (['6', 'mode', 'download mode'].includes(selected)) {
      const value = await promptForDownloadMode(rl, current.downloadMode, { allowBack: true });
      if (value !== BACK) {
        current.downloadMode = value;
      }
    } else if (['back', 'b', '0'].includes(selected)) {
      return;
    } else {
      outputStream.write(`${style.warning('Choose a listed setting number, or press Enter when done.')}\n`);
    }
  }
}

async function promptForProfileSwitch(rl, outputStream, current, profiles) {
  while (true) {
    const style = styleForStream(outputStream);
    outputStream.write(formatProfileSwitchMenu(current, profiles, { style }));
    const action = await rl.question('Choose a profile, create a profile, or press Enter to go back: ');
    const selected = action.trim().toLowerCase();

    if (!selected || ['back', 'b', '0'].includes(selected)) {
      return BACK;
    }

    if (['c', 'create', 'new'].includes(selected)) {
      const profile = await promptForNewProfile(rl, outputStream, current);
      if (profile !== BACK) {
        return profile;
      }
    } else {
      const profile = selectProfile(action, profiles, current);
      if (profile) {
        return profile;
      }
      outputStream.write(`${style.warning('Choose a profile number, type create, or press Enter to go back.')}\n`);
    }
  }
}

async function promptForMissingRunConfig(
  rl,
  outputStream,
  current,
  listAlbums,
  { allowDestinationChange = true } = {},
) {
  let prompted = false;

  if (!isValidImmichUrl(current.immichUrl)) {
    if (current.immichUrl) {
      outputStream.write('Immich URL must be a valid http:// or https:// URL.\n');
    }
    current.immichUrl = await promptForImmichUrl(rl, outputStream, current.immichUrl);
    prompted = true;
  }

  if (!isValidApiKey(current.apiKey)) {
    if (current.apiKey) {
      outputStream.write('Immich API key cannot be empty.\n');
    }
    current.apiKey = await promptForApiKey(rl, outputStream, current.apiKey);
    prompted = true;
  }

  if (!current.destination && allowDestinationChange) {
    current.destination = await promptForDestinationValue(rl, outputStream, current.destination);
    prompted = true;
  }

  if (current.downloadSource === DOWNLOAD_SOURCE_ALBUM && !current.albumId) {
    current.albumId = await promptForAlbumChoice(rl, outputStream, current, listAlbums);
    prompted = true;
  }

  return prompted;
}

export async function chooseImmichConnection({
  immichUrl,
  apiKey,
  allowChange = true,
  inputStream = input,
  outputStream = output,
} = {}) {
  const current = {
    immichUrl,
    apiKey,
  };

  validateImmichUrl(current.immichUrl);
  validateApiKey(current.apiKey);

  if (!allowChange) {
    return current;
  }

  const rl = readline.createInterface({ input: inputStream, output: outputStream });
  try {
    while (true) {
      const answer = await rl.question(`Immich URL [${current.immichUrl}]: `);
      const selectedUrl = answer.trim() || current.immichUrl;

      try {
        validateImmichUrl(selectedUrl);
        current.immichUrl = selectedUrl;
        break;
      } catch (error) {
        outputStream.write(`${error.message}\n`);
      }
    }

    while (true) {
      const answer = await rl.question(`Immich API key [${maskApiKey(current.apiKey)}]: `);
      const selectedApiKey = answer.trim() || current.apiKey;

      try {
        validateApiKey(selectedApiKey);
        current.apiKey = selectedApiKey;
        break;
      } catch (error) {
        outputStream.write(`${error.message}\n`);
      }
    }
  } finally {
    rl.close();
  }

  return current;
}

async function promptForImmichUrl(rl, outputStream, currentUrl, { allowBack = false } = {}) {
  while (true) {
    const backHint = allowBack ? ' (type back to return)' : '';
    const question = currentUrl
      ? `Immich URL [${currentUrl}]${backHint}: `
      : `Immich URL${backHint}: `;
    const answer = await rl.question(question);
    if (allowBack && isBackCommand(answer)) {
      return BACK;
    }
    const selectedUrl = answer.trim() || currentUrl;

    try {
      validateImmichUrl(selectedUrl);
      return selectedUrl;
    } catch (error) {
      outputStream.write(`${error.message}\n`);
    }
  }
}

async function promptForApiKey(rl, outputStream, currentApiKey, { allowBack = false } = {}) {
  while (true) {
    const backHint = allowBack ? ' (type back to return)' : '';
    const question = currentApiKey
      ? `Immich API key [${maskApiKey(currentApiKey)}]${backHint}: `
      : `Immich API key${backHint}: `;
    const answer = await rl.question(question);
    if (allowBack && isBackCommand(answer)) {
      return BACK;
    }
    const selectedApiKey = answer.trim() || currentApiKey;

    try {
      validateApiKey(selectedApiKey);
      return selectedApiKey;
    } catch (error) {
      outputStream.write(`${error.message}\n`);
    }
  }
}

async function promptForDestinationValue(
  rl,
  outputStream,
  currentDestination,
  { allowBack = false } = {},
) {
  while (true) {
    const backHint = allowBack ? ' (type back to return)' : '';
    const question = currentDestination
      ? `Download destination [${currentDestination}]${backHint}: `
      : `Download destination${backHint}: `;
    const answer = await rl.question(question);
    if (allowBack && isBackCommand(answer)) {
      return BACK;
    }
    const trimmed = answer.trim();
    const selected = trimmed ? path.resolve(trimmed) : currentDestination;

    if (!selected) {
      outputStream.write('Please enter a folder path.\n');
      continue;
    }

    try {
      await ensureExistingDirectory(selected);
      return selected;
    } catch (error) {
      outputStream.write(`${error.message}\n`);
    }
  }
}

async function promptForDownloadSource(rl, currentSource, { allowBack = false } = {}) {
  while (true) {
    const currentLabel = formatDownloadSource(currentSource);
    const backHint = allowBack ? ', or back' : '';
    const answer = await rl.question(`Download source [${currentLabel}] (1=favorites, 2=album${backHint}): `);
    if (allowBack && isBackCommand(answer)) {
      return BACK;
    }
    const selected = normalizeDownloadSourceInput(answer, currentSource);
    if (selected) {
      return selected;
    }
  }
}

async function promptForDownloadMode(rl, currentMode, { allowBack = false } = {}) {
  while (true) {
    const currentLabel = formatDownloadMode(currentMode);
    const backHint = allowBack ? ', or back' : '';
    const answer = await rl.question(`Download mode [${currentLabel}] (1=raw, 2=original, 3=both${backHint}): `);
    if (allowBack && isBackCommand(answer)) {
      return BACK;
    }
    const selected = normalizeDownloadModeInput(answer, currentMode);
    if (selected) {
      return selected;
    }
  }
}

async function promptForAlbumId(rl, outputStream, currentAlbumId, { allowBack = false } = {}) {
  while (true) {
    const backHint = allowBack ? ' (type back to return)' : '';
    const question = currentAlbumId
      ? `Immich album ID or URL [${currentAlbumId}]${backHint}: `
      : `Immich album ID or URL${backHint}: `;
    const answer = await rl.question(question);
    if (allowBack && isBackCommand(answer)) {
      return BACK;
    }
    const selected = normalizeAlbumIdInput(answer) || currentAlbumId;

    if (selected) {
      return selected;
    }

    outputStream.write('Please enter an Immich album ID or album URL.\n');
  }
}

async function promptForAlbumChoice(
  rl,
  outputStream,
  current,
  listAlbums,
  { allowBack = false } = {},
) {
  if (!listAlbums) {
    return promptForAlbumId(rl, outputStream, current.albumId, { allowBack });
  }

  let albums = [];
  try {
    outputStream.write('Loading Immich albums...\n');
    albums = await listAlbums({
      immichUrl: current.immichUrl,
      apiKey: current.apiKey,
    });
  } catch (error) {
    outputStream.write(`Could not load albums: ${error.message}\n`);
    return promptForAlbumId(rl, outputStream, current.albumId, { allowBack });
  }

  if (!Array.isArray(albums) || albums.length === 0) {
    outputStream.write('No Immich albums were found.\n');
    return promptForAlbumId(rl, outputStream, current.albumId, { allowBack });
  }

  outputStream.write(formatAlbumChoices(albums));

  while (true) {
    const currentAlbum = albums.find((album) => album.id === current.albumId);
    const currentLabel = currentAlbum
      ? `${getAlbumName(currentAlbum)}`
      : current.albumId;
    const backHint = allowBack ? ', or back' : '';
    const question = currentLabel
      ? `Choose album [${currentLabel}]${backHint}: `
      : `Choose album${backHint}: `;
    const answer = await rl.question(question);
    if (allowBack && isBackCommand(answer)) {
      return BACK;
    }
    const selected = selectAlbumId(answer, albums, current.albumId);

    if (selected) {
      return selected;
    }

    outputStream.write('Choose an album number, or paste an Immich album ID or URL.\n');
  }
}

function formatAlbumChoices(albums) {
  const lines = ['', 'Immich albums'];
  albums.forEach((album, index) => {
    const count = Number.isFinite(album.assetCount) ? `, ${album.assetCount} assets` : '';
    lines.push(`  ${index + 1}. ${getAlbumName(album)}${count}`);
  });
  lines.push('');
  return lines.join('\n');
}

function selectAlbumId(value, albums, currentAlbumId) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return currentAlbumId || null;
  }

  const number = Number(trimmed);
  if (Number.isInteger(number) && number >= 1 && number <= albums.length) {
    return albums[number - 1].id;
  }

  const matchingAlbum = albums.find((album) => album.id === trimmed);
  if (matchingAlbum) {
    return matchingAlbum.id;
  }

  return normalizeAlbumIdInput(trimmed);
}

function getAlbumName(album) {
  return album.albumName || album.name || 'Untitled album';
}

export async function chooseDestination({
  providedDestination = null,
  allowChange = true,
  inputStream = input,
  outputStream = output,
} = {}) {
  const resolvedProvidedDestination = providedDestination
    ? path.resolve(providedDestination)
    : null;

  if (resolvedProvidedDestination) {
    await ensureExistingDirectory(resolvedProvidedDestination);
  }

  if (resolvedProvidedDestination && !allowChange) {
    return resolvedProvidedDestination;
  }

  const rl = readline.createInterface({ input: inputStream, output: outputStream });
  try {
    while (true) {
      const question = resolvedProvidedDestination
        ? `Download destination [${resolvedProvidedDestination}]: `
        : 'Download destination: ';
      const answer = await rl.question(question);
      const trimmed = answer.trim();
      const selected = trimmed ? path.resolve(trimmed) : resolvedProvidedDestination;

      if (!selected) {
        outputStream.write('Please enter a folder path.\n');
        continue;
      }

      try {
        await ensureExistingDirectory(selected);
        return selected;
      } catch (error) {
        outputStream.write(`${error.message}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

export async function confirmDownloadPlan({
  question = 'Start download? [y/N] ',
  inputStream = input,
  outputStream = output,
} = {}) {
  const rl = readline.createInterface({ input: inputStream, output: outputStream });
  try {
    const answer = await rl.question(question);
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}

export function maskApiKey(apiKey) {
  if (!apiKey) {
    return 'not set';
  }

  if (apiKey.length <= 8) {
    return '*'.repeat(apiKey.length);
  }

  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

export function formatRunConfig({
  immichUrl,
  apiKey,
  destination,
  downloadSource = DEFAULT_DOWNLOAD_SOURCE,
  albumId = null,
  downloadMode = DEFAULT_DOWNLOAD_MODE,
  profileName = DEFAULT_PROFILE_NAME,
}, { style = plainStyle } = {}) {
  const source = normalizeDownloadSource(downloadSource);
  const mode = normalizeDownloadMode(downloadMode);
  const lines = [
    '',
    style.heading('Current settings'),
    formatSettingLine('Active profile', formatProfileLabel({ name: profileName }), style, { profile: true }),
    formatSettingLine('Immich URL', immichUrl || 'not set', style),
    formatSettingLine('Immich API key', maskApiKey(apiKey), style),
    formatSettingLine('Download destination', destination || 'not set', style),
    formatSettingLine('Download source', formatDownloadSource(source), style),
    formatSettingLine('Download mode', formatDownloadMode(mode), style),
  ];

  if (source === DOWNLOAD_SOURCE_ALBUM || albumId) {
    lines.push(formatSettingLine('Immich album ID', albumId || 'not set', style));
  }

  lines.push('');

  return lines.join('\n');
}

function formatSettingsEditMenu(current, { allowDestinationChange, style = plainStyle }) {
  const destinationLabel = allowDestinationChange
    ? current.destination || 'not set'
    : `${current.destination || 'not set'} (fixed for this run)`;
  const lines = [
    '',
    style.heading('Settings menu'),
    formatMenuLine(1, 'Immich URL', current.immichUrl || 'not set', style),
    formatMenuLine(2, 'Immich API key', maskApiKey(current.apiKey), style),
    '',
    `  ${style.muted('Now use profile')} ${style.profile(formatProfileLabel(current))}`,
    formatMenuCommand(3, 'Switch profile', style),
    '',
    style.heading('Profile settings'),
    formatMenuLine(4, 'Download destination', destinationLabel, style),
    formatMenuLine(5, 'Download source', formatDownloadSource(current.downloadSource), style),
    formatMenuLine(6, 'Download mode', formatDownloadMode(current.downloadMode), style),
  ];

  if (normalizeDownloadSource(current.downloadSource) === DOWNLOAD_SOURCE_ALBUM || current.albumId) {
    lines.push(formatSettingLine('Immich album ID', current.albumId || 'not set', style, { indent: '     ' }));
  }

  lines.push(formatMenuCommand(0, 'Back', style));
  lines.push('');
  lines.push(style.muted('Type back inside any setting prompt to return to this menu.'));
  lines.push('');

  return lines.join('\n');
}

function formatProfileSwitchMenu(current, profiles, { style = plainStyle } = {}) {
  const lines = [
    '',
    style.heading('Switch profile'),
    `  ${style.muted('Now use profile')} ${style.profile(formatProfileLabel(current))}`,
    style.heading('Available profiles'),
  ];

  profiles.forEach((profile, index) => {
    const marker = sameProfile(profile, current) ? '*' : ' ';
    const label = marker === '*'
      ? style.profile(formatProfileLabel(profile))
      : style.value(formatProfileLabel(profile));
    lines.push(`  ${style.accent(`${index + 1}.`)} ${marker} ${label} ${style.muted('-')} ${formatProfileSummary(profile, style)}`);
  });

  lines.push('');
  lines.push(`  ${style.accent('c.')} ${style.label('Create profile from current settings')}`);
  lines.push(formatMenuCommand(0, 'Back', style));
  lines.push('');

  return lines.join('\n');
}

function formatSettingLine(label, value, style, { indent = '  ', profile = false } = {}) {
  const formattedValue = profile ? style.profile(value) : style.value(value);
  return `${indent}${style.label(`${label}:`)} ${formattedValue}`;
}

function formatMenuLine(number, label, value, style) {
  return `  ${style.accent(`${number}.`)} ${style.label(`${label}:`)} ${style.value(value)}`;
}

function formatMenuCommand(number, label, style) {
  return `  ${style.accent(`${number}.`)} ${style.label(label)}`;
}

function selectProfile(value, profiles, current) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return profiles.find((profile) => sameProfile(profile, current)) || null;
  }

  const number = Number(trimmed);
  if (Number.isInteger(number) && number >= 1 && number <= profiles.length) {
    return profiles[number - 1];
  }

  const name = normalizeProfileName(trimmed.includes('/') ? trimmed.split('/').pop() : trimmed);
  return profiles.find((profile) => profile.name === name) || null;
}

async function promptForNewProfile(rl, outputStream, current) {
  while (true) {
    const answer = await rl.question('New profile name (type back to return): ');
    if (isBackCommand(answer)) {
      return BACK;
    }

    const name = normalizeProfileName(answer);
    if (name === DEFAULT_PROFILE_NAME && answer.trim().toLowerCase() !== DEFAULT_PROFILE_NAME) {
      outputStream.write('Please enter a profile name using letters, numbers, spaces, dashes, or underscores.\n');
      continue;
    }

    return {
      name,
      downloadDestination: current.destination,
      downloadSource: current.downloadSource,
      albumId: current.albumId,
      downloadMode: current.downloadMode,
    };
  }
}

function applyProfileToCurrent(profile, current, { allowDestinationChange }) {
  current.profileName = profile.name;
  if (allowDestinationChange) {
    current.destination = profile.downloadDestination ? path.resolve(profile.downloadDestination) : null;
  }
  current.downloadSource = normalizeDownloadSource(profile.downloadSource);
  current.albumId = normalizeAlbumIdInput(profile.albumId);
  current.downloadMode = normalizeDownloadMode(profile.downloadMode);
}

function normalizeProfiles(profiles, current) {
  const normalized = profiles.map((profile) => ({
    name: normalizeProfileName(profile.profileName || profile.name),
    downloadDestination: profile.downloadDestination || profile.destination || null,
    downloadSource: normalizeDownloadSource(profile.downloadSource),
    albumId: normalizeAlbumIdInput(profile.albumId),
    downloadMode: normalizeDownloadMode(profile.downloadMode),
  }));
  upsertProfile(normalized, {
    name: current.profileName,
    downloadDestination: current.destination,
    downloadSource: current.downloadSource,
    albumId: current.albumId,
    downloadMode: current.downloadMode,
  });
  return normalized.sort(compareProfiles);
}

function upsertProfile(profiles, profile) {
  const next = {
    name: normalizeProfileName(profile.name),
    downloadDestination: profile.downloadDestination || null,
    downloadSource: normalizeDownloadSource(profile.downloadSource),
    albumId: normalizeAlbumIdInput(profile.albumId),
    downloadMode: normalizeDownloadMode(profile.downloadMode),
  };
  const index = profiles.findIndex((candidate) => sameProfile(candidate, next));
  if (index === -1) {
    profiles.push(next);
  } else {
    profiles[index] = next;
  }
  profiles.sort(compareProfiles);
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

function sameProfile(profile, current) {
  return profile.name === normalizeProfileName(current.profileName || current.name);
}

function formatProfileLabel(profile) {
  const name = normalizeProfileName(profile.profileName || profile.name);
  return name;
}

function formatProfileSummary(profile, style = plainStyle) {
  const destination = profile.downloadDestination || profile.destination || 'not set';
  return [
    style.value(destination),
    style.accent(formatDownloadSource(profile.downloadSource)),
    style.accent(formatDownloadMode(profile.downloadMode)),
  ].join(style.muted(', '));
}

export function formatDownloadSource(source) {
  return normalizeDownloadSource(source) === DOWNLOAD_SOURCE_ALBUM ? 'album' : 'favorites';
}

export function formatDownloadMode(mode) {
  const normalized = normalizeDownloadMode(mode);
  if (normalized === DOWNLOAD_MODE_ORIGINAL) {
    return 'original';
  }
  if (normalized === DOWNLOAD_MODE_BOTH) {
    return 'both';
  }

  return 'raw';
}

export function normalizeAlbumIdInput(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    const albumIndex = segments.findIndex((segment) => segment.toLowerCase() === 'albums');
    if (albumIndex !== -1 && segments[albumIndex + 1]) {
      return segments[albumIndex + 1];
    }
  } catch {
    // Plain album IDs land here.
  }

  return trimmed;
}

function normalizeDownloadSourceInput(value, currentSource) {
  const answer = String(value || '').trim().toLowerCase();
  if (!answer) {
    return normalizeDownloadSource(currentSource);
  }

  if (['f', 'favorite', 'favorites', '1'].includes(answer)) {
    return DOWNLOAD_SOURCE_FAVORITES;
  }

  if (['a', 'album', 'albums', '2'].includes(answer)) {
    return DOWNLOAD_SOURCE_ALBUM;
  }

  return null;
}

function normalizeDownloadModeInput(value, currentMode) {
  const answer = String(value || '').trim().toLowerCase();
  if (!answer) {
    return normalizeDownloadMode(currentMode);
  }

  if (['r', 'raw', 'raws', '1'].includes(answer)) {
    return DOWNLOAD_MODE_RAW;
  }

  if (['o', 'original', 'originals', 'image', 'images', '2'].includes(answer)) {
    return DOWNLOAD_MODE_ORIGINAL;
  }
  if (['b', 'both', 'all', '3'].includes(answer)) {
    return DOWNLOAD_MODE_BOTH;
  }

  return null;
}

function isBackCommand(value) {
  return ['back', 'b', '0'].includes(String(value || '').trim().toLowerCase());
}

function validateImmichUrl(value) {
  if (!value || !value.trim()) {
    throw new Error('Immich URL cannot be empty.');
  }

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error('Immich URL must be a valid http:// or https:// URL.');
  }
}

function validateApiKey(value) {
  if (!value || !value.trim()) {
    throw new Error('Immich API key cannot be empty.');
  }
}

function isValidImmichUrl(value) {
  try {
    validateImmichUrl(value);
    return true;
  } catch {
    return false;
  }
}

function isValidApiKey(value) {
  try {
    validateApiKey(value);
    return true;
  } catch {
    return false;
  }
}
