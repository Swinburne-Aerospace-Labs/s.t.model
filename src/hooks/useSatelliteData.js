import { useState, useEffect } from 'react';

const FIELDS = ['NORAD_CAT_ID', 'OBJECT_NAME', 'OBJECT_ID', 'OBJECT_TYPE', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'];
const EXPIRY = 12 * 60 * 60 * 1000;

function database() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('space-traffic-catalog', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('catalog');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function cacheOperation(mode, value) {
    const db = await database();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('catalog', mode);
            const store = tx.objectStore('catalog');
            const request = value ? store.put(value, 'latest') : store.get('latest');
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } finally { db.close(); }
}
function processCatalog(rows, source) {
    return rows.map(row => {
        if (source === 'spacebook') {
            const [id, name, tle1, tle2] = row;
            const category = /^(ISS |CSS |TIANGONG)/i.test(name) ? 'STATION' : /\bDEB\b|R\/B/i.test(name) ? 'DEBRIS' : 'PAYLOAD';
            return { id: String(id), name, category, tle1, tle2 };
        }
        const omm = {};
        for (let i = 0; i < FIELDS.length; i++) omm[FIELDS[i]] = row[i];
        const name = omm.OBJECT_NAME || `OBJECT ${omm.NORAD_CAT_ID}`;
        const type = (omm.OBJECT_TYPE || '').toUpperCase();
        const category = /^(ISS |CSS |TIANGONG)/i.test(name) ? 'STATION' :
            (type === 'DEBRIS' || type === 'ROCKET BODY' || /\bDEB\b|R\/B/i.test(name)) ? 'DEBRIS' : 'PAYLOAD';
        return { id: String(omm.NORAD_CAT_ID), name, category, omm };
    });
}
export const useSatelliteData = () => {
    const [satellites, setSatellites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState('SYNCING...');
    useEffect(() => {
        let cancelled = false;
        async function load() {
            let cached;
            try { cached = await cacheOperation('readonly'); } catch (err) { console.warn('Catalog cache unavailable', err); }
            if (cancelled) return;
            if (cancelled) return;
            const valid = ['spacebook', 'celestrak-active'].includes(cached?.source) && Array.isArray(cached.satellites) && cached.satellites.length >= (cached.source === 'spacebook' ? 10000 : 1);
            if (!valid) cached = null;
            const show = (data, label) => {
                if (cancelled) return;
                const processed = processCatalog(data.satellites, data.source);
                setSatellites(processed);
                setStatus(`${data.source === 'celestrak-active' ? 'PARTIAL ACTIVE CATALOG' : label}: ${processed.length.toLocaleString()} OBJECTS`);
                setLoading(false);
                setError(null);
            };
            if (valid) {
                try { show(cached, !cached.stale && Date.now() - cached.timestamp < EXPIRY ? 'CACHED' : 'STALE CACHE'); }
                catch (err) { console.warn('Catalog cache invalid', err); cached = null; }
            }
            if (valid && cached?.source === 'spacebook' && !cached.stale && Date.now() - cached.timestamp < EXPIRY) return;
            try {
                const response = await fetch('/api/satellites', { signal: AbortSignal.timeout(65000) });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
                if (!['spacebook', 'celestrak-active'].includes(result.source) || !Array.isArray(result.satellites) || result.satellites.length < (result.source === 'spacebook' ? 10000 : 1)) throw new Error('Incomplete catalog response');
                if (valid && cached?.source === 'spacebook' && result.source !== 'spacebook') {
                    if (!cancelled) setStatus(`OFFLINE: STALE CATALOG (${cached.satellites.length.toLocaleString()} OBJECTS)`);
                    return;
                }
                show(result, result.stale ? 'STALE CACHE' : 'ACTIVE');
                try { await cacheOperation('readwrite', result); } catch (err) { console.warn('Could not save catalog', err); }
            } catch (err) {
                if (!cancelled) {
                    if (cached) setStatus('OFFLINE: STALE CATALOG');
                    else { setError(`CATALOG UNAVAILABLE: ${err.message}`); setStatus('SYSTEM: ERROR'); setLoading(false); }
                }
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);
    return { satellites, loading, error, status };
};
