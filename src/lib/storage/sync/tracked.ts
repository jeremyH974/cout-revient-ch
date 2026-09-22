/**
 * Registre déclaratif des collections SUIVIES de `StoredStateV1` (LWW + pierres tombales) et accès
 * uniforme à chacune comme un `Record<clé, valeur>` — y compris `imports`, qui est un TABLEAU dans
 * l'état réel, indexé ici par identifiant de lot, et `alerts.rules` / `alerts.states`, imbriqués
 * sous `alerts`.
 *
 * Le reste de `StoredStateV1` se répartit en deux autres catégories, non suivies ici :
 * - **union de faits immuables** (comme avant ce chantier) : `rawRows`, `pivotRows`, `hyperliquid`,
 *   `lending`, `alerts.events` — fusionnées par union de clés, jamais par version ;
 * - **locales à l'appareil** (jamais fusionnées) : `engineSettings`, `priceCache`, `fx`, `ui`,
 *   `alerts.settings`.
 *
 * `storage.test.ts` (« complétude du schéma ») fait échouer la CI si une clé de `emptyState()`
 * n'est classée dans AUCUNE des trois catégories.
 */

export const TRACKED_COLLECTIONS = [
  'manualEvents',
  'qualifications',
  'transferOverrides',
  'duplicateOverrides',
  'taxAnnotations',
  'assetSettings',
  'accounts',
  'journal',
  'manualTrades',
  'imports',
  'alerts.rules',
  'alerts.states',
] as const;

export type TrackedCollection = (typeof TRACKED_COLLECTIONS)[number];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});

interface ImportLike {
  id?: unknown;
  at?: unknown;
}

/** `imports` (tableau) → `Record<id, lot>`. Un élément sans `id` de chaîne est ignoré (assaini ailleurs). */
function importsToRecord(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!Array.isArray(value)) return out;
  for (const item of value as ImportLike[]) {
    if (item && typeof item.id === 'string' && item.id !== '') out[item.id] = item;
  }
  return out;
}

/**
 * `Record<id, lot>` → tableau, reconstruit dans l'ordre CHRONOLOGIQUE (`at` croissant, id en
 * départage). Un Record n'a pas d'ordre garanti : sans ce tri, `Portfolio.svelte` (`imports[imports
 * .length - 1]`, « dernier import ») pourrait désigner le mauvais lot après une fusion.
 * Comparaison en `<`/`>` simples : `at` est une date ISO 8601, jamais comparée par locale
 * (décision n° 81 — voir `sync/hlc.ts`).
 */
export function recordToImports(value: Record<string, unknown>): unknown[] {
  const at = (item: unknown): string => {
    const a = (item as ImportLike | undefined)?.at;
    return typeof a === 'string' ? a : '';
  };
  const id = (item: unknown): string => {
    const i = (item as ImportLike | undefined)?.id;
    return typeof i === 'string' ? i : '';
  };
  return Object.values(value).sort((a, b) => {
    const byAt = at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0;
    if (byAt !== 0) return byAt;
    return id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0;
  });
}

/**
 * Lit une collection suivie comme un `Record<clé, valeur>` uniforme, quelle que soit sa forme
 * réelle. `state` est typé `object` plutôt que `Record<string, unknown>` : `StoredStateV1` porte
 * un champ optionnel (`sync?`), et `exactOptionalPropertyTypes` refuse de le faire passer pour un
 * `Record` à l'appel — `object` n'a pas ce problème, il accepte toute valeur non primitive.
 */
export function readTracked(state: object, name: TrackedCollection): Record<string, unknown> {
  const s = state as Record<string, unknown>;
  if (name === 'imports') return importsToRecord(s['imports']);
  if (name === 'alerts.rules') return asRecord(asRecord(s['alerts'])['rules']);
  if (name === 'alerts.states') return asRecord(asRecord(s['alerts'])['states']);
  return asRecord(s[name]);
}

/** Renvoie un NOUVEL état (jamais muté) avec cette collection remplacée. */
export function writeTracked(
  state: object,
  name: TrackedCollection,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const s = state as Record<string, unknown>;
  if (name === 'imports') return { ...s, imports: recordToImports(value) };
  if (name === 'alerts.rules' || name === 'alerts.states') {
    const alerts = asRecord(s['alerts']);
    const field = name === 'alerts.rules' ? 'rules' : 'states';
    return { ...s, alerts: { ...alerts, [field]: value } };
  }
  return { ...s, [name]: value };
}
