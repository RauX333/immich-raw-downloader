import { helpText, loadDotenv, parseArgs, readConfigFromEnv } from './config.js';
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
    allowDestinationChange: !options.destination,
  });
  const client = new ImmichClient({
    baseUrl: runConfig.immichUrl,
    apiKey: runConfig.apiKey,
  });

  console.log(`immich url: ${runConfig.immichUrl}`);
  console.log(`download destination: ${runConfig.destination}`);
  console.log('Planning download...');
  const plan = await planDownloads({
    client,
    destination: runConfig.destination,
    verbose: options.verbose,
  });
  console.log(formatDownloadPlan(plan));

  let summary;
  if (options.dryRun) {
    summary = planToSummary(plan);
  } else if (plan.plannedDownloads.length === 0) {
    summary = await executeDownloadPlan({ client, plan });
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
    });
  }

  console.log(formatSummary(summary, { dryRun: options.dryRun }));

  if (summary.failures.length > 0) {
    process.exitCode = 1;
  }
}
