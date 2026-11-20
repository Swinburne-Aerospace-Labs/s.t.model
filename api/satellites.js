import process from 'node:process';
import fs from 'fs';
import path from 'path';
import { gzipSync } from 'node:zlib';

const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
const CACHE_FILE = path.join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'satellite-spacebook-cache-v1.json');
const FALLBACK_CACHE_FILE = path.join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'satellite-active-cache-v1.json');
let refreshPromise;
let fallbackPromise;
const RATE_LIMIT_FILE = path.join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'satellite-active-rate-limit.json');
const RATE_LIMIT_DELAY = 2 * 60 * 60 * 1000;

const OMM_FIELDS = ['NORAD_CAT_ID', 'OBJECT_NAME', 'OBJECT_ID', 'OBJECT_TYPE', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'];

function compactRecords(records, minimum) {
    if (!Array.isArray(records) || records.length < minimum) throw new Error('Catalog response is incomplete');
    const ids = new Set();
    const valid = [];
    for (const record of records) {
        if (!record.NORAD_CAT_ID || !record.EPOCH || !Number.isFinite(Date.parse(record.EPOCH)) || !Number(record.MEAN_MOTION) || ['ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR'].some(field => record[field] == null || !Number.isFinite(Number(record[field]))) || ids.has(String(record.NORAD_CAT_ID))) continue;
        ids.add(String(record.NORAD_CAT_ID));
        valid.push(OMM_FIELDS.map(field => record[field] ?? null));
    }
    if (valid.length < minimum || valid.length < records.length * 0.95) throw new Error('Catalog contains too many invalid records');
    return valid;
}

export async function fetchActiveCatalog() {
    const response = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=JSON', { signal: AbortSignal.timeout(10000), redirect: 'manual' });
    if (response.status === 403) {
        try { fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify({ until: Date.now() + RATE_LIMIT_DELAY })); } catch { /* Cache is optional. */ }
        throw new Error('CelesTrak rate limit reached; retry after its next update (up to two hours)');
    }
    if (!response.ok) throw new Error(`CelesTrak request failed (HTTP ${response.status})`);
    return compactRecords(await response.json(), 1);
}

// Spacebook publishes a bulk TLE catalog, with or without an optional name line.
export function parseTleCatalog(text, minimum = 10000) {
    const lines = text.split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.trim());
    const records = [];
    const ids = new Set();
    let invalid = 0;
    let name = '';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('1 ')) {
            if (line.startsWith('2 ')) invalid++;
            else name = line.replace(/^0 /, '').trim();
            continue;
        }
        const line2 = lines[++i] || '';
        const rawId = line.slice(2, 7).trim();
        const match = /^([A-HJ-NP-Z])(\d{4})$/.exec(rawId);
        const id = match ? String(('ABCDEFGHJKLMNPQRSTUVWXYZ'.indexOf(match[1]) + 10) * 10000 + Number(match[2])) : rawId;
        const epoch = Number(line.slice(18, 32));
        const meanMotion = Number(line2.slice(52, 63));
        const fieldsValid = [line2.slice(8, 16), line2.slice(17, 25), line2.slice(34, 42), line2.slice(43, 51)].every(value => value.trim() && Number.isFinite(Number(value)));
        if (line.length < 69 || line2.length < 69 || !line2.startsWith('2 ') || line2.slice(2, 7).trim() !== rawId || !/^\d+$/.test(id) || !Number.isFinite(epoch) || !epoch || !Number.isFinite(meanMotion) || meanMotion <= 0 || !fieldsValid || !/^\d{7}$/.test(line2.slice(26, 33)) || ids.has(id)) {
            invalid++;
        } else {
            ids.add(id);
            records.push([id, name || `OBJECT ${id}`, line, line2]);
        }
        name = '';
    }
    if (records.length < minimum || invalid > (records.length + invalid) * 0.05) throw new Error('Spacebook catalog is incomplete or invalid');
    return records;
}

