import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLED_NODE_VERSION = 'v24.15.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FORBIDDEN_RESOURCE_FILE = /(^|[\\/])(?:\.env(?:\.[^\\/]*)?|[^\\/]+\.(?:log|db|sqlite|sqlite3)|(?:credentials|sessions?)\.(?:json|db|sqlite|sqlite3)|boz-(?:background(?:-[^\\/]+)?|instance)\.(?:json|vbs)|[^\\/]+\.nft\.json)$/i;

function assertChildPath(parent, child) {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  if (childPath !== parentPath && !childPath.startsWith(`${parentPath}${sep}`)) {
    throw new Error(`Desktop resource path escaped its parent: ${childPath}`);
  }
}

export function assertBundledNode({ platform = process.platform, version = process.version } = {}) {
  if (platform !== 'win32') {
    throw new Error(`Windows desktop packaging requires a native Windows Node.js runtime; received ${platform}`);
  }
  if (version !== BUNDLED_NODE_VERSION) {
    throw new Error(`Desktop packages must bundle Node.js ${BUNDLED_NODE_VERSION}; received ${version}`);
  }
}

export function findForbiddenFiles(root) {
  if (!existsSync(root)) return [];
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if ((entry.isFile() || entry.isSymbolicLink()) && FORBIDDEN_RESOURCE_FILE.test(path)) found.push(path);
    }
  };
  visit(root);
  return found;
}

export function prepareDesktopResources({
  moduleRoot,
  nodeExecutable = process.execPath,
  platform = process.platform,
  nodeVersion = process.version,
  architecture = process.arch,
}) {
  assertBundledNode({ platform, version: nodeVersion });

  const root = resolve(moduleRoot);
  const standaloneSource = join(root, '.next', 'standalone');
  const resourcesRoot = join(root, 'src-tauri', 'resources');
  const serverDestination = join(resourcesRoot, 'server');
  const nodeDestination = join(resourcesRoot, 'node.exe');
  const usesBundledNodeInPlace = resolve(nodeExecutable) === resolve(nodeDestination);
  assertChildPath(join(root, 'src-tauri'), resourcesRoot);
  const generatedResources = [
    serverDestination,
    join(resourcesRoot, 'desktop-build.json'),
    ...(usesBundledNodeInPlace ? [] : [nodeDestination]),
  ];
  const cleanGeneratedResources = () => {
    for (const path of generatedResources) {
      assertChildPath(resourcesRoot, path);
      rmSync(path, { recursive: true, force: true });
    }
  };

  if (!existsSync(join(standaloneSource, 'server.js'))) {
    throw new Error('Missing .next/standalone/server.js. Run the production Next.js build first.');
  }
  if (!existsSync(nodeExecutable) || !statSync(nodeExecutable).isFile()) {
    throw new Error(`Node.js executable not found: ${nodeExecutable}`);
  }

  mkdirSync(resourcesRoot, { recursive: true });
  cleanGeneratedResources();
  cpSync(standaloneSource, serverDestination, { recursive: true, force: true });
  if (!usesBundledNodeInPlace) cpSync(nodeExecutable, nodeDestination, { force: true });

  const forbidden = findForbiddenFiles(resourcesRoot);
  if (forbidden.length > 0) {
    cleanGeneratedResources();
    throw new Error(`Desktop resources contain forbidden files: ${forbidden.map((path) => relative(root, path)).join(', ')}`);
  }

  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const metadata = {
    application: 'BOZ',
    version: packageJson.version,
    distribution: 'desktop',
    node: nodeVersion,
    architecture,
  };
  writeFileSync(join(resourcesRoot, 'desktop-build.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return { resourcesRoot, metadata };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isCli) {
  try {
    const result = prepareDesktopResources({ moduleRoot: resolve(__dirname, '..') });
    console.log(`Prepared BOZ ${result.metadata.version} desktop resources for ${result.metadata.architecture} with Node.js ${result.metadata.node}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
