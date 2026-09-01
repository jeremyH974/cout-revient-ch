/**
 * Chaîne de migrations : toute version antérieure → version courante (décision n° 89).
 *
 * Ce fichier s'annonçait « chaîne » depuis le premier jour et n'implémentait qu'un aiguillage à
 * deux branches — accepter la v1, refuser tout le reste. C'était suffisant tant qu'il n'existait
 * qu'une version, mais cela reportait la construction du mécanisme au jour du premier changement
 * cassant : c'est-à-dire au moment où des sauvegardes réelles seraient en jeu.
 *
 * **Aucun échelon n'existe encore, et c'est exact** : l'historique du dépôt ne contient aucun champ
 * supprimé ni renommé — toutes les évolutions ont été rendues additives par construction, politique
 * écrite dans `docs/backup-format.md`. La chaîne est donc vide aujourd'hui. Ce qu'elle apporte,
 * c'est que le premier échelon n'aura plus à inventer sa propre mécanique, et que `migrations.test.ts`
 * refuse déjà une montée de `SCHEMA_VERSION` non accompagnée.
 */
import {
  SCHEMA_VERSION,
  isStoredStateV1,
  sanitizeState,
  withDefaults,
  type StoredStateV1,
} from './schema';

export type MigrationResult =
  { ok: true; state: StoredStateV1; dropped: number } | { ok: false; error: string };

/**
 * Un échelon transforme une sauvegarde de la version `n` vers la version `n + 1`.
 *
 * Il travaille sur du JSON brut, jamais sur un état typé : par définition il lit une forme qui
 * n'existe plus dans les types du programme. C'est `sanitizeState` qui validera à l'arrivée.
 */
export type MigrationStep = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Les échelons, **indexés par la version de départ**. Vide tant qu'aucun changement cassant n'a eu
 * lieu. Y ajouter une entrée impose, par test, de monter `SCHEMA_VERSION` et de geler une fixture
 * `tests/fixtures/storage/backup-v<n>.json` — sans quoi l'échelon ne serait jamais rejoué contre
 * une vraie sauvegarde de l'époque.
 */
export const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Applique les échelons un par un, de la version lue jusqu'à la version courante.
 *
 * Une version **postérieure** à la nôtre n'est pas une erreur de migration mais une sauvegarde
 * venue d'une version plus récente de l'application : la boucle ne tourne pas, et c'est la garde
 * de forme qui refuse — avec le message historique, que les écrans savent déjà afficher.
 */
export function migrateState(raw: unknown): MigrationResult {
  if (!isRecord(raw) || !('schemaVersion' in raw))
    return { ok: false, error: 'Données illisibles.' };
  const from = raw['schemaVersion'];
  const unknown = { ok: false, error: `Version de données inconnue : ${String(from)}.` } as const;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) return unknown;

  let current: Record<string, unknown> = raw;
  for (let version = from; version < SCHEMA_VERSION; version++) {
    const step = MIGRATIONS[version];
    if (!step)
      return { ok: false, error: `Aucune migration de la version ${version} vers ${version + 1}.` };
    current = step(current);
  }

  if (!isStoredStateV1(current)) return unknown;
  const { state, dropped } = sanitizeState(withDefaults(current));
  return { ok: true, state, dropped };
}

/**
 * Rejoue la chaîne sur des échelons FOURNIS — le seul moyen d'exercer la boucle tant que
 * `MIGRATIONS` est vide. Réservé aux tests : un mécanisme qu'aucun test n'a jamais exécuté n'est
 * pas un mécanisme, c'est une intention.
 */
export function runChainForTest(
  raw: Record<string, unknown>,
  steps: Readonly<Record<number, MigrationStep>>,
  target: number,
): Record<string, unknown> | { error: string } {
  const from = raw['schemaVersion'];
  if (typeof from !== 'number') return { error: 'Version absente.' };
  let current = raw;
  for (let version = from; version < target; version++) {
    const step = steps[version];
    if (!step) return { error: `Aucune migration de la version ${version} vers ${version + 1}.` };
    current = step(current);
  }
  return current;
}