export async function fetchFullCatalog() {
    const response = await fetch('https://spacebook.comspoc.com/api/entity/tle', { signal: AbortSignal.timeout(50000) });
    if (!response.ok) throw new Error(`Spacebook catalog request failed (HTTP ${response.status})`);
    return parseTleCatalog(await response.text());
}

const loadCache = (file = CACHE_FILE, source = 'spacebook') => {
    try {
        if (fs.existsSync(file)) {
            const cacheData = JSON.parse(fs.readFileSync(file, 'utf8'));
            const age = Date.now() - cacheData.timestamp;

            if (cacheData.source === source && Array.isArray(cacheData.data) && cacheData.data.length >= (source === 'spacebook' ? 10000 : 1)) {
                console.log(`[API] Cache hit - age: ${Math.round(age / 3600000)}h, satellites: ${cacheData.data.length}`);
                return cacheData;
            } else {
                console.log(`[API] Cache expired - age: ${Math.round(age / 3600000)}h`);
            }
        }
    } catch (error) {
        console.error('[API] Cache read error:', error.message);
    }
    return null;
};

const saveCache = (data, file = CACHE_FILE, source = 'spacebook') => {
    try {
        const cacheData = {
            data,
            source,
            timestamp: Date.now()
        };
        fs.writeFileSync(file, JSON.stringify(cacheData), 'utf8');
        console.log(`[API] Cached ${data.length} satellites`);
    } catch (error) {
        console.error('[API] Cache write error:', error.message);
    }
};

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const sendCatalog = payload => {
        res.setHeader('Cache-Control', 'no-store');
        if (/\bgzip\b/.test(req.headers?.['accept-encoding'] || '')) {
            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Vary', 'Accept-Encoding');
            return res.status(200).end(gzipSync(JSON.stringify(payload)));
        }
        return res.status(200).json(payload);
    };

    try {
        const cached = loadCache();
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
            return sendCatalog({ satellites: cached.data, source: 'spacebook', cached: true, timestamp: cached.timestamp });
        }
        try {
            if (!refreshPromise) refreshPromise = fetchFullCatalog().finally(() => { refreshPromise = null; });
            const data = await refreshPromise;
            if (cached && data.length < cached.data.length * 0.8) throw new Error('Catalog shrank unexpectedly');
            saveCache(data);
            return sendCatalog({ satellites: data, source: 'spacebook', cached: false, timestamp: Date.now() });
        } catch (error) {
            console.error('[API] Catalog refresh failed:', error.message);
            if (cached) return sendCatalog({ satellites: cached.data, source: 'spacebook', cached: true, stale: true, timestamp: cached.timestamp });
            // Active satellites are a subset, so never label or save this as a full catalog.
            const fallback = loadCache(FALLBACK_CACHE_FILE, 'celestrak-active');
            if (fallback && Date.now() - fallback.timestamp < CACHE_DURATION) {
                return sendCatalog({ satellites: fallback.data, source: 'celestrak-active', cached: true, timestamp: fallback.timestamp });
            }
            try {
                let blockedUntil = 0;
                try { blockedUntil = JSON.parse(fs.readFileSync(RATE_LIMIT_FILE, 'utf8')).until || 0; } catch { /* No previous rate limit. */ }
                if (blockedUntil > Date.now()) throw new Error('CelesTrak rate limit reached; retry after its next update (up to two hours)');
                if (!fallbackPromise) fallbackPromise = fetchActiveCatalog().finally(() => { fallbackPromise = null; });
                const data = await fallbackPromise;
                saveCache(data, FALLBACK_CACHE_FILE, 'celestrak-active');
                return sendCatalog({ satellites: data, source: 'celestrak-active', cached: false, timestamp: Date.now() });
            } catch (fallbackError) {
                console.error('[API] Active catalog failed:', fallbackError.message);
                if (fallback) return sendCatalog({ satellites: fallback.data, source: 'celestrak-active', cached: true, stale: true, timestamp: fallback.timestamp });
                return res.status(503).json({ error: `Spacebook: ${error.message}. CelesTrak: ${fallbackError.message}` });
            }
        }

    } catch (error) {
        console.error('[API] Handler error:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}
