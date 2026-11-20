import { sgp4 } from 'satellite.js';
import { EARTH_RADIUS } from './propagation.js';

export const ORBIT_STRIDE = 7;
export const MARKER_SCALE = 0.008 * 0.45;
export const MARKER_MIN_RADIUS = 0.001;
export const MARKER_MAX_RADIUS = 0.04;
// Half of Earth's gravitational parameter, in scene units cubed per second squared.
export const HALF_GRAVITY = 398600.4418 / (2 * EARTH_RADIUS ** 3);

export function writeOrbitState(buffer, offset, satrec, julianDate) {
    const state = satrec && sgp4(satrec, (julianDate - satrec.jdsatepoch) * 1440);
    const pos = state?.position;
    const vel = state?.velocity;
    if (!pos || !vel || !Number.isFinite(pos.x + pos.y + pos.z + vel.x + vel.y + vel.z)) {
        buffer[offset + 3] = 0;
        return;
    }
    buffer[offset] = pos.x / EARTH_RADIUS;
    buffer[offset + 1] = pos.z / EARTH_RADIUS;
    buffer[offset + 2] = -pos.y / EARTH_RADIUS;
    buffer[offset + 3] = 1;
    buffer[offset + 4] = vel.x / EARTH_RADIUS;
    buffer[offset + 5] = vel.z / EARTH_RADIUS;
    buffer[offset + 6] = -vel.y / EARTH_RADIUS;
}

// Match the marker shader's prediction and projection so picking uses the displayed positions.
export function pickOrbitMarker(groups, camera, viewport, pointerX, pointerY, activeMask, selectedId) {
    const view = camera.matrixWorldInverse.elements;
    const proj = camera.projectionMatrix.elements;
    const cam = camera.position;
    const halfWidth = viewport.width / 2;
    const halfHeight = viewport.height / 2;
    const pixelScale = halfHeight * proj[5];
    const earthOffset = cam.lengthSq() - 1;
    let bestSatellite = null;
    let bestDistance = Infinity;
    let bestDepth = Infinity;

    for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        if (!group?.pickable || !(activeMask & (1 << index))) continue;
        const { array, satellites, seconds, hiddenIndex } = group;
        const gravity = HALF_GRAVITY * seconds * seconds;
        for (let i = 0, offset = 0; i < satellites.length; i++, offset += ORBIT_STRIDE) {
            if (i === hiddenIndex || array[offset + 3] === 0) continue;

            const x = array[offset];
            const y = array[offset + 1];
            const z = array[offset + 2];
            const radiusSquared = x * x + y * y + z * z;
            const factor = 1 - gravity / (radiusSquared * Math.sqrt(radiusSquared));
            const px = x * factor + array[offset + 4] * seconds;
            const py = y * factor + array[offset + 5] * seconds;
            const pz = z * factor + array[offset + 6] * seconds;
            const depth = -(view[2] * px + view[6] * py + view[10] * pz + view[14]);
            if (depth < camera.near || depth > camera.far) continue;

            const screenX = halfWidth * (1 + proj[0] * (view[0] * px + view[4] * py + view[8] * pz + view[12]) / depth);
            const screenY = halfHeight * (1 - proj[5] * (view[1] * px + view[5] * py + view[9] * pz + view[13]) / depth);
            const dx = screenX - pointerX;
            const dy = screenY - pointerY;
            const distance = dx * dx + dy * dy;
            if (distance > bestDistance || (distance === bestDistance && depth >= bestDepth)) continue;

            const rx = px - cam.x;
            const ry = py - cam.y;
            const rz = pz - cam.z;
            const rayLength = Math.sqrt(rx * rx + ry * ry + rz * rz);
            const radius = Math.min(Math.max(rayLength * MARKER_SCALE, MARKER_MIN_RADIUS), MARKER_MAX_RADIUS);
            const hitRadius = Math.max(7, pixelScale * radius / depth);
            if (distance > hitRadius * hitRadius || satellites[i].id === selectedId) continue;

            // Test the segment to the marker center against the unit-radius Earth.
            const alongRay = -(cam.x * rx + cam.y * ry + cam.z * rz) / rayLength;
            const discriminant = alongRay * alongRay - earthOffset;
            if (earthOffset >= 0 && discriminant >= 0 && alongRay > 0 &&
                alongRay - Math.sqrt(discriminant) < rayLength) continue;

            bestSatellite = satellites[i];
            bestDistance = distance;
            bestDepth = depth;
        }
    }
    return bestSatellite;
}
