import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(process.cwd(), 'catalog-test-'));
process.env.TMPDIR = dir;
const { default: handler } = await import('../api/satellites.js');

const record = { NORAD_CAT_ID: 100001, OBJECT_NAME: 'TEST', EPOCH: '2024-01-01T00:00:00', MEAN_MOTION: 15.5, ECCENTRICITY: 0.001, INCLINATION: 51, RA_OF_ASC_NODE: 20, ARG_OF_PERICENTER: 40, MEAN_ANOMALY: 30, BSTAR: 0.0001 };
function response() {
  return { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}
test('simultaneous requests share one CelesTrak download and cache it', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let fullCalls = 0;
  globalThis.fetch = async url => { if (url.includes('spacebook')) { fullCalls++; throw new Error('unavailable'); } calls++; await new Promise(resolve => setTimeout(resolve, 20)); return Response.json([record]); };
  try {
    const one = response(), two = response();
    await Promise.all([handler({ method: 'GET', headers: {} }, one), handler({ method: 'GET', headers: {} }, two)]);
    assert.equal(calls, 1);
    assert.equal(fullCalls, 1);
    assert.equal(one.body.source, 'celestrak-active');
    assert.equal(two.body.satellites.length, 1);
    const three = response();
    await handler({ method: 'GET', headers: {} }, three);
    assert.equal(three.body.cached, true);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); }
});
