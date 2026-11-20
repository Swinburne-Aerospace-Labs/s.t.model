import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, Html } from '@react-three/drei';
import { propagateSatellite, EARTH_RADIUS } from '../services/propagation';
import { SIM_STATE } from '../services/simulationState';

const SCALE = 1 / EARTH_RADIUS;

const Satellite = ({ tle1, tle2, satrec, name, category, isSelected, orbitalPeriod, targetRef }) => {
    const meshRef = useRef();
    const lastTime = useRef(null);

    useFrame(({ camera }) => {
        const mesh = meshRef.current;
        if (!mesh) return;

        if (lastTime.current !== SIM_STATE.simTime) {
            lastTime.current = SIM_STATE.simTime;
            const pv = propagateSatellite(tle1, tle2, new Date(SIM_STATE.simTime), satrec);
            mesh.visible = Boolean(pv);
            if (pv) {
                const { x, y, z } = pv.position;
                mesh.position.set(x * SCALE, z * SCALE, -y * SCALE);
            }
        }
        if (targetRef) targetRef.current = mesh.visible ? mesh.position : null;
        if (!mesh.visible) return;

        const distance = camera.position.distanceTo(mesh.position);
        const baseScale = isSelected ? 0.015 : 0.01;
        const radius = Math.min(Math.max(distance * baseScale * 0.45, 0.001), 0.04);
        mesh.scale.setScalar(radius / baseScale);
    }, -2);

    const orbitPoints = useMemo(() => {
        if (!isSelected) return null;
        const path = [];
        const segments = 150;
        const step = orbitalPeriod / segments;
        const now = new Date(SIM_STATE.simTime);
        for (let i = 0; i <= segments; i++) {
            const time = new Date(now.getTime() + i * step * 60000);
            const pv = propagateSatellite(tle1, tle2, time, satrec);
            if (pv) {
                const pos = pv.position;
                path.push([pos.x * SCALE, pos.z * SCALE, -pos.y * SCALE]);
            }
        }
        return path;
    }, [tle1, tle2, satrec, isSelected, orbitalPeriod]);

    return (
        <group>
            <mesh ref={meshRef} renderOrder={10}>
                <sphereGeometry args={[isSelected ? 0.015 : 0.008, 16, 16]} />
                <meshBasicMaterial color="#ED1C2E" />

                <Html style={{ pointerEvents: 'none' }}>
                    <div className="satellite-label visible" style={{
                        background: '#111',
                        border: '1px solid #333',
                        padding: '8px 14px',
                        fontSize: '11px',
                        fontFamily: 'Unbounded',
                        whiteSpace: 'nowrap',
                        color: '#fff',
                        pointerEvents: 'none',
                        borderRadius: '4px'
                    }}>
                        {name} <span style={{ color: '#666', fontSize: '10px', marginLeft: '5px' }}>({category})</span>
                    </div>
                </Html>
            </mesh>

            {isSelected && orbitPoints && (
                <Line
                    points={orbitPoints}
                    color="#ED1C2E"
                    lineWidth={2}
                    transparent={true}
                    opacity={0.6}
                    renderOrder={5}
                />
            )}
        </group>
    );
};

export default Satellite;
