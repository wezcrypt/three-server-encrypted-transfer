'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assetDirectory = path.resolve(root, process.env.RELEASE_ASSET_DIR || 'dist');
const assets = [
  'three-server-connector-linux-x64',
  'three-server-connector-win-x64.exe'
];

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const file = fs.readFileSync(filePath);
  hash.update(file);
  return hash.digest('hex');
}

if (!fs.existsSync(assetDirectory) || !fs.statSync(assetDirectory).isDirectory()) {
  throw new Error(`Release asset directory does not exist: ${assetDirectory}`);
}

const lines = assets.map((asset) => {
  const filePath = path.join(assetDirectory, asset);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Expected release asset is missing: ${filePath}`);
  }
  return `${sha256(filePath)}  ${asset}`;
});

const output = path.join(assetDirectory, 'SHA256SUMS.txt');
fs.writeFileSync(output, `${lines.join('\n')}\n`, { mode: 0o644 });
process.stdout.write(`Wrote SHA-256 checksums to ${path.relative(root, output)}\n`);
