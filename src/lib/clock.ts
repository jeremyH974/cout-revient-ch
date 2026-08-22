/** Horloge injectable (les modules Svelte n'instancient pas de Date mutable). */
export const nowMs = (): number => Date.now();
export const nowIso = (ms: number = Date.now()): string => new Date(ms).toISOString();
