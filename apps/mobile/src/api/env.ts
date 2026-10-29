/** Resolved env — import.meta not available under Metro; use process.env.EXPO_PUBLIC_*. */
export const API_BASE: string = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:4001";
export const LIVEKIT_URL: string = process.env.EXPO_PUBLIC_LIVEKIT_URL ?? "ws://localhost:7880";
