import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  DEFAULT_PROFILE_NAME,
  DOWNLOAD_MODE_BOTH,
  DOWNLOAD_MODE_ORIGINAL,
  DOWNLOAD_MODE_RAW,
  DOWNLOAD_SOURCE_ALBUM,
  normalizeAlbumIdInput,
  normalizeDownloadMode,
  normalizeDownloadOnlyNew,
  normalizeDownloadSource,
  normalizeProfileName,
} from './config.js';
import { plainStyle, styleForStream } from './terminalStyle.js';

const BACK = Symbol('back');

export function normalizeProfiles(profiles, current) {
  const normalized = profiles.map((profile) => ({
    name: normalizeProfileName(profile.profileName || profile.name),
    profileId: profile.profileId || null,
    downloadDestination: profile.downloadDestination || profile.destination || null,
    downloadSource: normalizeDownloadSource(profile.downloadSource),
    albumId: normalizeAlbumIdInput(profile.albumId),
    downloadMode: normalizeDownloadMode(profile.downloadMode),
    downloadOnlyNew: normalizeDownloadOnlyNew(profile.downloadOnlyNew),
  }));
  upsertProfile(normalized, {
    name: current.profileName,
    profileId: current.profileId,
    downloadDestination: current.destination,
    downloadSource: current.downloadSource,
    albumId: current.albumId,
    downloadMode: current.downloadMode,
    downloadOnlyNew: current.downloadOnlyNew,
  });
  return normalized.sort(compareProfiles);
}

export function upsertProfile(profiles, profile) {
  const next = {
    name: normalizeProfileName(profile.name),
    profileId: profile.profileId || null,
    downloadDestination: profile.downloadDestination || null,
    downloadSource: normalizeDownloadSource(profile.downloadSource),
    albumId: normalizeAlbumIdInput(profile.albumId),
    downloadMode: normalizeDownloadMode(profile.downloadMode),
    downloadOnlyNew: normalizeDownloadOnlyNew(profile.downloadOnlyNew),
  };
  const index = profiles.findIndex((candidate) => sameProfile(candidate, next));
  if (index === -1) {
    profiles.push(next);
  } else {
    profiles[index] = next;
  }
  profiles.sort(compareProfiles);
}

export function compareProfiles(left, right) {
  if (left.name === DEFAULT_PROFILE_NAME) {
    return -1;
  }
  if (right.name === DEFAULT_PROFILE_NAME) {
    return 1;
  }
  return left.name.localeCompare(right.name);
}

export function sameProfile(profile, current) {
  return profile.name === normalizeProfileName(current.profileName || current.name);
}

export function formatProfileLabel(profile) {
  return normalizeProfileName(profile.profileName || profile.name);
}

export function formatProfileSummary(profile, style = plainStyle) {
  const destination = profile.downloadDestination || profile.destination || 'not set';
  return [
    style.value(destination),
    style.accent(formatProfileDownloadSource(profile.downloadSource)),
    style.accent(formatProfileDownloadMode(profile.downloadMode)),
  ].join(style.muted(', '));
}

function formatProfileDownloadSource(source) {
  return normalizeDownloadSource(source) === DOWNLOAD_SOURCE_ALBUM ? 'album' : 'favorites';
}

function formatProfileDownloadMode(mode) {
  const normalized = normalizeDownloadMode(mode);
  if (normalized === DOWNLOAD_MODE_ORIGINAL) {
    return 'original';
  }
  if (normalized === DOWNLOAD_MODE_BOTH) {
    return 'both';
  }
  return 'raw';
}

export function selectProfile(value, profiles, current) {
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

export function applyProfileToCurrent(profile, current, { allowDestinationChange }) {
  current.profileName = profile.name;
  current.profileId = profile.profileId || current.profileId;
  if (allowDestinationChange) {
    current.destination = profile.downloadDestination ? path.resolve(profile.downloadDestination) : null;
  }
  current.downloadSource = normalizeDownloadSource(profile.downloadSource);
  current.albumId = normalizeAlbumIdInput(profile.albumId);
  current.downloadMode = normalizeDownloadMode(profile.downloadMode);
  current.downloadOnlyNew = normalizeDownloadOnlyNew(profile.downloadOnlyNew);
}

export async function promptForProfileSwitch(rl, outputStream, current, profiles) {
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
    } else if (selected.startsWith('d.') || selected.startsWith('delete')) {
      const deleteTarget = selected.replace(/^(d\.|delete\s*)/, '').trim();
      const profile = selectProfile(deleteTarget, profiles, current);
      if (profile && profile.name !== DEFAULT_PROFILE_NAME) {
        return { action: 'delete', profile };
      }
      outputStream.write(`${style.warning('Choose a valid profile number to delete (cannot delete the default profile).')}\n`);
    } else {
      const profile = selectProfile(action, profiles, current);
      if (profile) {
        return profile;
      }
      outputStream.write(`${style.warning('Choose a profile number, type create, d.<number> to delete, or press Enter to go back.')}\n`);
    }
  }
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
      profileId: current.profileId,
      downloadDestination: current.destination,
      downloadSource: current.downloadSource,
      albumId: current.albumId,
      downloadMode: current.downloadMode,
      downloadOnlyNew: current.downloadOnlyNew,
    };
  }
}

export async function promptForDeleteProfile(rl, outputStream, profile) {
  const answer = await rl.question(`Delete profile "${profile.name}" and its download history? [y/N] `);
  return ['y', 'yes'].includes(answer.trim().toLowerCase());
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
  lines.push(`  ${style.accent('d.<number>')} ${style.label('Delete a profile')}`);
  lines.push(`  ${style.accent('0.')} ${style.label('Back')}`);
  lines.push('');

  return lines.join('\n');
}

function isBackCommand(value) {
  return ['back', 'b', '0'].includes(String(value || '').trim().toLowerCase());
}
