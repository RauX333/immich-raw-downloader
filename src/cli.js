import path from 'node:path';
import {
  helpText,
  loadDotenv,
  parseArgs,
  readConfigFromEnv,
  saveConfigToEnv,
  generateProfileId,
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
import {
  initDownloadHistory,
  saveAndCloseDownloadHistory,
  saveDownloadHistorySync,
  closeDownloadHistory,
  clearProfileHistory,
  getHistoryCount,
  resolveDbPath,
  DownloadHistoryError,
} from './downloadHistory.js';
import { initLogger, resolveLogPath, closeLogger, setConsoleLogLevel } from './logger.js';
import * as log from './logger.js';

export async function runCli(argv = process.argv.slice(2)) {
  loadDotenv();
  const options = parseArgs(argv);
  const style = styleForStream(process.stdout);

  const envPath = path.resolve(process.cwd(), '.env');
  const logPath = resolveLogPath(envPath);
  initLogger({ filePath: logPath });

  const config = readConfigFromEnv();
  if (config.logLevel) {
    setConsoleLogLevel(config.logLevel);
  }

  log.info('cli', 'Application starting', { args: argv });

  if (options.help) {
    console.log(helpText());
    return;
  }

  const dbPath = resolveDbPath(envPath);
  let historyDb = null;
  try {
    historyDb = await initDownloadHistory(dbPath);
    log.info('cli', 'Download history initialized', { dbPath });
  } catch (error) {
    log.error('cli', 'Failed to init download history', { error: error.message });
    if (error instanceof DownloadHistoryError) {
      console.log(style.warning(error.message));
    } else {
      console.log(style.warning(`Download history unavailable: ${error.message}`));
    }
  }

  let shuttingDown = false;
  const onSigInt = () => {
    if (shuttingDown) {
      log.warn('cli', 'Force exit on second SIGINT');
      process.exit(1);
    }
    shuttingDown = true;
    log.warn('cli', 'SIGINT received, saving download history');
    console.log(style.warning('\nInterrupted. Saving download history...'));
    if (historyDb) {
      try {
        saveDownloadHistorySync(historyDb);
        closeDownloadHistory(historyDb);
        log.info('cli', 'History saved on interrupt');
        console.log(style.value('History saved.'));
      } catch (err) {
        log.error('cli', 'Failed to save history on interrupt', { error: err.message });
      }
      historyDb = null;
    }
    process.exit(1);
  };
  process.on('SIGINT', onSigInt);

  const clearHistoryFn = historyDb
    ? async (profileId) => { clearProfileHistory(historyDb, profileId); }
    : null;

  const activeProfile = config.profiles.find((p) => p.name === config.profileName);
  const profileId = activeProfile?.profileId || config.profileId || null;

  const runConfig = await chooseRunConfig({
    immichUrl: config.immichUrl,
    apiKey: config.apiKey,
    destination: options.destination || config.downloadDestination,
    downloadSource: config.downloadSource,
    albumId: config.albumId,
    downloadMode: config.downloadMode,
    downloadOnlyNew: config.downloadOnlyNew,
    profileId,
    profileName: config.profileName,
    profiles: config.profiles,
    logLevel: config.logLevel,
    allowDestinationChange: !options.destination,
    onLogLevelChange: setConsoleLogLevel,
    listAlbums: async ({ immichUrl, apiKey }) => {
      const settingsClient = new ImmichClient({
        baseUrl: immichUrl,
        apiKey,
        requestTimeoutMs: config.requestTimeoutMs,
        downloadIdleTimeoutMs: config.downloadIdleTimeoutMs,
      });
      return settingsClient.listAlbums();
    },
    clearHistoryFn,
  });

  const resolvedProfileId = runConfig.profileId || generateProfileId();
  runConfig.profileId = resolvedProfileId;

  await saveConfigToEnv({
    immichUrl: runConfig.immichUrl,
    apiKey: runConfig.apiKey,
    downloadDestination: options.destination ? undefined : runConfig.destination,
    downloadSource: runConfig.downloadSource,
    albumId: runConfig.albumId,
    downloadMode: runConfig.downloadMode,
    downloadOnlyNew: runConfig.downloadOnlyNew,
    profileId: resolvedProfileId,
    profileName: runConfig.profileName,
    logLevel: runConfig.logLevel,
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
  console.log(`${style.label('Download only new:')} ${style.value(runConfig.downloadOnlyNew ? 'on' : 'off')}`);

  if (historyDb && resolvedProfileId) {
    const count = getHistoryCount(historyDb, resolvedProfileId);
    console.log(`${style.label('History:')} ${style.muted(`${count} previously downloaded asset${count === 1 ? '' : 's'} in this profile`)}`);
  }

  console.log(style.muted('Planning download...'));
  log.info('cli', 'Planning downloads', {
    destination: runConfig.destination,
    source: runConfig.downloadSource,
    mode: runConfig.downloadMode,
    downloadOnlyNew: runConfig.downloadOnlyNew,
  });
  const plan = await planDownloads({
    client,
    destination: runConfig.destination,
    verbose: options.verbose,
    downloadSource: runConfig.downloadSource,
    albumId: runConfig.albumId,
    downloadMode: runConfig.downloadMode,
    downloadOnlyNew: runConfig.downloadOnlyNew,
    historyDb,
    profileId: resolvedProfileId,
  });
  log.info('cli', 'Plan created', {
    planned: plan.plannedDownloads.length,
    skipped: plan.skippedExisting,
    skippedByHistory: plan.skippedByHistory,
    failures: plan.failures.length,
  });
  console.log(formatDownloadPlan(plan, { style }));

  let summary;
  if (options.dryRun) {
    log.info('cli', 'Dry run mode, skipping execution');
    summary = planToSummary(plan);
  } else if (plan.plannedDownloads.length === 0) {
    log.info('cli', 'No planned downloads, executing with empty plan');
    summary = await executeDownloadPlan({
      client,
      plan,
      maxAttempts: config.downloadMaxAttempts,
      downloadIdleTimeoutMs: config.downloadIdleTimeoutMs,
      historyDb,
      profileId: resolvedProfileId,
      dryRun: options.dryRun,
    });
  } else {
    const confirmed = await confirmDownloadPlan();
    if (!confirmed) {
      log.info('cli', 'Download cancelled by user');
      if (historyDb) {
        await saveAndCloseDownloadHistory(historyDb);
      }
      console.log(style.warning('Download cancelled.'));
      closeLogger();
      return;
    }

    log.info('cli', 'Starting download execution', { total: plan.plannedDownloads.length });
    summary = await executeDownloadPlan({
      client,
      plan,
      progressReporter: new ProgressReporter(),
      maxAttempts: config.downloadMaxAttempts,
      downloadIdleTimeoutMs: config.downloadIdleTimeoutMs,
      historyDb,
      profileId: resolvedProfileId,
      dryRun: options.dryRun,
    });
  }

  if (historyDb) {
    log.info('cli', 'Final save and close of download history');
    await saveAndCloseDownloadHistory(historyDb);
    historyDb = null;
  }

  process.removeListener('SIGINT', onSigInt);

  console.log(formatSummary(summary, { dryRun: options.dryRun, style }));

  log.info('cli', 'Application finished', {
    downloaded: summary.downloaded,
    failures: summary.failures.length,
    historyWriteFailures: summary.historyWriteFailures?.length || 0,
  });
  closeLogger();

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
