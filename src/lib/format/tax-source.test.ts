/**
 * Le croisement entre la table des taux et la table de veille (décision n° 80).
 *
 * Deux tables, un seul fait. Sans ce test, un taux amendé d'un côté et pas de l'autre passerait
 * inaperçu — et l'application citerait une loi qui ne dit plus ce qu'elle affiche. C'est le patron
 * des décisions n° 47 (attributions de sources) et n° 57 (origines de la CSP), appliqué au fiscal.
 */
import { describe, expect, it } from 'vitest';
import { EXEMPTION_THRESHOLD, EXEMPTION_THRESHOLD_SOURCE_ID, TAX_RATES } from '../domain/tax-fr';
import { WATCH_ENTRIES } from '../watch/entries';
import { citationOf, taxSourcesNote, watchEntryOf } from './tax-source';

/** Le taux en vigueur : celui dont l'année de départ est la plus tardive. */
const currentRate = () => [...TAX_RATES].sort((a, b) => b.from - a.from)[0]!;

describe('source d’un chiffre fiscal', () => {
  it('tout identifiant déclaré existe dans la veille', () => {
    const declared = [...TAX_RATES.map((r) => r.sourceId), EXEMPTION_THRESHOLD_SOURCE_ID].filter(
      (id): id is string => Boolean(id),
    );
    expect(
      declared.length,
      'aucun identifiant déclaré : le test ne prouverait rien',
    ).toBeGreaterThan(0);
    for (const id of declared)
      expect(
        WATCH_ENTRIES.map((e) => e.id),
        `« ${id} » est déclaré dans tax-fr.ts mais absent de la veille`,
      ).toContain(id);
  });

  /** Le cliquet : ajouter un millésime sans le sourcer deviendra impossible en silence. */
  it('le taux en vigueur porte une source', () => {
    expect(currentRate().sourceId, 'le taux courant doit citer son texte de loi').toBeTruthy();
  });

  it('le taux affiché et le texte cité disent le même chiffre', () => {
    const rate = currentRate();
    const entry = watchEntryOf(rate.sourceId);
    expect(entry, 'entrée de veille introuvable').not.toBeNull();
    // « 31,4 % (12,8 % + 18,6 %) » → « 31,4 ». Un taux modifié d'un seul côté casse ici.
    const percent = rate.label.match(/^([\d,]+)\s*%/)?.[1];
    expect(percent, 'libellé de taux illisible').toBeTruthy();
    expect(
      entry?.effect,
      `le texte cité ne mentionne pas ${percent} % : les deux tables ont divergé`,
    ).toContain(`${percent} %`);
  });

  it('le seuil affiché et le texte cité disent le même chiffre', () => {
    const entry = watchEntryOf(EXEMPTION_THRESHOLD_SOURCE_ID);
    expect(entry?.effect).toContain(`${EXEMPTION_THRESHOLD} €`);
  });

  it('la citation nomme le texte et la date de relecture, en français', () => {
    const entry = watchEntryOf(currentRate().sourceId);
    const citation = citationOf(entry);
    expect(citation).toContain(entry!.source.label);
    expect(citation, 'la date doit être lisible, pas en ISO').toMatch(/relu le \d\d\/\d\d\/\d{4}/);
  });

  it('un taux sans source ne produit aucune citation, plutôt qu’une phrase creuse', () => {
    expect(citationOf(watchEntryOf(undefined))).toBeNull();
    expect(watchEntryOf('identifiant-qui-n-existe-pas')).toBeNull();
  });

  it('la note d’une section cite le taux ET le seuil, une seule fois chacun', () => {
    const note = taxSourcesNote(currentRate());
    expect(note).toContain('Taux 31,4 %');
    expect(note).toContain('Seuil d’exonération');
    expect(note?.match(/relu le/g)).toHaveLength(2);
  });

  it('un taux d’archive ne cite que le seuil', () => {
    const legacy = TAX_RATES.find((r) => r.sourceId === undefined);
    expect(legacy, 'la table doit garder un taux historique non sourcé').toBeTruthy();
    const note = taxSourcesNote(legacy!);
    expect(note).not.toContain('Taux ');
    expect(note).toContain('Seuil d’exonération');
  });
});
