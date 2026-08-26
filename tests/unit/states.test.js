'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TRANSFER_STATE, assertTransition } = require('../../shared/states');

test('accepts the intended forward state path', () => {
  assert.doesNotThrow(() => assertTransition(TRANSFER_STATE.CREATED, TRANSFER_STATE.ENCRYPTING));
  assert.doesNotThrow(() => assertTransition(TRANSFER_STATE.ENCRYPTING, TRANSFER_STATE.ENCRYPTED));
  assert.doesNotThrow(() => assertTransition(TRANSFER_STATE.STORAGE_RECEIVING, TRANSFER_STATE.STORED));
});

test('rejects impossible and terminal-state transitions', () => {
  assert.throws(() => assertTransition(TRANSFER_STATE.FAILED, TRANSFER_STATE.STORED), /Illegal/);
  assert.throws(() => assertTransition(TRANSFER_STATE.STORED, TRANSFER_STATE.ENCRYPTING), /Illegal/);
  assert.throws(() => assertTransition(TRANSFER_STATE.EXPIRED, TRANSFER_STATE.RELAY_RECEIVING), /Illegal/);
});
