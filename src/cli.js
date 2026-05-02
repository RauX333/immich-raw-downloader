import {
  helpText,
  loadDotenv,
  parseArgs,
  readConfigFromEnv,
  saveConfigToEnv,
} from './config.js';
import { ImmichClient } from './immichClient.js';
import {
  executeDownloadPlan,
  formatDownloadPlan,
  formatSummary,
  planDownloads,
  planToSummary,
} from './planner.js';
import { ProgressReporter } from './progress.js';
import { chooseRunConfig, confirmDownloadPlan } from './prompts.js';

export async function runCli(argv = process.argv.slice(2)) {
  loadDotenv();
  const options = parseArgs(argv);

  if (options.help) {
    console.log(helpText());
    return;
  }

  const config = readConfigFromEnv();
  const runConfig = await chooseRunConfig({
    immichUrl: config.immichUrl,
    apiKey: config.apiKey,
    destination: options.destination || config.downloadDestination,
    downloadSource: config.downloadSource,
    albumId: config.albumId,
    downloadMode: config.downloadMode,
    allowDestinationChange: !options.destination,
    listAlbums: async ({ immichUrl, apiKey }) => {
      const settingsClient = new ImmichClient({
        baseUrl: immichUrl,
        apiKey,
        requestTimeoutMs: config.requestTimeoutMs,
        downloadIdleTimeoutMs: config.downloadIdleTimeoutMs,
      });
      return settingsClient.listAlbums();
    },
  });
  await saveConfigToEnv({
    immichUrl: runConfig.immichUrl,
    apiKey: runConfig.apiKey,
    downloadDestination: options.destination ? undefined : runConfig.destination,
    downloadSource: runConfig.downloadSource,
    albumId: runConfig.albumId,
    downloadMode: runConfig.downloadMode,
  });
  const client = new ImmichClient({
    baseUrl: runConfig.immichUrl,
    apiKey: runConfig.apiKey,
    requestTimeoutMs: config.requestTimeoutMs,
    downloadIdleTimeoutMs: config.downloadIdleTimeoutMs,
  });

  console.log(`immich url: ${runConfig.immichUrl}`);
  console.log(`download destination: ${runConfig.destination}`);
  console.log(`download source: ${runConfig.downloadSource === 'album' ? 'Immich album' : 'favorite images'}`);
  console.log(`download mode: ${formatRunDownloadMode(runConfig.downloadMode)}`);
  console.log('Planning download...');
  const plan = await planDownloads({
    client,
    destination: runConfig.destination,
    verbose: options.verbose,
    downloadSource: runConfig.downloadSource,
    albumId: runConfig.albumId,
    downloadMode: runConfig.downloadMode,
  });
  console.log(formatDownloadPlan(plan));

  let summary;
  if (options.dryRun) {
    summary = planToSummary(plan);
  } else if (plan.plannedDownloads.length === 0) {
    summary = await executeDownloadPlan({
      client,
      plan,
      maxAttempts: config.downloadMaxAttempts,
      downloadIdleTimeoutMs: config.downloadIdleTimeoutMs,
    });
  } else {
    const confirmed = await confirmDownloadPlan();
    if (!confirmed) {
      console.log('Download cancelled.');
      return;
    }

    summary = await executeDownloadPlan({
      client,
      plan,
      progressReporter: new ProgressReporter(),
      maxAttempts: config.downloadMaxAttempts,
      downloadIdleTimeoutMs: config.downloadIdleTimeoutMs,
    });
  }

  console.log(formatSummary(summary, { dryRun: options.dryRun }));

  if (summary.failures.length > 0) {
    process.exitCode = 1;
  }
}

function formatRunDownloadMode(downloadMode) {
  if (downloadMode === 'original') {
    return 'original images';
  }
  if (downloadMode === 'both') {
    return 'RAW versions and original images';
  }

  return 'RAW versions';
}
