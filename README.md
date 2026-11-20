# Space Traffic Model

The catalog uses Spacebook's public bulk TLE feed for tracked objects; no Space-Track account is required. If Spacebook is unavailable, the app displays CelesTrak's active-satellite group, clearly marked as a partial catalog. Start locally with `npm install` and `npm run dev`.

Catalog snapshots are cached for 12 hours on the server where available and in the browser's IndexedDB. If an update fails, the last complete snapshot is shown as stale. Serverless temporary storage is ephemeral and is not shared between instances; production deployments with multiple instances can use shared persistent storage to avoid repeated downloads and preserve the server-side fallback across cold starts. The browser backup is per device and is only available after a successful load. Coverage and object counts depend on the source and availability of usable orbital elements.
