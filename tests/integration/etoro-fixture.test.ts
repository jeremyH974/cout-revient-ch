/**
 * Le relevé eToro de démonstration, de bout en bout : classeur → lignes pivot → événements →
 * rapport. La fixture est **entièrement inventée** (`scripts/generate-etoro-fixture.ts`), jamais
 * dérivée d'un relevé réel (décision n° 17), et porte volontairement les pièges du format : préfixe
 * `x:`, chaîne partagée fragmentée, cibles absolues, deux photos empilées, **une position ouverte
 * après la dernière photo**, une position à effet de levier et un contrat pour différence.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetClass } from '../../src/lib/domain/assets';
import { computePortfolio } from '../../src/lib/domain/engine/aggregate';
import { isPositive, toDecimalString } from '../../src/lib/domain/money';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { importEtoroWorkbook } from '../../src/lib/import/etoro/index';
import { pivotLedgerEvents } from '../../src/lib/import/pivot/events';
import { ingestPivotRows } from '../../src/lib/import/pivot/index';

const FIXTURE = 'tests/fixtures/etoro/releve-demo.xlsx';
/** Taux fixe : ce test mesure la conversion du relevé, pas la justesse des taux BCE. */
const usdRate = (): string => '1.25';

function workbook(): ArrayBuffer {
  const file = readFileSync(FIXTURE);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/** Le rapport complet, depuis le classeur : c'est le seul niveau où un champ perdu se voit. */
async function reported() {
  const result = await imported();
  const ingested = ingestPivotRows(
    { rows: result.rows, issues: result.issues },
    { format: 'etoro', header: [], unknownColumns: [], totalRows: result.rows.length },
    {},
    'etoro:main',
    usdRate,
  );
  if (!ingested.ok) throw new Error(ingested.error);
  const { events } = pivotLedgerEvents(Object.values(ingested.rows), {}, usdRate);
  return computePortfolio({ events, prices: {}, settings: DEFAULT_ENGINE_SETTINGS });
}

async function imported() {
  const result = await importEtoroWorkbook(workbook(), 'imp:test', 'etoro:main');
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('relevé eToro de démonstration', () => {
  it('lit le grand livre, écarte levier et CFD en les nommant', async () => {
    const result = await imported();
    // 5 ouvertures + 1 vente + 1 fractionnement + 3 dividendes ; le CFD et le levier sont écartés.
    expect(result.rows).toHaveLength(10);
    expect(result.skipped).toBe(2);
    const motifs = result.issues.map((i) => i.message).join(' | ');
    expect(motifs).toContain('levier');
    expect(motifs).toContain('hors périmètre');
  });

  it('le spread entre dans le coût, il n’est pas jeté', async () => {
    // Facturé À PART par eToro : sans lui, le prix de revient est sous-estimé de son montant, et
    // avec lui la plus-value imposable (décision n° 126). La fixture porte 4 € à l'ouverture de
    // p-101 et 3 € à la clôture de p-201.
    const result = await imported();
    const rows = Object.values(result.rows).filter((r) => r.fee !== null);
    // LE CÔTÉ compte autant que le montant : à l'ouverture le spread MAJORE le coût, à la clôture
    // il MINORE le produit. Ne vérifier que le total laissait les deux confondus — la
    // contre-épreuve de la décision n° 75 l'a montré, en routant tout vers l'ouverture sans que
    // rien ne rougisse.
    const buy = rows.filter((r) => r.received !== null && r.received.currency.startsWith('eq:'));
    const sell = rows.filter((r) => r.sent !== null && r.sent.currency.startsWith('eq:'));
    // La devise est celle du compte : le pivot la convertit au taux BCE du jour, et signale
    // « Frais en usd non convertis » si le taux manque — il ne les perd jamais en silence.
    expect(buy.map((r) => r.fee!.amount)).toEqual(['4']);
    expect(sell.map((r) => r.fee!.amount)).toEqual(['3']);
  });

  it('le spread d’un CFD ne s’applique à rien : la position est écartée', async () => {
    // Le contrat pour différence n'entre pas dans le modèle ; son spread ne doit donc pas se
    // raccrocher à une autre ligne, ni gonfler un coût au hasard.
    const result = await imported();
    const total = Object.values(result.rows).reduce(
      (acc, r) => acc + (r.fee ? Number(r.fee.amount) : 0),
      0,
    );
    expect(total).toBe(7);
  });

  it('nomme et compte ce qu’il ne traite pas, au lieu de se taire', async () => {
    // Le silence est ce qui a laissé 64 dividendes et 14 paiements d'intérêts hors du modèle
    // pendant tout un lot de travail. Un poste absent ne provoque ni erreur ni ligne vide.
    const result = await imported();
    const motifs = result.issues.map((i) => i.message).join(' | ');
    expect(motifs).toContain('non traitées');
    expect(motifs).toContain('Paiement des intérêts (1)');
    expect(motifs).toContain('Frais overnight (1)');
  });

  it('ne signale aucun écart entre le grand livre et la photo', async () => {
    const result = await imported();
    expect(result.issues.map((i) => i.message).join(' ')).not.toContain('quantité reconstituée');
  });

  it('donne à chaque actif la classe déclarée, et son nom quand la photo le porte', async () => {
    const result = await imported();
    const codes = [
      ...new Set(
        Object.values(result.rows).flatMap((r) =>
          [r.sent?.currency, r.received?.currency].filter((c): c is string => !!c),
        ),
      ),
    ].sort();
    // « eur » vient des dividendes : un encaissement en espèces n'a qu'une jambe, et elle est fiat.
    expect(codes).toEqual(['btc', 'eq:demo', 'eq:idx.de', 'eq:newco', 'eur', 'usd']);
    expect(assetClass('eq:demo')).toBe('equity');
    expect(assetClass('btc')).toBe('crypto');
    expect(result.labels['eq:demo']).toBe('Demo Industries Inc.');
    // Absent des photos : il ne reste que son ticker, et c'est honnête.
    expect(result.labels['eq:newco']).toBe('NEWCO');
  });

  it('produit un portefeuille complet : la position ouverte après la photo en fait partie', async () => {
    const result = await imported();
    const ingested = ingestPivotRows(
      { rows: result.rows, issues: result.issues },
      { format: 'etoro', header: [], unknownColumns: [], totalRows: result.rows.length },
      {},
      'etoro:main',
      usdRate,
    );
    if (!ingested.ok) throw new Error(ingested.error);
    const { events } = pivotLedgerEvents(Object.values(ingested.rows), {}, usdRate);
    const report = computePortfolio({ events, prices: {}, settings: DEFAULT_ENGINE_SETTINGS });

    expect(report.equities.map((p) => p.asset).sort()).toEqual([
      'eq:demo',
      'eq:idx.de',
      'eq:newco',
    ]);
    expect(report.positions.map((p) => p.asset)).toEqual(['btc']);
    expect(report.unqualified).toHaveLength(0);
    // La vente de p-201 a rapporté 240 pour 200 investis : le titre garde une plus-value réalisée,
    // et il reste les 10 unités de l'autre position.
    const demo = report.equities.find((p) => p.asset === 'eq:demo');
    expect(demo && isPositive(demo.realized)).toBe(true);
    // Le fractionnement « 1:2 » a doublé la quantité sans toucher au coût.
    expect(demo?.qty.toString()).toBe('20');
    expect(demo?.lots).toHaveLength(2);
  });

  /**
   * Les dividendes de la fixture : 0,45 + 0,075 sur « p-101 », 0,18 + 0,06 sur « p-901 » (que seule
   * la photo connaît), 0,09 sur « p-999 » (que personne ne connaît).
   */
  describe('les dividendes arrivent entiers et à la bonne ligne', () => {
    it('la retenue à la source traverse l’import — elle était perdue en chemin', async () => {
      // Elle était LUE dans la feuille, posée sur le brouillon, et jamais recopiée dans la ligne
      // pivot : le classeur disait 0,135 €, le moteur en recevait zéro. Aucune erreur, aucun
      // total qui détonne — seulement un crédit d'impôt qui n'existait pas.
      const result = await imported();
      const withheld = Object.values(result.rows)
        .map((r) => r.withheld)
        .filter((w): w is NonNullable<typeof w> => w != null);
      expect(withheld.map((w) => `${w.amount} ${w.currency}`).sort()).toEqual([
        '0.06 eur',
        '0.075 eur',
      ]);
    });

    it('un dividende se pose sur SA ligne, et le brut compte', async () => {
      const report = await reported();
      const demo = report.equities.find((p) => p.asset === 'eq:demo');
      // 0,525 + 0,24 : les BRUTS. Les nets encaissés feraient 0,63.
      expect(toDecimalString(demo!.otherIncome)).toBe('0.765');
      expect(toDecimalString(report.totals.withheldEur)).toBe('0.135');
    });

    it('une position que seule la photo connaît se rattache par son ISIN', async () => {
      // « p-901 » est ouverte avant la fenêtre du relevé : aucune ligne ne l'ouvre, et son
      // identifiant ne dit rien. Son ISIN, lui, est celui de « p-101 » — donc de la même ligne.
      // Sans ce pont, ses 0,24 € tomberaient au compte et le compte en porterait 0,33.
      const report = await reported();
      expect(toDecimalString(report.totals.accountIncomeEur)).toBe('0.09');
    });

    it('un dividende que rien ne situe reste au compte, et l’import le dit', async () => {
      // « p-999 » n'est ni au grand livre ni à la photo. Le rattacher au hasard fausserait le
      // rendement d'une ligne ; le taire laisserait croire qu'il n'existe pas.
      const result = await imported();
      expect(result.issues.map((i) => i.message).join(' | ')).toContain(
        "1 dividende(s) dont la position n'est plus identifiable",
      );
    });
  });

  it('refuse un classeur qui n’est pas un relevé eToro', async () => {
    const notEtoro = new TextEncoder().encode('même pas une archive').buffer;
    const result = await importEtoroWorkbook(notEtoro as ArrayBuffer, 'imp:x', 'etoro:main');
    expect(result.ok).toBe(false);
  });
});
