import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere, useTexture } from '@react-three/drei';
import { gstime } from 'satellite.js';
import { Vector3 } from 'three';
import { SIM_STATE } from '../services/simulationState';
import { setSunDirection } from '../services/solarPosition';

const vertexShader = `
    varying vec2 mapUv;
    varying vec3 worldNormal;

    void main() {
        mapUv = uv;
        worldNormal = mat3(modelMatrix) * normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    uniform sampler2D earthMap;
    uniform vec3 sunDirection;
    varying vec2 mapUv;
    varying vec3 worldNormal;

    void main() {
        float incidence = dot(normalize(worldNormal), sunDirection);
        float daylight = 0.40 * max(incidence, 0.0);
        // Approximate scattered sunlight around dawn and dusk.
        float twilight = 0.1 * smoothstep(-0.16, 0.16, incidence);
        float nightFill = 0.10;
        vec3 surface = texture2D(earthMap, mapUv).rgb;
        gl_FragColor = vec4(surface * (daylight + twilight + nightFill), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const Earth = () => {
    const earthRef = useRef();

    const texture = useTexture('/texturemap.jpg');
    const uniforms = useMemo(() => ({
        earthMap: { value: texture },
        sunDirection: { value: new Vector3() }
    }), [texture]);

    useFrame(() => {
        const time = new Date(SIM_STATE.simTime);
        setSunDirection(uniforms.sunDirection.value, time, 1);
        // The map puts Greenwich on +X and east toward -Z when sidereal time is zero.
        earthRef.current.rotation.y = gstime(time);
    });

    return (
        <group ref={earthRef}>
            <Sphere args={[1, 64, 64]}>
                <shaderMaterial
                    uniforms={uniforms}
                    vertexShader={vertexShader}
                    fragmentShader={fragmentShader}
                />
            </Sphere>
        </group>
    );
};

export default Earth;
