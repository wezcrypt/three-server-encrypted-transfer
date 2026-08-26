'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

const UI = {
  en: {
    title: 'Three-Server Secure Transfer Connector',
    selectLanguage: 'Select interface language: en (English) or ar (Arabic)',
    languageInvalid: 'Language must be en or ar.',
    enterValues: 'Enter deployment values. Certificate paths must be readable on this control host.',
    runtime: 'Runtime (development/production)',
    runtimeInvalid: 'Runtime must be development or production.',
    workspace: 'Runtime workspace directory',
    ca: 'Internal CA certificate path',
    crl: 'CRL path (required in production; blank otherwise)',
    productionCrl: 'Production requires a CRL path.',
    bind: (id) => `${id} bind address`,
    host: (id) => `${id} reachable DNS name or IP`,
    port: (id) => `${id} port`,
    cert: (id) => `${id} mTLS certificate`,
    key: (id) => `${id} mTLS private key`,
    storage: (id) => `${id} storage path`,
    uploadToken: 'Server 1 upload token (blank generates a secure token)',
    maxUpload: 'Maximum upload size (MiB)',
    maxUploadInvalid: 'Maximum upload size must be a positive integer.',
    started: (host, port) => `Connector started all nodes. Server 1 upload endpoint: https://${host}:${port}/upload`,
    token: (value) => `Server 1 upload token: ${value}\nKeep this token secret. Press Ctrl+C to stop all nodes.`
  },
  ar: {
    title: 'موصل النقل الآمن عبر ثلاث خوادم',
    selectLanguage: 'اختر لغة الواجهة: en للإنجليزية أو ar للعربية',
    languageInvalid: 'يجب أن تكون اللغة en أو ar.',
    enterValues: 'أدخل قيم النشر. يجب أن تكون مسارات الشهادات قابلة للقراءة على جهاز التحكم.',
    runtime: 'بيئة التشغيل (development/production)',
    runtimeInvalid: 'يجب أن تكون بيئة التشغيل development أو production.',
    workspace: 'مجلد مساحة عمل التشغيل',
    ca: 'مسار شهادة CA الداخلية',
    crl: 'مسار CRL (إلزامي في الإنتاج، واتركه فارغاً في غير ذلك)',
    productionCrl: 'يتطلب الإنتاج مسار CRL.',
    bind: (id) => `عنوان الربط لـ ${id}`,
    host: (id) => `اسم DNS أو IP المتاح لـ ${id}`,
    port: (id) => `منفذ ${id}`,
    cert: (id) => `شهادة mTLS لـ ${id}`,
    key: (id) => `المفتاح الخاص لـ ${id} في mTLS`,
    storage: (id) => `مسار تخزين ${id}`,
    uploadToken: 'رمز رفع Server 1 (اتركه فارغاً لتوليد رمز آمن)',
    maxUpload: 'الحد الأقصى لحجم الرفع (MiB)',
    maxUploadInvalid: 'يجب أن يكون الحد الأقصى لحجم الرفع عدداً صحيحاً موجباً.',
    started: (host, port) => `تم تشغيل جميع العقد. عنوان رفع Server 1: https://${host}:${port}/upload`,
    token: (value) => `رمز رفع Server 1: ${value}\nاحتفظ بهذا الرمز سرياً. اضغط Ctrl+C لإيقاف جميع العقد.`
  }
};

function strings(language) { return UI[language] || UI.en; }

