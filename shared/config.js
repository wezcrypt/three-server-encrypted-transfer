'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');

const urlSchema = z.string().url().refine((value) => new URL(value).protocol === 'https:', 'Only https URLs are permitted.');
const filePathSchema = z.string().min(1).max(4096);

const commonSchema = z.object({
  runtime: z.enum(['development', 'production']).default('development'),
  nodeId: z.enum(['server1', 'server2', 'server3']),
  bindHost: z.string().min(1).max(255).default('127.0.0.1'),
  port: z.number().int().min(1).max(65535),
  databasePath: filePathSchema,
  storagePath: filePathSchema,
  tls: z.object({
    caPath: filePathSchema,
    certPath: filePathSchema,
    keyPath: filePathSchema,
    crlPath: filePathSchema.optional()
  }).strict(),
  limits: z.object({
    maxUploadBytes: z.number().int().min(1024).max(1024 * 1024 * 1024 * 100).default(1024 * 1024 * 1024),
    chunkSize: z.number().int().min(1024 * 1024).max(16 * 1024 * 1024).default(8 * 1024 * 1024),
    requestTimeoutMs: z.number().int().min(1000).max(300000).default(30000),
    staleTransferHours: z.number().int().min(1).max(168).default(6)
  }).strict()
}).strict();

const server1Schema = commonSchema.extend({
  nodeId: z.literal('server1'),
  relayUrl: urlSchema,
  uploadToken: z.string().min(32).max(512).optional()
}).strict();

const server2Schema = commonSchema.extend({
  nodeId: z.literal('server2'),
  storageUrl: urlSchema
}).strict();

const server3Schema = commonSchema.extend({
  nodeId: z.literal('server3')
}).strict();

function loadNodeConfig(expectedNodeId) {
  const configPath = process.env.CONFIG_PATH;
  if (!configPath) throw new Error('CONFIG_PATH is required.');
  const resolved = path.resolve(configPath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('CONFIG_PATH does not point to a regular file.');
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(resolved, 'utf8')); } catch (_) { throw new Error('CONFIG_PATH is not valid JSON.'); }
  const schema = expectedNodeId === 'server1' ? server1Schema : expectedNodeId === 'server2' ? server2Schema : server3Schema;
  const config = schema.parse(parsed);
  if (config.nodeId !== expectedNodeId) throw new Error('Configuration node ID does not match this server process.');
  if (config.runtime === 'production' && !config.tls.crlPath) throw new Error('Production configuration requires tls.crlPath.');
  if (expectedNodeId === 'server1' && config.runtime === 'production' && !config.uploadToken) {
    throw new Error('Production Server 1 requires an uploadToken.');
  }
  return config;
}

module.exports = { loadNodeConfig };
