export const CONNECTION_IDLE_TIMEOUT_MS = 1 * 60 * 1000 // 1 minute
export const IDLE_SWEEP_INTERVAL_MS = 60 * 1000 // 1 minute
// Keepalive cadence for backend idle-sweep protection. Must be tighter
// than the backend's CODEG_ACP_IDLE_TIMEOUT_SECS (default 180s) so each
// open tab gets at least one touch per backend timeout window — 30s
// gives ample safety margin under network jitter.
export const CONNECTION_KEEPALIVE_INTERVAL_MS = 30 * 1000 // 30 seconds
