import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { handler, settingsFrom } from '../server.mjs';

describe('settingsFrom', () => {
  it('has safe defaults', () => {
    assert.deepEqual(settingsFrom({}), { version: 'dev', port: 8080, errorRate: 0, latencyMs: 0 });
  });

  it('clamps the fault settings and ignores bad numbers', () => {
    const settings = settingsFrom({ FAULT_ERROR_RATE: '7', FAULT_LATENCY_MS: 'soon' });
    assert.equal(settings.errorRate, 1);
    assert.equal(settings.latencyMs, 0);
  });
});

describe('the server', () => {
  let server;
  let base;
  let nextRandom = 0.5;

  before(async () => {
    const settings = { version: 'v1.2.3', port: 0, errorRate: 0.3, latencyMs: 0 };
    server = createServer(handler(settings, () => nextRandom));
    await new Promise((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('reports its version on /health', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', version: 'v1.2.3' });
  });

  it('answers / unless a fault is injected', async () => {
    nextRandom = 0.5;
    assert.equal((await fetch(base)).status, 200);
    nextRandom = 0.1;
    const failed = await fetch(base);
    assert.equal(failed.status, 500);
    assert.equal((await failed.json()).error, 'injected fault');
  });

  it('knows no other paths or methods', async () => {
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  });
});
