import { jday } from 'satellite.js';

const RADIANS_PER_DEGREE = Math.PI / 180;

export function setSunDirection(target, time, distance) {
    // US Naval Observatory approximation: https://aa.usno.navy.mil/faq/sun_approx
    const days = jday(time) - 2451545;
    const anomaly = ((357.529 + 0.98560028 * days) % 360) * RADIANS_PER_DEGREE;
    const meanLongitude = (280.459 + 0.98564736 * days) % 360;
    const longitude = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.020 * Math.sin(2 * anomaly)) * RADIANS_PER_DEGREE;
    const obliquity = (23.439 - 0.00000036 * days) * RADIANS_PER_DEGREE;
    const eclipticY = Math.sin(longitude) * distance;

    // Rotate the ecliptic into the equatorial frame, then map (X, Y, Z) to (X, Z, -Y).
    // The globe and satellite orbits share this equatorial frame with north along +Y.
    return target.set(
        Math.cos(longitude) * distance,
        Math.sin(obliquity) * eclipticY,
        -Math.cos(obliquity) * eclipticY
    );
}
