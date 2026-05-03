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
import { styleForStream } from './terminalStyle.js';

export async function runCli(argv = process.argv.slice(2)) {
  loadDotenv();
  const options = parseArgs(argv);
  const style = styleForStream(process.stdout);

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
    profileName: config.profileName,
    profiles: config.profiles,
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
    profileName: runConfig.profileName,
  });
  const client = new ImmichClient({
    baseUrl: runConfig.immichUrl,
    apiKey: runConfig.apiKey,
    requestTimeoutMs: config.requestTimeoutMs,
    downloadIdleTimeoutMs: config.downloadIdleTimeoutMs,
  });

  console.log(`${style.label('Immich URL:')} ${style.value(runConfig.immichUrl)}`);
  console.log(`${style.label('Download destination:')} ${style.value(runConfig.destination)}`);
  console.log(`${style.label('Download source:')} ${style.value(runConfig.downloadSource === 'album' ? 'Immich album' : 'favorite images')}`);
  console.log(`${style.label('Download mode:')} ${style.value(formatRunDownloadMode(runConfig.downloadMode))}`);
  console.log(`${style.label('Profile:')} ${style.profile(runConfig.profileName)}`);
  console.log(style.muted('Planning download...'));
  const plan = await planDownloads({
    client,
    destination: runConfig.destination,
    verbose: options.verbose,
    downloadSource: runConfig.downloadSource,
    albumId: runConfig.albumId,
    downloadMode: runConfig.downloadMode,
  });
  console.log(formatDownloadPlan(plan, { style }));

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
      console.log(style.warning('Download cancelled.'));
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

  console.log(formatSummary(summary, { dryRun: options.dryRun, style }));

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
