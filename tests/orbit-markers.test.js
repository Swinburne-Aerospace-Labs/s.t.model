import test from 'node:test';
import assert from 'node:assert/strict';
import { jday, propagate } from 'satellite.js';
import { PerspectiveCamera } from 'three';
import { createSatrec, EARTH_RADIUS } from '../src/services/propagation.js';
import { HALF_GRAVITY, ORBIT_STRIDE, pickOrbitMarker, writeOrbitState } from '../src/services/orbitMarkers.js';

test('orbit snapshots preserve the propagated position, velocity and validity', () => {
    const record = createSatrec({
        tle1: '1 25544U 98067A   24001.50000000  .00016717  00000-0  30160-3 0  9990',
        tle2: '2 25544  51.6416  20.0000 0005000  40.0000  30.0000 15.50000000123456'
    });
    const time = new Date('2024-01-01T12:01:00Z');
    const { position, velocity } = propagate(record, time);
    const buffer = new Float32Array(ORBIT_STRIDE);
    writeOrbitState(buffer, 0, record, jday(time));
    assert.deepEqual(buffer, new Float32Array([
        position.x / EARTH_RADIUS, position.z / EARTH_RADIUS, -position.y / EARTH_RADIUS, 1,
        velocity.x / EARTH_RADIUS, velocity.z / EARTH_RADIUS, -velocity.y / EARTH_RADIUS
    ]));

    const seconds = 30;
    const radius = Math.hypot(buffer[0], buffer[1], buffer[2]);
    const factor = 1 - HALF_GRAVITY * seconds ** 2 / radius ** 3;
    const next = propagate(record, new Date(time.getTime() + seconds * 1000)).position;
    const errorKm = Math.hypot(
        (buffer[0] * factor + buffer[4] * seconds) * EARTH_RADIUS - next.x,
        (buffer[1] * factor + buffer[5] * seconds) * EARTH_RADIUS - next.z,
        (buffer[2] * factor + buffer[6] * seconds) * EARTH_RADIUS + next.y
    );
    assert.ok(errorKm < 0.2, `prediction error was ${errorKm} km`);

    writeOrbitState(buffer, 0, null, jday(time));
    assert.equal(buffer[3], 0);
});

test('picking uses the displayed position and excludes Earth-occluded, invalid and hidden markers', () => {
    const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100);
    camera.position.z = 3;
    camera.updateMatrixWorld();
    const viewport = { width: 800, height: 600 };
    const satellites = [{ id: 'behind Earth' }, { id: 'invalid' }, { id: 'visible' }];
    const group = {
        satellites,
        array: new Float32Array([
            0, 0, -1.2, 1, 0, 0, 0,
            0, 0, 1.2, 0, 0, 0, 0,
            0, 0, 1.2, 1, 0.001, 0, 0
        ]),
        seconds: 30,
        pickable: true,
        hiddenIndex: -1
    };
    const pick = (x, mask = 2, selection = null) => pickOrbitMarker([null, group], camera, viewport, x, 300, mask, selection);
    assert.equal(pick(400), null);
    assert.equal(pick(412), satellites[2]);
    assert.equal(pick(418), satellites[2]);
    assert.equal(pick(412, 0), null);
    assert.equal(pick(412, 2, 'visible'), null);
    group.hiddenIndex = 2;
    assert.equal(pick(412), null);
});
