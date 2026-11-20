import { jday } from 'satellite.js';
import { createSatrec } from './propagation.js';
import { ORBIT_STRIDE, writeOrbitState } from './orbitMarkers.js';

let groups = [];

self.onmessage = ({ data }) => {
    if (data.elements) {
        groups = data.elements.map(group => group.map(createSatrec));
        return;
    }

    const { time, revision, mask, reusable } = data;
    const julianDate = jday(new Date(time));
    const buffers = groups.map((group, index) => {
        if (!(mask & (1 << index)) || group.length === 0) return reusable?.[index] ?? null;
        const buffer = reusable?.[index] ?? new Float32Array(group.length * ORBIT_STRIDE);
        for (let i = 0; i < group.length; i++) {
            writeOrbitState(buffer, i * ORBIT_STRIDE, group[i], julianDate);
        }
        return buffer;
    });
    self.postMessage({ time, revision, mask, buffers }, buffers.flatMap(buffer => buffer ? [buffer.buffer] : []));
};
