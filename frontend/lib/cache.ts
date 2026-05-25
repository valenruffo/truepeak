const CACHE_VERSION = "1.0.0";

export function getCachedData<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === CACHE_VERSION) {
      return parsed.data as T;
    }
  } catch (e) {
    console.error(`Cache read error for key ${key}:`, e);
  }
  return defaultValue;
}

export function setCachedData<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    const payload = { version: CACHE_VERSION, data };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {
    console.error(`Cache write error for key ${key}:`, e);
  }
}

export const getCache = getCachedData;
export const setCache = setCachedData;
