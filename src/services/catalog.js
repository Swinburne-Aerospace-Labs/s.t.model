const FIELDS = ['NORAD_CAT_ID', 'OBJECT_NAME', 'OBJECT_ID', 'OBJECT_TYPE', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'];
const STATION_IDS = new Set(['25544', '48274']);
const DEBRIS_TYPES = new Set(['DEB', 'DEBRIS', 'R/B', 'ROCKET BODY']);

export function catalogKey(id) {
    return String(id).replace(/^0+(?=\d)/, '');
}

function classifyObject(id, name, objectType) {
    if (STATION_IDS.has(catalogKey(id))) return 'STATION';
    const type = (objectType || '').trim().toUpperCase();
    if (DEBRIS_TYPES.has(type)) return 'DEBRIS';
    if (type === 'PAY' || type === 'PAYLOAD') return 'PAYLOAD';
    return /\bDEB(?:RIS)?\b|\bR\/B\b|\bROCKET BODY\b/i.test(name) ? 'DEBRIS' : 'PAYLOAD';
}

export function processCatalog(rows, source) {
    return rows.map(row => {
        if (source === 'spacebook') {
            const [id, name, tle1, tle2, type] = row;
            return { id: String(id), name, category: classifyObject(id, name, type), tle1, tle2 };
        }
        const omm = {};
        for (let i = 0; i < FIELDS.length; i++) omm[FIELDS[i]] = row[i];
        const id = String(omm.NORAD_CAT_ID);
        const name = omm.OBJECT_NAME || `OBJECT ${id}`;
        return { id, name, category: classifyObject(id, name, omm.OBJECT_TYPE), omm };
    });
}
