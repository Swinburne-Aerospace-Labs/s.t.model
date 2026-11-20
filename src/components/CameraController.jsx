import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useRef, useEffect } from 'react';
import { easing } from 'maath';

const ORIGIN = new THREE.Vector3();
const idealPosition = new THREE.Vector3();

const CameraController = ({ targetRef, isSelected }) => {
    const { camera, controls } = useThree();

    // Zoom state
    const targetDistance = useRef(camera.position.length());

    useEffect(() => {
        if (isSelected) targetDistance.current = 0.5;
    }, [isSelected]);

    // Handle smooth scroll wheel zoom AND custom events
    useEffect(() => {
        const handleWheel = (e) => {
            const zoomSpeed = 0.0015;
            targetDistance.current = Math.min(Math.max(targetDistance.current + e.deltaY * zoomSpeed, 0.1), 15);
        };

        const handleCustomZoom = (e) => {
            const { factor, reset } = e.detail;
            if (reset) {
                targetDistance.current = 3;
            } else {
                targetDistance.current = Math.min(Math.max(targetDistance.current * factor, 0.1), 15);
            }
        };

        window.addEventListener('wheel', handleWheel, { passive: true });
        window.addEventListener('nav-zoom', handleCustomZoom);

        return () => {
            window.removeEventListener('wheel', handleWheel);
            window.removeEventListener('nav-zoom', handleCustomZoom);
        };
    }, []);

    useFrame((state, delta) => {
        const targetPosition = isSelected ? targetRef.current : ORIGIN;
        if (controls && targetPosition) {
            easing.damp3(controls.target, targetPosition, 0.15, delta);
        }

        // Handle Smooth Zoom Easing (Radius control)
        const center = controls ? controls.target : ORIGIN;
        idealPosition.copy(camera.position).sub(center).normalize().multiplyScalar(targetDistance.current).add(center);

        easing.damp3(camera.position, idealPosition, 0.25, delta);
    });

    return null;
};

export default CameraController;
