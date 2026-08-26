'use strict';



const fs = require('node:fs');

const path = require('node:path');

const { spawnSync } = require('node:child_process');



const root = path.resolve(__dirname, '..');

const dist = path.join(root, 'dist');

const cache = process.env.PKG_CACHE_PATH || path.join(root, '.pkg-cache');

const packageJson = require(path.join(root, 'package.json'));

const betterSqlitePackage = require(path.join(root, 'node_modules', 'better-sqlite3', 'package.json'));

const nativeAddon = path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

const pkg = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'pkg.cmd' : 'pkg');

const outputNames = {
  
  linux: 'three-server-connector-linux-x64',
  
  win: 'three-server-connector-win-x64.exe'
    
};



function fail(message) {
  
  throw new Error(`Connector build failed: ${message}`);
  
}



function run(command, args, options = {}) {
  
  const usesWindowsCommandShim = process.platform === 'win32' && /\.cmd$/i.test(command);
  
  const result = spawnSync(command, args, {
    
    cwd: root,
    
    stdio: 'inherit',
    
    shell: usesWindowsCommandShim,
    
    env: {
      
      ...process.env,
      
      PKG_CACHE_PATH: cache,
      
      SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH || '0'
        
    },
    
    ...options
      
  });
  
  if (result.error) throw result.error;
  
  if (result.status !== 0) process.exit(result.status || 1);
  
}



function requireFile(filePath, label) {
  
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) fail(`${label} is missing: ${filePath}`);
  
}



function packageTarget(target, output) {
  
  run(pkg, [
    
    'connector/index.js',
    
    '--config', 'package.json',
    
    '--targets', target,
    
    '--output', output,
    
    '--public-packages', '*',
    
    '--compress', 'GZip'
    
  ]);
  
  requireFile(output, `${target} output`);
  
}



function windowsAddonLocation() {
  
  const abi = `v${process.versions.modules}`;
  
  const version = betterSqlitePackage.version;
  
  const archiveName = `better-sqlite3-v${version}-node-${abi}-win32-x64.tar.gz`;
  
  return {
    
    archive: path.join(cache, archiveName),
    
    extract: path.join(cache, `better-sqlite3-v${version}-node-${abi}-win32-x64`),
    
    addon: path.join(cache, `better-sqlite3-v${version}-node-${abi}-win32-x64`, 'build', 'Release', 'better_sqlite3.node'),
    
    url: `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${archiveName}`
      
  };
  
}



function ensureWindowsNativeAddon() {
  
  const location = windowsAddonLocation();
  
  if (!fs.existsSync(location.addon)) {
    
    if (!fs.existsSync(location.archive)) run('curl', ['-fL', '--retry', '2', '--retry-delay', '2', '-o', location.archive, location.url]);
    
    fs.rmSync(location.extract, { recursive: true, force: true });
    
    fs.mkdirSync(location.extract, { recursive: true, mode: 0o700 });
    
    run('tar', ['-xzf', location.archive, '-C', location.extract]);
    
  }
  
  requireFile(location.addon, 'Windows better-sqlite3 native addon');
  
  return location.addon;
  
}



function normalizedWindowsVersion(version) {
  
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  
  if (!match) fail(`package version ${version} is not valid for Windows version metadata`);
  
  return `${match[1]}.${match[2]}.${match[3]}.0`;
  
}



async function applyWindowsVersionMetadata(output) {
  
  if (process.platform !== 'win32') {
    
    process.stdout.write('Skipping Windows resource metadata outside a Windows build host. The release workflow applies it on windows-2022.\n');
    
    return;
    
  }
  
  const { rcedit } = await import('rcedit');
  
  const version = normalizedWindowsVersion(packageJson.version);
  
  await rcedit(output, {
    
    'file-version': version,
    
    'product-version': version,
    
    'requested-execution-level': 'asInvoker',
    
    'version-string': {
      
      CompanyName: 'Wez Crypt',
      
      FileDescription: 'Three-Server Secure Transfer Connector',
      
      FileVersion: packageJson.version,
      
      InternalName: 'three-server-connector',
      
      LegalCopyright: 'Copyright (c) Wez Crypt',
      
      OriginalFilename: path.basename(output),
      
      ProductName: 'Three-Server Secure Transfer Connector',
      
      ProductVersion: packageJson.version
        
    }
      
  });
  
}



async function buildLinux() {
  
  const output = path.join(dist, outputNames.linux);
  
  packageTarget('node22-linux-x64', output);
  
  fs.chmodSync(output, 0o755);
  
  process.stdout.write(`Built ${path.relative(root, output)}\n`);
  
}



async function buildWindows() {
  
  requireFile(nativeAddon, 'Host better-sqlite3 native addon');
  
  const output = path.join(dist, outputNames.win);
  
  const originalAddon = fs.readFileSync(nativeAddon);
  
  try {
    
    const windowsAddon = process.platform === 'win32' ? nativeAddon : ensureWindowsNativeAddon();
    
    fs.copyFileSync(windowsAddon, nativeAddon);
    
    packageTarget('node22-win-x64', output);
    
    await applyWindowsVersionMetadata(output);
    
  } finally {
    
    fs.writeFileSync(nativeAddon, originalAddon, { mode: 0o755 });
    
  }
  
  process.stdout.write(`Built ${path.relative(root, output)}\n`);
  
}



async function main() {
  
  const target = (process.env.CONNECTOR_TARGET || 'all').toLowerCase();
  
  if (!['all', 'linux', 'win', 'windows'].includes(target)) fail('CONNECTOR_TARGET must be all, linux, or win.');
  
  fs.mkdirSync(dist, { recursive: true, mode: 0o755 });
  
  fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
  

  
  if (target === 'all' || target === 'linux') await buildLinux();
  
  if (target === 'all' || target === 'win' || target === 'windows') await buildWindows();
  
}



main().catch((error) => {
  
  process.stderr.write(`${error.stack || error.message}\n`);
  
  process.exitCode = 1;
  
});












































































































