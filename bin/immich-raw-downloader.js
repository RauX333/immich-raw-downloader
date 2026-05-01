#!/usr/bin/env node

import { runCli } from '../src/cli.js';

runCli().catch((error) => {
  console.error(`Error: ${error.message}`);
  if (process.env.DEBUG) {
    console.error(error);
  }
  process.exitCode = 1;
});
