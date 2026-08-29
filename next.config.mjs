import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_BOZ_VERSION: packageJson.version,
  },
  turbopack: {
    root: __dirname,
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
    resolveAlias: {
      '*.js': ['*.ts', '*.tsx', '*.js'],
    },
  },
  serverExternalPackages: [
    'yahoo-finance2',
    'technicalindicators',
    'rss-parser',
    'openai',
  ],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, 'src'),
    };
    return config;
  },
};

export default nextConfig;