function usage() {
  stdout.write(`\nThree-Server Secure Transfer Connector / موصل النقل الآمن عبر ثلاث خوادم\n\nUsage / الاستخدام:\n  connector                 Interactive configuration and start / إعداد تفاعلي وتشغيل\n  connector --config <file> Start from an existing connector configuration / تشغيل إعداد موجود\n  connector --generate <file> Create a non-secret example configuration / إنشاء إعداد نموذجي بلا أسرار\n\n`);
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--config' || argument === '--generate') result[argument.slice(2)] = args[++index];
    else if (argument === '--run-server') result.runServer = args[++index];
    else if (argument === '--help' || argument === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function assertPort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} must be a port from 1 to 65535.`);
  return port;
}

function normalizeDirectory(value, label) {
  if (!value || typeof value !== 'string') throw new Error(`${label} is required.`);
  return path.resolve(value.trim());
}

function requireFile(value, label) {
  const resolved = path.resolve(value.trim());
  if (!fs.statSync(resolved).isFile()) throw new Error(`${label} must point to a regular file.`);
  return resolved;
}

async function ask(terminal, prompt, fallback) {
  const suffix = fallback === undefined ? '' : ` [${fallback}]`;
  const answer = (await terminal.question(`${prompt}${suffix}: `)).trim();
  return answer || fallback;
}

async function collectInteractive() {
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    const selected = (await ask(terminal, 'Select language / اختر اللغة (en/ar)', 'en')).toLowerCase();
    if (!['en', 'ar'].includes(selected)) throw new Error(strings(selected).languageInvalid);
    const text = strings(selected);
    stdout.write(`\n${text.title}\n${text.enterValues}\n`);
    const runtime = await ask(terminal, text.runtime, 'development');
    if (!['development', 'production'].includes(runtime)) throw new Error(text.runtimeInvalid);
    const workspace = normalizeDirectory(await ask(terminal, text.workspace, './three-server-runtime'), text.workspace);
    const commonCaPath = requireFile(await ask(terminal, text.ca, './config/certs/ca.cert.pem'), text.ca);
    const crlInput = await ask(terminal, text.crl, runtime === 'production' ? undefined : '');
    const crlPath = crlInput ? requireFile(crlInput, 'CRL') : undefined;
    if (runtime === 'production' && !crlPath) throw new Error(text.productionCrl);
    const node = {};
    for (const id of ['server1', 'server2', 'server3']) {
      stdout.write(`\n${id.toUpperCase()}\n`);
      node[id] = {
        bindHost: await ask(terminal, text.bind(id), '0.0.0.0'),
        publicHost: await ask(terminal, text.host(id), 'localhost'),
        port: assertPort(await ask(terminal, text.port(id), id === 'server1' ? '8443' : id === 'server2' ? '9443' : '10443'), `${id} port`),
        certPath: requireFile(await ask(terminal, text.cert(id), `./config/certs/${id}.cert.pem`), `${id} certificate`),
        keyPath: requireFile(await ask(terminal, text.key(id), `./config/certs/${id}.key.pem`), `${id} private key`),
        storagePath: normalizeDirectory(await ask(terminal, text.storage(id), `./data/${id}`), `${id} storage path`)
      };
    }
    const uploadToken = await ask(terminal, text.uploadToken, '');
    const maxUploadMiB = Number(await ask(terminal, text.maxUpload, '1024'));
    if (!Number.isInteger(maxUploadMiB) || maxUploadMiB < 1) throw new Error(text.maxUploadInvalid);
    return {
      language: selected, runtime, workspace, commonCaPath, crlPath, node, uploadToken: uploadToken || crypto.randomBytes(32).toString('base64url'),
      limits: { maxUploadBytes: maxUploadMiB * 1024 * 1024, chunkSize: 8 * 1024 * 1024, requestTimeoutMs: 30000, staleTransferHours: 6 }
    };
  } finally { terminal.close(); }
}

function exampleConfig() {
  return {
    language: 'en', runtime: 'development', workspace: './three-server-runtime', commonCaPath: './config/certs/ca.cert.pem',
    node: {
      server1: { bindHost: '0.0.0.0', publicHost: 'localhost', port: 8443, certPath: './config/certs/server1.cert.pem', keyPath: './config/certs/server1.key.pem', storagePath: './data/server1' },
      server2: { bindHost: '0.0.0.0', publicHost: 'localhost', port: 9443, certPath: './config/certs/server2.cert.pem', keyPath: './config/certs/server2.key.pem', storagePath: './data/server2' },
      server3: { bindHost: '0.0.0.0', publicHost: 'localhost', port: 10443, certPath: './config/certs/server3.cert.pem', keyPath: './config/certs/server3.key.pem', storagePath: './data/server3' }
    },
    uploadToken: '__GENERATE_SECURE_TOKEN_AT_RUNTIME__',
    limits: { maxUploadBytes: 1073741824, chunkSize: 8388608, requestTimeoutMs: 30000, staleTransferHours: 6 }
  };
}

function validateConnectorConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('Connector configuration must be an object.');
  const language = input.language || 'en';
  if (!['en', 'ar'].includes(language)) throw new Error('Invalid language.');
  const runtime = input.runtime || 'development';
  if (!['development', 'production'].includes(runtime)) throw new Error('Invalid runtime.');
  const workspace = normalizeDirectory(input.workspace || './three-server-runtime', 'workspace');
  const commonCaPath = requireFile(input.commonCaPath, 'commonCaPath');
  const crlPath = input.crlPath ? requireFile(input.crlPath, 'crlPath') : undefined;
  if (runtime === 'production' && !crlPath) throw new Error('Production requires crlPath.');
  const node = {};
  for (const id of ['server1', 'server2', 'server3']) {
    const source = input.node && input.node[id];
    if (!source) throw new Error(`Missing node.${id}.`);
    node[id] = {
      bindHost: String(source.bindHost || '0.0.0.0'), publicHost: String(source.publicHost), port: assertPort(source.port, `${id} port`),
      certPath: requireFile(source.certPath, `${id} certificate`), keyPath: requireFile(source.keyPath, `${id} private key`), storagePath: normalizeDirectory(source.storagePath, `${id} storagePath`)
    };
  }
  const suppliedToken = String(input.uploadToken || '');
  const token = suppliedToken === '__GENERATE_SECURE_TOKEN_AT_RUNTIME__' ? crypto.randomBytes(32).toString('base64url') : suppliedToken;
  if (token.length < 32) throw new Error('uploadToken must contain at least 32 characters.');
  const inputLimits = input.limits || {};
  const limits = {
    maxUploadBytes: Number(inputLimits.maxUploadBytes || 1024 * 1024 * 1024), chunkSize: Number(inputLimits.chunkSize || 8 * 1024 * 1024),
    requestTimeoutMs: Number(inputLimits.requestTimeoutMs || 30000), staleTransferHours: Number(inputLimits.staleTransferHours || 6)
  };
  if (!Number.isInteger(limits.maxUploadBytes) || !Number.isInteger(limits.chunkSize) || !Number.isInteger(limits.requestTimeoutMs) || !Number.isInteger(limits.staleTransferHours)) throw new Error('limits must be integers.');
  return { language, runtime, workspace, commonCaPath, crlPath, node, uploadToken: token, limits };
}

async function writeJsonSecure(destination, value) {
  await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fsp.writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') await fsp.chmod(destination, 0o600);
}

async function createNodeConfigs(connectorConfig) {
  const config = validateConnectorConfig(connectorConfig);
  const generated = path.join(config.workspace, 'generated-config');
  const sharedTls = { caPath: config.commonCaPath, crlPath: config.crlPath };
  const makeConfig = (id) => ({
    runtime: config.runtime, nodeId: id, bindHost: config.node[id].bindHost, port: config.node[id].port,
    databasePath: path.join(config.node[id].storagePath, 'state.sqlite'), storagePath: config.node[id].storagePath,
    tls: { ...sharedTls, certPath: config.node[id].certPath, keyPath: config.node[id].keyPath }, limits: config.limits,
    ...(id === 'server1' ? { relayUrl: `https://${config.node.server2.publicHost}:${config.node.server2.port}`, uploadToken: config.uploadToken } : {}),
    ...(id === 'server2' ? { storageUrl: `https://${config.node.server3.publicHost}:${config.node.server3.port}` } : {})
  });
  const paths = {};
  for (const id of ['server1', 'server2', 'server3']) {
    paths[id] = path.join(generated, `${id}.json`);
    await writeJsonSecure(paths[id], makeConfig(id));
  }
  return { config, paths };
}

