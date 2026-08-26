'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

async function removeStalePartFiles(rootDirectory, cutoffMs) {
  let removed = 0;
  async function visit(directory) {
    let entries;
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile() && entry.name.endsWith('.part')) {
        const stat = await fsp.stat(target);
        if (stat.mtimeMs < cutoffMs) {
          await fsp.rm(target, { force: true });
          removed += 1;
        }
      }
    }
  }
  await visit(rootDirectory);
  return removed;
}

function failStaleEncryptionDrafts(database, cutoffMs) {
  let failed = 0;
  for (const transfer of database.listTransfersByStates(['ENCRYPTING'])) {
    if (Date.parse(transfer.updated_at) < cutoffMs && database.forceFailure(transfer.transfer_id, 'STALE_ENCRYPTION_DRAFT')) failed += 1;
  }
  return failed;
}

module.exports = { removeStalePartFiles, failStaleEncryptionDrafts };
