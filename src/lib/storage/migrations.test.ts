/**
 * La chaîne de migrations, et le cliquet qui rendra la première montée de version sûre
 * (décision n° 89).
 *
 * Aucun échelon n'existe : depuis le premier commit, aucun champ n'a jamais été supprimé ni
 * renommé — tout est passé par des champs facultatifs, politique écrite dans
 * `docs/backup-format.md`. Ce fichier ne teste donc pas un échelon réel, il teste **la mécanique**
 * qui en accueillera un, et pose la contrainte qui empêchera de monter `SCHEMA_VERSION` sans lui.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrateState, runChainForTest, type MigrationStep } from './migrations';
import { SCHEMA_VERSION, emptyState } from './schema';

describe('mécanique de la chaîne', () => {
  /** Deux échelons fictifs : la boucle doit les appliquer dans l'ordre, jamais à l'envers. */
  const steps: Record<number, MigrationStep> = {
    1: (raw) => ({
      ...raw,
      schemaVersion: 2,
      trace: [...((raw['trace'] as string[]) ?? []), '1→2'],
    }),
    2: (raw) => ({
      ...raw,
      schemaVersion: 3,
      trace: [...((raw['trace'] as string[]) ?? []), '2→3'],
    }),
  };

  it('applique les échelons dans l’ordre, de la version lue à la cible', () => {
    const out = runChainForTest({ schemaVersion: 1 }, steps, 3);
    expect(out).toEqual({ schemaVersion: 3, trace: ['1→2', '2→3'] });
  });

  it('part de la version LUE, pas du début de la chaîne', () => {
    expect(runChainForTest({ schemaVersion: 2 }, steps, 3)).toEqual({
      schemaVersion: 3,
      trace: ['2→3'],
    });
  });

  it('ne fait rien quand la sauvegarde est déjà à la version cible', () => {
    expect(runChainForTest({ schemaVersion: 3 }, steps, 3)).toEqual({ schemaVersion: 3 });
  });

  it('un échelon manquant est nommé par sa version, pas par un message vague', () => {
    expect(runChainForTest({ schemaVersion: 1 }, { 2: steps[2]! }, 3)).toEqual({
      error: 'Aucune migration de la version 1 vers 2.',
    });
  });
});

/**
 * Le cliquet. Il ne peut pas échouer aujourd'hui — c'est normal, il est posé pour demain : le jour
 * où quelqu'un montera `SCHEMA_VERSION`, il exigera l'échelon ET la sauvegarde gelée de l'époque,
 * sans laquelle l'échelon ne serait jamais rejoué contre une donnée réelle.
 */
describe('cliquet de version', () => {
  it('chaque version antérieure a son échelon et sa fixture gelée', () => {
    const missing: string[] = [];
    for (let version = 1; version < SCHEMA_VERSION; version++) {
      if (!MIGRATIONS[version])
        missing.push(`échelon ${version} → ${version + 1} absent de MIGRATIONS`);
      if (!existsSync(`tests/fixtures/storage/backup-v${version}.json`))
        missing.push(`fixture tests/fixtures/storage/backup-v${version}.json absente`);
    }
    expect(
      missing,
      'monter SCHEMA_VERSION impose d’écrire l’échelon et de geler une sauvegarde de l’ancienne version (docs/backup-format.md)',
    ).toEqual([]);
  });

  it('la fixture de la version courante existe : le cliquet a quelque chose à mordre', () => {
    expect(existsSync(`tests/fixtures/storage/backup-v${SCHEMA_VERSION}.json`)).toBe(true);
  });
});

describe('migrateState', () => {
  it('accepte la version courante', () => {
    const result = migrateState({ ...emptyState() });
    expect(result.ok).toBe(true);
  });

  it('refuse une version postérieure — c’est une sauvegarde venue d’une app plus récente', () => {
    const result = migrateState({ schemaVersion: SCHEMA_VERSION + 1 });
    expect(result).toEqual({
      ok: false,
      error: `Version de données inconnue : ${SCHEMA_VERSION + 1}.`,
    });
  });

  it('refuse une version absurde sans tenter de migrer', () => {
    expect(migrateState({ schemaVersion: 0 }).ok).toBe(false);
    expect(migrateState({ schemaVersion: 'deux' }).ok).toBe(false);
    expect(migrateState({ schemaVersion: 1.5 }).ok).toBe(false);
  });

  it('sans numéro de version, ce ne sont pas des données de l’app', () => {
    expect(migrateState({ imports: [] })).toEqual({ ok: false, error: 'Données illisibles.' });
    expect(migrateState(null)).toEqual({ ok: false, error: 'Données illisibles.' });
    expect(migrateState([])).toEqual({ ok: false, error: 'Données illisibles.' });
  });
});
