import { useState, useEffect } from 'react';
import { catalogKey, hasCatalogName, processCatalog } from '../services/catalog';

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
            if (cached?.source === 'spacebook' && cached.hasObjectNames && !cached.stale && Date.now() - cached.timestamp < EXPIRY) return;
            try {
                const response = await fetch('/api/satellites', { signal: AbortSignal.timeout(65000) });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
                if (!['spacebook', 'celestrak-active'].includes(result.source) || !Array.isArray(result.satellites) || result.satellites.length < (result.source === 'spacebook' ? 10000 : 1)) throw new Error('Incomplete catalog response');
                if (valid && cached?.source === 'spacebook' && result.source !== 'spacebook') {
                    if (!cancelled) setStatus(`OFFLINE: STALE CATALOG (${cached.satellites.length.toLocaleString()} OBJECTS)`);
                    return;
                }
                if (result.source === 'spacebook' && cached?.source === 'spacebook' && (!result.hasObjectNames || !result.hasObjectTypes)) {
                    const lastKnown = new Map(cached.satellites.map(row => [catalogKey(row[0]), row]));
                    result.satellites = result.satellites.map(([id, name, tle1, tle2, type]) => {
                        const previous = lastKnown.get(catalogKey(id));
                        if (!previous) return [id, name, tle1, tle2, type];
                        const displayName = hasCatalogName(name, id) || !hasCatalogName(previous[1], id)
                            ? name
                            : previous[1];
                        return [id, displayName, tle1, tle2, type ?? previous[4]];
                    });
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
