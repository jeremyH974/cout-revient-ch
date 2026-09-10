/**
 * Le croisement entre la table des taux et la table de veille (décision n° 80).
 *
 * Deux tables, un seul fait. Sans ce test, un taux amendé d'un côté et pas de l'autre passerait
 * inaperçu — et l'application citerait une loi qui ne dit plus ce qu'elle affiche. C'est le patron
 * des décisions n° 47 (attributions de sources) et n° 57 (origines de la CSP), appliqué au fiscal.
 */
import { describe, expect, it } from 'vitest';
import {
  DIVIDEND_TAX_BOXES,
  FORM_2047_SOURCE_ID,
  TREATY_RATES_SOURCE_ID,
} from '../domain/equity-income-fr';
import { EQUITY_TAX_BOXES, PMP_SOURCE_ID } from '../domain/equity-tax-fr';
import { INTEREST_TAX_BOXES } from '../domain/interest-income-fr';
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

  it('chaque case de la déclaration des titres cite une source qui existe', () => {
    // Même cliquet que pour les taux : une case ajoutée sans sa source deviendrait un numéro
    // affirmé sans preuve — et un numéro de case faux est aussi coûteux qu'un taux faux.
    const declared = [...Object.values(EQUITY_TAX_BOXES).map((b) => b.sourceId), PMP_SOURCE_ID];
    expect(declared.length).toBeGreaterThan(0);
    for (const id of declared)
      expect(
        WATCH_ENTRIES.map((e) => e.id),
        `« ${id} » est cité par equity-tax-fr.ts mais absent de la veille`,
      ).toContain(id);
  });

  it('chaque case des dividendes cite une source qui existe', () => {
    const declared = [
      ...Object.values(DIVIDEND_TAX_BOXES).map((b) => b.sourceId),
      FORM_2047_SOURCE_ID,
      TREATY_RATES_SOURCE_ID,
    ];
    for (const id of declared)
      expect(
        WATCH_ENTRIES.map((e) => e.id),
        `« ${id} » est cité par equity-income-fr.ts mais absent de la veille`,
      ).toContain(id);
  });

  it('chaque case des intérêts cite une source qui existe', () => {
    for (const id of Object.values(INTEREST_TAX_BOXES).map((b) => b.sourceId))
      expect(
        WATCH_ENTRIES.map((e) => e.id),
        `« ${id} » est cité par interest-income-fr.ts mais absent de la veille`,
      ).toContain(id);
  });

  it('la source des intérêts distingue 2TR de 2TT', () => {
    // Les confondre ferait déclarer des intérêts bancaires dans la case des prêts participatifs,
    // que la brochure exclut expressément de 2TR.
    const entry = watchEntryOf(INTEREST_TAX_BOXES.interest.sourceId);
    expect(entry?.effect).toContain(INTEREST_TAX_BOXES.interest.box);
    expect(entry?.effect).toContain('2TT');
  });

  it('la source du crédit dit bien qu’il n’est PAS restituable', () => {
    // C'est la différence avec la case 2CK, et elle change le résultat : un crédit non restituable
    // s'évapore quand il dépasse l'impôt dû. Si le texte cité cessait de le dire, l'application
    // affirmerait une propriété que sa source ne soutient plus.
    const entry = watchEntryOf(DIVIDEND_TAX_BOXES.credit.sourceId);
    expect(entry?.effect).toContain(DIVIDEND_TAX_BOXES.credit.box);
    expect(entry?.effect).toMatch(/n’est pas restituable|pas restituable/);
  });

  it('la source des taux dit qu’ils s’appliquent au NET', () => {
    // Le piège du lot : 17,6 % du net = 15 % du brut. Appliqués au brut, ils sur-créditeraient.
    expect(watchEntryOf(TREATY_RATES_SOURCE_ID)?.effect).toMatch(/montant NET|au NET/);
  });

  it('la source des cases dit bien 3VG, 3VH et « 2042 C »', () => {
    // Le piège que ce lot documente : ces deux cases ne sont PAS sur la 2042. Si le texte cité
    // cessait de le dire, l'application affirmerait un formulaire que sa source ne soutient plus.
    const entry = watchEntryOf(EQUITY_TAX_BOXES.gain.sourceId);
    expect(entry?.effect).toContain(EQUITY_TAX_BOXES.gain.box);
    expect(entry?.effect).toContain(EQUITY_TAX_BOXES.loss.box);
    expect(entry?.effect).toContain(EQUITY_TAX_BOXES.gain.form);
  });

  it('un taux d’archive ne cite que le seuil', () => {
    const legacy = TAX_RATES.find((r) => r.sourceId === undefined);
    expect(legacy, 'la table doit garder un taux historique non sourcé').toBeTruthy();
    const note = taxSourcesNote(legacy!);
    expect(note).not.toContain('Taux ');
    expect(note).toContain('Seuil d’exonération');
  });
});
