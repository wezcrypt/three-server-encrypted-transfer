'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DevelopmentKeyProvider } = require('../../shared/key-provider');

const fileId = 'e6eecb56-7d01-4413-9602-442e3bd1d12d';

function withEnvironment(values, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  return Promise.resolve(callback()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test('development provider unwraps an older configured key version', async () => {
  const oldKey = crypto.randomBytes(32).toString('base64');
  const newKey = crypto.randomBytes(32).toString('base64');
  const keys = JSON.stringify({ v1: oldKey, v2: newKey });
  const dek = crypto.randomBytes(32);
  await withEnvironment({ DEV_KMS_KEY_VERSION: 'v1', DEV_KMS_KEYS_JSON: keys, MASTER_KEY_B64: undefined }, async () => {
    const oldProvider = new DevelopmentKeyProvider();
    const wrapped = await oldProvider.wrapDek(dek, fileId);
    await withEnvironment({ DEV_KMS_KEY_VERSION: 'v2', DEV_KMS_KEYS_JSON: keys }, async () => {
      const rotatedProvider = new DevelopmentKeyProvider();
      assert.deepEqual(await rotatedProvider.unwrapDek(wrapped.wrappedDek, fileId), dek);
    });
  });
});
