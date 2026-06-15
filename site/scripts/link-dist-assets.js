import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SITE_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.resolve(SITE_DIR, '..');
const DIST_ASSETS = path.join(SITE_DIR, 'dist', 'assets');
const SOURCE_ASSETS = path.join(PROJECT_DIR, 'assets');

function removeExistingDistAssets() {
  if (!fs.existsSync(DIST_ASSETS)) {
    return;
  }

  const stats = fs.lstatSync(DIST_ASSETS);
  if (stats.isSymbolicLink() || stats.isDirectory()) {
    fs.rmSync(DIST_ASSETS, { recursive: true, force: true });
    return;
  }

  throw new Error(`Refusing to replace non-directory path: ${DIST_ASSETS}`);
}

function linkDistAssets() {
  if (!fs.existsSync(path.join(SITE_DIR, 'dist'))) {
    throw new Error('dist/ does not exist. Run npm run build first.');
  }

  if (!fs.existsSync(SOURCE_ASSETS)) {
    throw new Error(`Assets directory does not exist: ${SOURCE_ASSETS}`);
  }

  removeExistingDistAssets();

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(SOURCE_ASSETS, DIST_ASSETS, linkType);

  console.log(`Linked dist/assets -> ${SOURCE_ASSETS}`);
}

try {
  linkDistAssets();
} catch (error) {
  console.error(`Failed to link dist assets: ${error.message}`);
  process.exit(1);
}
