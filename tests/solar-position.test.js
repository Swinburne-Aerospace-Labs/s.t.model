import test from 'node:test';
import assert from 'node:assert/strict';
import { gstime } from 'satellite.js';
import { SphereGeometry, Vector3 } from 'three';
import { setSunDirection } from '../src/services/solarPosition.js';
import {
    SIM_STATE, updateSimulationTime, setSimulationSpeed, setSimulationPaused, resetSimulationTime
} from '../src/services/simulationState.js';

const north = new Vector3(0, 1, 0);
const radians = degrees => degrees * Math.PI / 180;

test('the Sun crosses the equator and reaches the correct hemisphere at each solstice', () => {
    // 2026 equinoxes and solstices from the US Naval Observatory.
    for (const [timestamp, expectedDeclination] of [
        ['2026-03-20T14:46:00Z', 0],
        ['2026-06-21T08:24:00Z', 23.44],
        ['2026-09-23T00:05:00Z', 0],
        ['2026-12-21T20:50:00Z', -23.44]
    ]) {
        const direction = setSunDirection(new Vector3(), new Date(timestamp), 1);
        assert.ok(Math.abs(direction.length() - 1) < 1e-12);
        assert.ok(Math.abs(Math.asin(direction.y) - radians(expectedDeclination)) < radians(0.1), timestamp);
    }
});

test('fast-forward rotates the map from daylight into night beneath the Sun', t => {
    let wallTime = Date.parse('2026-11-20T12:00:00Z');
    t.mock.method(Date, 'now', () => wallTime);
    resetSimulationTime();
    const sphere = new SphereGeometry(1, 64, 64);
    const greenwich = new Vector3().fromBufferAttribute(sphere.attributes.position, 32 * 65 + 32);
    sphere.dispose();

    const greenwichLight = () => {
        const time = new Date(SIM_STATE.simTime);
        const surfaceNormal = greenwich.clone().applyAxisAngle(north, gstime(time));
        return surfaceNormal.dot(setSunDirection(new Vector3(), time, 1));
    };

    assert.ok(greenwichLight() > 0.9);
    setSimulationSpeed(100);
    wallTime += 432_000;
    updateSimulationTime();
    assert.equal(SIM_STATE.simTime, Date.parse('2026-11-21T00:00:00Z'));
    assert.ok(greenwichLight() < -0.9);

    setSimulationPaused(true);
    const night = greenwichLight();
    wallTime += 5_000;
    updateSimulationTime();
    assert.equal(greenwichLight(), night);

    setSimulationSpeed(1);
    setSimulationPaused(false);
    resetSimulationTime();
    wallTime += 1_000;
    updateSimulationTime();
    assert.equal(SIM_STATE.simTime, wallTime);
    assert.equal(SIM_STATE.realTime, wallTime);
});
