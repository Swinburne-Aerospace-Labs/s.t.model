import test from 'node:test';
import assert from 'node:assert/strict';
import * as satellite from 'satellite.js';
import { fetchFullCatalog, fetchActiveCatalog, parseTleCatalog } from '../api/satellites.js';

const line1 = '1 25544U 98067A   24001.50000000  .00016717  00000-0  30160-3 0  9990';
const line2 = '2 25544  51.6416  20.0000 0005000  40.0000  30.0000 15.50000000123456';
const pair = id => `TEST ${id}\n${line1.slice(0, 2)}${id}${line1.slice(7)}\n${line2.slice(0, 2)}${id}${line2.slice(7)}`;

test('Spacebook TLEs support propagation and Alpha-5 identifiers', () => {
  const rows = parseTleCatalog(pair('A0001'), 1);
  assert.equal(rows[0][0], '100001');
  const position = satellite.propagate(satellite.twoline2satrec(rows[0][2], rows[0][3]), new Date('2024-01-01T12:00:00Z')).position;
  assert.ok(position && Number.isFinite(position.x));
  assert.equal(parseTleCatalog(`${line1}\n${line2}`, 1)[0][1], 'OBJECT 25544');
});

test('fetches the full Spacebook catalog without credentials', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, 'https://spacebook.comspoc.com/api/entity/tle');
    return new Response(Array.from({ length: 10000 }, (_, i) => pair(String(i + 1).padStart(5, '0'))).join('\n'));
  };
  try { assert.equal((await fetchFullCatalog()).length, 10000); }
  finally { globalThis.fetch = original; }
});

test('rejects incomplete and mismatched TLE data', () => {
  assert.throws(() => parseTleCatalog(pair('25544')), /incomplete/);
  assert.throws(() => parseTleCatalog(`${line1}\n${line2.replace('25544', '25545')}`, 1), /invalid/);
});

test('CelesTrak active fallback preserves IDs', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(url, /GROUP=active/);
    return Response.json([{ NORAD_CAT_ID: 100001, EPOCH: '2024-01-01', MEAN_MOTION: 15.5, ECCENTRICITY: 0.001, INCLINATION: 51, RA_OF_ASC_NODE: 20, ARG_OF_PERICENTER: 40, MEAN_ANOMALY: 30, BSTAR: 0.0001 }]);
  };
  try { assert.equal(String((await fetchActiveCatalog())[0][0]), '100001'); }
  finally { globalThis.fetch = original; }
});
