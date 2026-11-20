import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createSatrec } from '../services/propagation';
import {
    HALF_GRAVITY, MARKER_SCALE, MARKER_MIN_RADIUS, MARKER_MAX_RADIUS, ORBIT_STRIDE, pickOrbitMarker
} from '../services/orbitMarkers';
import { SIM_STATE } from '../services/simulationState';
import Satellite from './Satellite';

const CATEGORIES = ['STATION', 'PAYLOAD', 'DEBRIS'];
const COLORS = ['#00aa00', '#888', '#333'];
const SAMPLE_INTERVAL_MS = 125;
const MAX_PREDICTION_SECONDS = 30;
const CLICK_SLOP_PX = 5;

const vertexShader = `
    attribute vec4 orbitPosition;
    attribute vec3 orbitVelocity;
    uniform float seconds;
    uniform int hiddenIndex;
    varying vec2 markerUV;

    void main() {
        if (orbitPosition.w == 0.0 || gl_InstanceID == hiddenIndex) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
        }
        vec3 origin = orbitPosition.xyz;
        float inverseRadius = inversesqrt(dot(origin, origin));
        float gravity = ${HALF_GRAVITY.toExponential()} * seconds * seconds;
        vec3 center = origin * (1.0 - gravity * inverseRadius * inverseRadius * inverseRadius)
            + orbitVelocity * seconds;
        vec4 viewCenter = viewMatrix * vec4(center, 1.0);
        float radius = clamp(length(viewCenter.xyz) * ${MARKER_SCALE}, ${MARKER_MIN_RADIUS}, ${MARKER_MAX_RADIUS});
        markerUV = position.xy;
        viewCenter.xy += markerUV * radius;
        gl_Position = projectionMatrix * viewCenter;
    }
`;

