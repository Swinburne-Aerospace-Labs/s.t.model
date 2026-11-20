import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import { processCatalog } from '../src/services/catalog.js';

const dir = fs.mkdtempSync(path.join(process.cwd(), 'catalog-test-'));
process.env.TMPDIR = dir;
const { default: handler } = await import('../api/satellites.js');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

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
  } finally { globalThis.fetch = original; }
});

test('enriches unnamed objects in an existing Spacebook cache by NORAD ID', async () => {
  const ids = ['25544', '48274', '00005', '00016', '100001', '100002'];
  const rows = ids.map(id => [id, `OBJECT ${id}`, 'tle1', 'tle2']);
  const data = [...rows, ...Array.from({ length: 10000 - rows.length }, (_, index) => [
    String(index + 110000), 'UNKNOWN', 'tle1', 'tle2',
  ])];
  fs.writeFileSync(path.join(dir, 'satellite-spacebook-cache-v1.json'), JSON.stringify({
    source: 'spacebook', timestamp: Date.now(), data,
  }));
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    calls++;
    assert.equal(url, 'https://celestrak.org/pub/satcat.csv');
    return new Response([
      'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE',
      'ISS (ZARYA),1998-067A,25544,PAY,+',
      'VANGUARD 1,1958-002B,5,PAY,',
      '"VANGUARD, ""STAGE""",1958-002A,16,R/B,',
      'TEST DEBRIS,,100001,DEB,',
      'UNKNOWN,,100002,UNK,',
    ].join('\r\n'));
  };
  try {
    const one = response(), two = response();
    await Promise.all([handler({ method: 'GET' }, one), handler({ method: 'GET' }, two)]);
    assert.equal(calls, 1);
    assert.equal(one.body.cached, true);
    assert.equal(two.body.hasObjectTypes, true);
    const objects = processCatalog(two.body.satellites.slice(0, ids.length), 'spacebook');
    assert.deepEqual(objects.map(object => object.id), ids);
    assert.deepEqual(objects.map(object => object.category), [
      'STATION', 'STATION', 'PAYLOAD', 'DEBRIS', 'DEBRIS', 'PAYLOAD',
    ]);
  } finally { globalThis.fetch = original; }
});
