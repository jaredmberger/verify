import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

function store(records = []) {
  return {
    async list() {
      return { keys: records.map((_, index) => ({ name: `verification:${index}` })) };
    },
    async get(key) {
      const index = Number(String(key).split(':').pop());
      return records[index] || null;
    },
    async put() {}
  };
}

test('recent verification history fails closed without VERIFY_WRITE_KEY', async () => {
  const response = await worker.fetch(
    new Request('https://verify.test/api/recent'),
    { CURATOR_VERIFY_RECORDS: store([]) }
  );
  assert.equal(response.status, 503);
});

test('recent verification history rejects a wrong key', async () => {
  const response = await worker.fetch(
    new Request('https://verify.test/api/recent', {
      headers: { 'x-curator-verify-key': 'wrong' }
    }),
    { VERIFY_WRITE_KEY: 'right', CURATOR_VERIFY_RECORDS: store([]) }
  );
  assert.equal(response.status, 401);
});

test('recent verification history accepts the configured key', async () => {
  const response = await worker.fetch(
    new Request('https://verify.test/api/recent', {
      headers: { 'x-curator-verify-key': 'right' }
    }),
    {
      VERIFY_WRITE_KEY: 'right',
      CURATOR_VERIFY_RECORDS: store([
        { id: 'v1', checkedAt: '2026-09-28T07:00:00.000Z', target: 'https://oceanliners.net/' }
      ])
    }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 1);
  assert.equal(body.results[0].id, 'v1');
});

test('verification writes still fail closed without VERIFY_WRITE_KEY', async () => {
  const response = await worker.fetch(
    new Request('https://verify.test/api/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://oceanliners.net/' })
    }),
    { CURATOR_VERIFY_RECORDS: store([]) }
  );
  assert.equal(response.status, 503);
});