const fragmentShader = `
    uniform vec3 color;
    uniform float opacity;
    varying vec2 markerUV;

    void main() {
        float distance = length(markerUV);
        float edge = max(fwidth(distance), 0.001);
        float coverage = 1.0 - smoothstep(1.0 - edge, 1.0, distance);
        if (coverage <= 0.0) discard;
        gl_FragColor = vec4(color, opacity * coverage);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

function createGroup(satellites, color) {
    if (!satellites.length) return null;

    const array = new Float32Array(satellites.length * ORBIT_STRIDE);
    const orbits = new THREE.InstancedInterleavedBuffer(array, ORBIT_STRIDE);
    orbits.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.instanceCount = satellites.length;
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    geometry.setAttribute('orbitPosition', new THREE.InterleavedBufferAttribute(orbits, 4, 0));
    geometry.setAttribute('orbitVelocity', new THREE.InterleavedBufferAttribute(orbits, 3, 4));

    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            color: { value: new THREE.Color(color) },
            opacity: { value: 0 },
            seconds: { value: 0 },
            hiddenIndex: { value: -1 }
        },
        transparent: true,
        depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    return { mesh, orbits, array, satellites, sample: null, seconds: 0, hiddenIndex: -1, pickable: false };
}

const SatellitesInstanced = ({ satellites, selectedSatId, categoryFilters, onClick }) => {
    const root = useRef(null);
    const runtime = useRef(null);
    const { gl, camera, events } = useThree();
    const eventTarget = events.connected || gl.domElement;
    const [hoveredSat, setHoveredSat] = useState(null);

    const groups = useMemo(() => {
        const result = [[], [], []];
        for (const sat of satellites) {
            const index = CATEGORIES.indexOf(sat.category);
            result[index < 0 ? 1 : index].push(sat);
        }
        return result;
    }, [satellites]);
    const hiddenIndices = useMemo(() => groups.map(group =>
        selectedSatId === null ? -1 : group.findIndex(sat => sat.id === selectedSatId)
    ), [groups, selectedSatId]);
    let activeMask = 0;
    for (let index = 0; index < groups.length; index++) {
        if (groups[index].length && !categoryFilters.ONLY_SELECTED && categoryFilters[CATEGORIES[index]]) {
            activeMask |= 1 << index;
        }
    }

    useEffect(() => {
        if (!satellites.length) return;
        const parent = root.current;
        const markers = groups.map((group, index) => createGroup(group, COLORS[index]));
        for (const marker of markers) if (marker) parent.add(marker.mesh);
        const worker = new Worker(new URL('../services/orbitWorker.js', import.meta.url), { type: 'module' });
        const state = { worker, markers, lastRequest: null, busy: false, pending: null, reusable: null };
        runtime.current = state;
        worker.onmessage = ({ data }) => {
            state.pending = data;
            state.busy = false;
        };
        worker.postMessage({ elements: groups.map(group => group.map(({ omm, tle1, tle2 }) => ({ omm, tle1, tle2 }))) });

        return () => {
            runtime.current = null;
            worker.terminate();
            for (const marker of markers) {
                if (!marker) continue;
                parent.remove(marker.mesh);
                marker.mesh.geometry.dispose();
                marker.mesh.material.dispose();
            }
        };
    }, [satellites, groups]);

    useFrame((_, delta) => {
        const state = runtime.current;
        if (!state) return;
        const { simTime, revision } = SIM_STATE;
        const sample = state.pending;
        if (sample) {
            for (let index = 0; index < state.markers.length; index++) {
                if (sample.revision !== revision || !(sample.mask & (1 << index))) continue;
                const marker = state.markers[index];
                marker.array.set(sample.buffers[index]);
                marker.orbits.needsUpdate = true;
                marker.sample = { time: sample.time, revision };
            }
            state.reusable = sample.buffers;
            state.pending = null;
        }

        let needsSample = false;
        for (let index = 0; index < state.markers.length; index++) {
            const marker = state.markers[index];
            if (!marker) continue;
            const { mesh } = marker;
            const active = Boolean(activeMask & (1 << index));
            const ready = marker.sample?.revision === revision;
            if (active && !ready) needsSample = true;
            const { uniforms } = mesh.material;
            uniforms.opacity.value = THREE.MathUtils.damp(uniforms.opacity.value, active && ready ? 1 : 0, 20, delta);
            mesh.visible = ready && uniforms.opacity.value > 0.01;
            marker.pickable = active && mesh.visible;
            if (!mesh.visible) {
                if (!active) marker.sample = null;
                continue;
            }

            marker.seconds = Math.min(Math.max((simTime - marker.sample.time) / 1000, 0), MAX_PREDICTION_SECONDS);
            marker.hiddenIndex = hiddenIndices[index];
            uniforms.seconds.value = marker.seconds;
            uniforms.hiddenIndex.value = marker.hiddenIndex;
        }

        if (!activeMask || state.busy) return;
        const now = performance.now();
        const last = state.lastRequest;
        const refresh = needsSample || !last || last.revision !== revision || last.mask !== activeMask;
        if (!refresh && (last.time === simTime || (!SIM_STATE.paused && now - last.requestedAt < SAMPLE_INTERVAL_MS))) return;

        const reusable = state.reusable;
        state.reusable = null;
        state.lastRequest = { time: simTime, requestedAt: now, revision, mask: activeMask };
        state.busy = true;
        state.worker.postMessage({ time: simTime, revision, mask: activeMask, reusable },
            reusable?.flatMap(buffer => buffer ? [buffer.buffer] : []) ?? []);
    });

    useEffect(() => {
        const canvas = gl.domElement;
        let pointer = null;
        let press = null;
        let frame = 0;

        const pick = ({ clientX, clientY }) => {
            const markers = runtime.current?.markers;
            if (!markers) return null;
            const bounds = canvas.getBoundingClientRect();
            const x = clientX - bounds.left;
            const y = clientY - bounds.top;
            if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) return null;
            return pickOrbitMarker(markers, camera, bounds, x, y, activeMask, selectedSatId);
        };
        const cancelHover = () => {
            cancelAnimationFrame(frame);
            frame = 0;
            setHoveredSat(null);
        };
        const move = (event) => {
            if (press?.pointerId === event.pointerId &&
                Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) > CLICK_SLOP_PX) press = null;
            if (event.target !== canvas || event.pointerType === 'touch' || event.buttons !== 0 || !activeMask) return;
            pointer = event;
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                setHoveredSat(pick(pointer));
            });
        };
        const down = (event) => {
            if (event.target !== canvas || !event.isPrimary || event.button !== 0) return;
            press = event;
            cancelHover();
        };
        const up = (event) => {
            if (press?.pointerId !== event.pointerId || event.button !== 0) return;
            const start = press;
            press = null;
            if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > CLICK_SLOP_PX) return;
            const sat = pick(event);
            if (sat) onClick(sat.id);
        };
        const leave = () => {
            press = null;
            cancelHover();
        };

        // Listen on the same surface as the navigation controls.
        eventTarget.addEventListener('pointermove', move);
        eventTarget.addEventListener('pointerdown', down);
        eventTarget.addEventListener('pointerup', up);
        eventTarget.addEventListener('pointerleave', leave);
        eventTarget.addEventListener('pointercancel', leave);
        return () => {
            cancelAnimationFrame(frame);
            eventTarget.removeEventListener('pointermove', move);
            eventTarget.removeEventListener('pointerdown', down);
            eventTarget.removeEventListener('pointerup', up);
            eventTarget.removeEventListener('pointerleave', leave);
            eventTarget.removeEventListener('pointercancel', leave);
        };
    }, [gl, camera, eventTarget, activeMask, selectedSatId, onClick]);

    const currentHover = useMemo(() => hoveredSat && satellites.includes(hoveredSat) ? hoveredSat : null,
        [hoveredSat, satellites]);
    const hoverCategory = currentHover && (CATEGORIES.includes(currentHover.category) ? currentHover.category : 'PAYLOAD');
    const hoverActive = currentHover && currentHover.id !== selectedSatId && !categoryFilters.ONLY_SELECTED &&
        categoryFilters[hoverCategory];
    const hoverRecord = useMemo(() => hoveredSat && createSatrec(hoveredSat), [hoveredSat]);

    return (
        <>
            <group ref={root} />
            {hoverActive && hoverRecord && <Satellite key={hoveredSat.id} {...hoveredSat} satrec={hoverRecord} />}
        </>
    );
};

export default SatellitesInstanced;
