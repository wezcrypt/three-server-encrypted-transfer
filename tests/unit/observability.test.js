'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const test = require('node:test');
const { getHealthSnapshot } = require('../../shared/observability');

test('health snapshot exposes operational counters without secret or file metadata', async () => {
  const snapshot = await getHealthSnapshot({ getHealthStats: () => ({ activeTransfers: 2, failedTransfers: 1 }) }, os.tmpdir());
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.transfers.activeTransfers, 2);
  assert.equal(snapshot.transfers.failedTransfers, 1);
  assert.equal(Object.hasOwn(snapshot, 'wrappedDek'), false);
  assert.equal(Object.hasOwn(snapshot, 'filename'), false);
});
