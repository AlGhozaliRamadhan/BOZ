#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ override: true }); // .env must win over inherited environment values

import { CLI } from './cli/cli.js';

const cli = new CLI();
cli.run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
