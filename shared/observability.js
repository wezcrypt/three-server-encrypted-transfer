'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const pino = require('pino');

function createLogger(nodeId) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { nodeId },
    redact: {
      paths: [
        'req.headers.authorization', 'req.headers.cookie', 'req.body',
        'authorization', 'token', 'uploadToken', 'masterKey', 'master_key',
        'MASTER_KEY_B64', 'VAULT_TOKEN', 'wrappedDek', 'wrapped_dek',
        'error.stack', 'error.message', 'filename', 'originalFilename'
      ],
      censor: '[REDACTED]'
    }
  });
}

async function getHealthSnapshot(database, storagePath) {
  const stats = database.getHealthStats();
  let disk = null;
  try {
    const fsStats = await fs.statfs(storagePath);
    disk = { availableBytes: Number(fsStats.bavail) * Number(fsStats.bsize), totalBytes: Number(fsStats.blocks) * Number(fsStats.bsize) };
  } catch (_) {
    disk = { availableBytes: null, totalBytes: null };
  }
  const memory = process.memoryUsage();
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    process: {
      uptimeSeconds: Math.floor(process.uptime()),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      pid: process.pid
    },
    host: {
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg(),
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem()
    },
    disk,
    transfers: stats
  };
}

module.exports = { createLogger, getHealthSnapshot };
