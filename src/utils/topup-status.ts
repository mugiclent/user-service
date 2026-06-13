// Per-topup terminal status, persisted in Redis so an SSE client that connects
// (or reconnects) AFTER the outcome was published can still replay it instead of
// waiting out the timeout. TTL comfortably exceeds the 3-minute SSE window.
export const TOPUP_STATUS_TTL = 600; // seconds

export const topupStatusKey = (topupId: string): string => `topup_status:${topupId}`;
