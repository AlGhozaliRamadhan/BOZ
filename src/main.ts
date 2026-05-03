import dotenv from 'dotenv';
dotenv.config(); // MUST be first, before any other imports read process.env

import { CLI } from './cli/cli.js';

const cli = new CLI();
cli.run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});