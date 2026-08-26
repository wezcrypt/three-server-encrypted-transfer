'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const cache = path.join(root, '.pkg-cache');
const nativeAddon = path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const windowsArchive = path.join(cache, 'better-sqlite3-v11.10.0-node-v127-win32-x64.tar.gz');
const windowsExtract = path.join(cache, 'better-sqlite3-win32');
const windowsAddon = path.join(windowsExtract, 'build', 'Release', 'better_sqlite3.node');
const pkg = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'pkg.cmd' : 'pkg');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, PKG_CACHE_PATH: cache } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function packageTarget(target, output) {
  run(pkg, ['connector/index.js', '--config', 'package.json', '--targets', target, '--output', output, '--public-packages', '*', '--compress', 'GZip']);
}

fs.mkdirSync(dist, { recursive: true, mode: 0o755 });
fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
const originalLinuxAddon = fs.readFileSync(nativeAddon);
try {
  packageTarget('node22-linux-x64', path.join(dist, 'three-server-connector-linux-x64'));
  if (!fs.existsSync(windowsAddon)) {
    if (!fs.existsSync(windowsArchive)) {
      run('curl', ['-fL', '--retry', '2', '-o', windowsArchive, 'https://github.com/WiseLibs/better-sqlite3/releases/download/v11.10.0/better-sqlite3-v11.10.0-node-v127-win32-x64.tar.gz']);
    }
    fs.rmSync(windowsExtract, { recursive: true, force: true });
    fs.mkdirSync(windowsExtract, { recursive: true, mode: 0o700 });
    run('tar', ['-xzf', windowsArchive, '-C', windowsExtract]);
  }
  if (!fs.existsSync(windowsAddon)) throw new Error('Windows better-sqlite3 addon was not found after extraction.');
  fs.copyFileSync(windowsAddon, nativeAddon);
  packageTarget('node22-win-x64', path.join(dist, 'three-server-connector-win-x64.exe'));
} finally {
  fs.writeFileSync(nativeAddon, originalLinuxAddon, { mode: 0o755 });
}
fs.chmodSync(path.join(dist, 'three-server-connector-linux-x64'), 0o755);
