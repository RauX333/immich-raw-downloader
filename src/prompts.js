import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ensureExistingDirectory } from './fileUtils.js';

export async function chooseRunConfig({
  immichUrl,
  apiKey,
  destination,
  allowDestinationChange = true,
  inputStream = input,
  outputStream = output,
} = {}) {
  const current = {
    immichUrl,
    apiKey,
    destination: destination ? path.resolve(destination) : null,
  };

  validateImmichUrl(current.immichUrl);
  validateApiKey(current.apiKey);
  if (current.destination) {
    await ensureExistingDirectory(current.destination);
  }

  outputStream.write(formatRunConfig(current));
  const rl = readline.createInterface({ input: inputStream, output: outputStream });

  try {
    const action = await rl.question('Press Enter to continue planning, or type anything to edit settings: ');
    if (!action.trim()) {
      if (!current.destination) {
        current.destination = await promptForDestinationValue(rl, outputStream, current.destination);
      }
      return current;
    }

    current.immichUrl = await promptForImmichUrl(rl, outputStream, current.immichUrl);
    current.apiKey = await promptForApiKey(rl, outputStream, current.apiKey);

    if (allowDestinationChange) {
      current.destination = await promptForDestinationValue(rl, outputStream, current.destination);
    }

    return current;
  } finally {
    rl.close();
  }
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

async function promptForImmichUrl(rl, outputStream, currentUrl) {
  while (true) {
    const answer = await rl.question(`Immich URL [${currentUrl}]: `);
    const selectedUrl = answer.trim() || currentUrl;

    try {
      validateImmichUrl(selectedUrl);
      return selectedUrl;
    } catch (error) {
      outputStream.write(`${error.message}\n`);
    }
  }
}

async function promptForApiKey(rl, outputStream, currentApiKey) {
  while (true) {
    const answer = await rl.question(`Immich API key [${maskApiKey(currentApiKey)}]: `);
    const selectedApiKey = answer.trim() || currentApiKey;

    try {
      validateApiKey(selectedApiKey);
      return selectedApiKey;
    } catch (error) {
      outputStream.write(`${error.message}\n`);
    }
  }
}

async function promptForDestinationValue(rl, outputStream, currentDestination) {
  while (true) {
    const question = currentDestination
      ? `Download destination [${currentDestination}]: `
      : 'Download destination: ';
    const answer = await rl.question(question);
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

export function formatRunConfig({ immichUrl, apiKey, destination }) {
  return [
    '',
    'Current settings',
    `  Immich URL: ${immichUrl}`,
    `  Immich API key: ${maskApiKey(apiKey)}`,
    `  Download destination: ${destination || 'not set'}`,
    '',
  ].join('\n');
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