function serverEntry(id) {
  return id === 'server1' ? require('../server1-upload') : id === 'server2' ? require('../server2-relay') : require('../server3-storage');
}

function runEmbeddedServer(id) {
  if (!['server1', 'server2', 'server3'].includes(id)) throw new Error('Invalid embedded server role.');
  const { server, service } = serverEntry(id).startServer();
  const shutdown = () => server.close(() => { service.close(); process.exit(0); });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function childInvocation(id, configPath) {
  if (process.pkg) return { command: process.execPath, args: ['--run-server', id], env: { ...process.env, CONFIG_PATH: configPath } };
  return { command: process.execPath, args: [__filename, '--run-server', id], env: { ...process.env, CONFIG_PATH: configPath } };
}

async function launch(config) {
  const { paths } = await createNodeConfigs(config);
  const children = [];
  const runtimeEnv = { ...process.env };
  if (config.runtime === 'development' && !runtimeEnv.MASTER_KEY_B64) runtimeEnv.MASTER_KEY_B64 = crypto.randomBytes(32).toString('base64');
  if (config.runtime === 'development' && !runtimeEnv.KEY_PROVIDER) runtimeEnv.KEY_PROVIDER = 'development';
  if (process.pkg) {
    const priorEnvironment = { ...process.env };
    Object.assign(process.env, runtimeEnv);
    for (const id of ['server3', 'server2', 'server1']) {
      const nodeConfig = JSON.parse(await fsp.readFile(paths[id], 'utf8'));
      children.push(serverEntry(id).startServer(nodeConfig));
    }
    for (const key of Object.keys(process.env)) if (!(key in priorEnvironment)) delete process.env[key];
    Object.assign(process.env, priorEnvironment);
  } else {
    for (const id of ['server3', 'server2', 'server1']) {
      const invocation = childInvocation(id, paths[id]);
      const child = spawn(invocation.command, invocation.args, { env: { ...runtimeEnv, ...invocation.env, CONFIG_PATH: paths[id] }, stdio: 'inherit', windowsHide: false });
      children.push(child);
    }
  }
  const text = strings(config.language);
  stdout.write(`\n${text.started(config.node.server1.publicHost, config.node.server1.port)}\n`);
  stdout.write(`${text.token(config.uploadToken)}\n`);
  const shutdown = () => {
    for (const child of children) {
      if (process.pkg) { clearInterval(child.recoveryTimer); child.server.close(() => child.service.close()); }
      else if (!child.killed) child.kill('SIGTERM');
    }
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (args.runServer) return runEmbeddedServer(args.runServer);
  if (args.generate) {
    const output = path.resolve(args.generate);
    await writeJsonSecure(output, exampleConfig());
    stdout.write(`Example configuration written to ${output}\n`);
    return;
  }
  let config;
  if (args.config) config = JSON.parse(await fsp.readFile(path.resolve(args.config), 'utf8'));
  else config = await collectInteractive();
  config = validateConnectorConfig(config);
  await launch(config);
}

main().catch((error) => { process.stderr.write(`Connector failed: ${error.message}\n`); process.exitCode = 1; });
