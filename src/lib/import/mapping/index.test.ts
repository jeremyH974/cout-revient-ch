import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsvText } from '../csv';
import { importMappedCsv } from './index';
import { confirmedMapping, proposeMapping } from './propose';

const FIXTURE = 'tests/fixtures/mapping/demo-inconnu.csv';
const RATE = (): string => '1.1';

function mappingOf(text: string) {
  return confirmedMapping(proposeMapping(parseCsvText(text)));
}

describe('import d’un CSV apparié', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('écrit des lignes pivot exploitables, avec le format « mapped-csv »', () => {
    const result = importMappedCsv(text, mappingOf(text), {}, 'csv:essai', 'imp:1', RATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.format).toBe('mapped-csv');
    expect(result.report.parsedRows).toBe(5);
    expect(result.report.newRows).toBe(5);
    expect(result.report.counts.trades).toBe(3);
    expect(result.report.counts.rewards).toBe(1);
    expect(result.report.counts.fees).toBe(1);
    expect(result.report.counts.unqualified).toBe(0);
    expect(result.report.assets).toContain('btc');
  });

  it('porte l’identifiant d’import sur chaque ligne : c’est ce qui rend l’annulation possible', () => {
    const result = importMappedCsv(text, mappingOf(text), {}, 'csv:essai', 'imp:1', RATE);
    if (!result.ok) throw new Error(result.error);
    for (const row of Object.values(result.rows)) expect(row.importId).toBe('imp:1');
  });

  it('est idempotent : un ré-import du même fichier n’ajoute aucune ligne', () => {
    const first = importMappedCsv(text, mappingOf(text), {}, 'csv:essai', 'imp:1', RATE);
    if (!first.ok) throw new Error(first.error);
    const second = importMappedCsv(text, mappingOf(text), first.rows, 'csv:essai', 'imp:2', RATE);
    if (!second.ok) throw new Error(second.error);
    expect(second.report.newRows).toBe(0);
    expect(second.report.duplicateRows).toBe(5);
    // Les lignes gardent l'identifiant de l'import qui les a insérées : annuler `imp:2` ne
    // retirerait donc rien de ce qu'`imp:1` avait apporté.
    for (const row of Object.values(second.rows)) expect(row.importId).toBe('imp:1');
  });

  it('hache le contenu NATIF : corriger l’appariement ne duplique pas les lignes', () => {
    const base = mappingOf(text);
    const first = importMappedCsv(text, base, {}, 'csv:essai', 'imp:1', RATE);
    if (!first.ok) throw new Error(first.error);
    // Un appariement corrigé — la description retirée — produit les MÊMES clés : c'est la
    // propriété de la décision n° 26, l'entrée du convertisseur n'ayant pas changé.
    const { description: _dropped, ...withoutDescription } = base.columns;
    void _dropped;
    const second = importMappedCsv(
      text,
      { ...base, columns: withoutDescription },
      {},
      'csv:essai',
      'imp:2',
      RATE,
    );
    if (!second.ok) throw new Error(second.error);
    expect(Object.keys(second.rows).sort()).toEqual(Object.keys(first.rows).sort());
  });

  it('signale les colonnes qu’aucun champ ne réclame', () => {
    const base = mappingOf(text);
    const { description: _dropped, ...withoutDescription } = base.columns;
    void _dropped;
    const result = importMappedCsv(
      text,
      { ...base, columns: withoutDescription },
      {},
      'csv:essai',
      'imp:1',
      RATE,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.report.unknownColumns).toEqual(['Note']);
  });
});
