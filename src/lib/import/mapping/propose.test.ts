import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsvText } from '../csv';
import { readAmount, readInstant, mappedDrafts } from './apply';
import { matchTypeLabel, TYPE_TARGETS } from './labels';
import { confirmedMapping, proposeMapping } from './propose';
import { CONFIRM_THRESHOLD } from './score';

const FIXTURE = 'tests/fixtures/mapping/demo-inconnu.csv';
const table = (): ReturnType<typeof parseCsvText> => parseCsvText(readFileSync(FIXTURE, 'utf8'));

const csv = (...lines: string[]): ReturnType<typeof parseCsvText> => parseCsvText(lines.join('\n'));

describe('proposition déterministe sur un fichier aux en-têtes français inédits', () => {
  it('apparie les dix colonnes, sans clé et sans réseau', () => {
    const proposal = proposeMapping(table());
    const byField = Object.fromEntries(proposal.columns.map((c) => [c.field, c.column]));
    expect(byField).toEqual({
      date: 0,
      label: 1,
      sentAmount: 2,
      sentCurrency: 3,
      receivedAmount: 4,
      receivedCurrency: 5,
      feeAmount: 6,
      feeCurrency: 7,
      netWorthAmount: 8,
      description: 9,
    });
    expect(proposal.admissible).toBe(true);
    expect(proposal.dangling).toEqual([]);
    expect(proposal.unsupported).toBeNull();
    for (const column of proposal.columns) {
      expect(column.source).toBe('deterministic');
      expect(column.confidence, column.field).toBeGreaterThanOrEqual(CONFIRM_THRESHOLD);
    }
  });

  it('lit la devise de la contre-valeur dans la PARENTHÈSE de son en-tête', () => {
    // « Contre-valeur (EUR) » n'a pas de colonne de devise : sans l'indice, chaque ligne serait
    // « un montant sans devise » et le fichier entier partirait à la poubelle.
    const proposal = proposeMapping(table());
    expect(proposal.impliedCurrencies).toEqual({ netWorthCurrency: 'EUR' });
    const drafts = mappedDrafts(table(), confirmedMapping(proposal), proposal.shapes);
    expect(drafts.issues).toEqual([]);
    expect(drafts.drafts[0]?.netWorth).toEqual({ amount: '2000.00', currency: 'EUR' });
  });

  it('traduit les libellés de type qu’il reconnaît, et laisse les autres tels quels', () => {
    const labels = Object.fromEntries(
      proposeMapping(table()).typeLabels.map((l) => [l.value, l.target]),
    );
    expect(labels).toEqual({
      achat: null,
      échange: null,
      vente: null,
      récompense: 'reward',
      'frais de retrait': 'fee',
    });
  });

  it('produit des jambes, des frais et des étiquettes pivot exploitables', () => {
    const proposal = proposeMapping(table());
    const { drafts } = mappedDrafts(table(), confirmedMapping(proposal), proposal.shapes);
    expect(drafts).toHaveLength(5);
    expect(drafts[0]?.sent).toEqual({ amount: '2000.00', currency: 'EUR' });
    expect(drafts[0]?.received).toEqual({ amount: '0.05', currency: 'BTC' });
    expect(drafts[0]?.fee).toEqual({ amount: '5.00', currency: 'EUR' });
    expect(drafts[3]?.label).toBe('reward');
    expect(drafts[4]?.label).toBe('fee');
    // Contenu natif : les cellules brutes, jamais les champs pivot calculés (décision n° 26).
    expect(drafts[0]?.nativeContent).toContain('Achat de demonstration');
  });
});

describe('la forme non prise en charge est reconnue, et NOMMÉE', () => {
  it('reconnaît un fichier à montant unique signé plutôt que d’échouer génériquement', () => {
    const file = csv(
      'Horodatage,Type,Montant,Devise',
      '2026-03-02 09:00:00,trade,-0.5,BTC',
      '2026-03-03 09:00:00,trade,1200.00,EUR',
      '2026-03-04 09:00:00,trade,-0.25,ETH',
      '2026-03-05 09:00:00,trade,640.00,EUR',
    );
    const proposal = proposeMapping(file);
    expect(proposal.shapes[2]?.shape).toBe('signed-decimal');
    expect(proposal.unsupported).toBe('signed-single-leg');
  });

  it('ne crie pas au loup sur un fichier à deux jambes non signées', () => {
    expect(proposeMapping(table()).unsupported).toBeNull();
  });
});

describe('lecture des valeurs selon la forme de leur colonne', () => {
  it('lit un instant dans chacune des quatre formes de temps', () => {
    expect(readInstant('2026-03-02 09:00:00', 'iso-datetime')).toBe(Date.UTC(2026, 2, 2, 9, 0, 0));
    expect(readInstant('02/03/2026 09:00:00', 'dmy-datetime')).toBe(Date.UTC(2026, 2, 2, 9, 0, 0));
    expect(readInstant('1772442000', 'epoch-s')).toBe(1772442000000);
    expect(readInstant('1772442000000', 'epoch-ms')).toBe(1772442000000);
    expect(readInstant('pas une date', 'iso-datetime')).toBeNull();
  });

  it('lit un montant dans la lecture de SA colonne, jamais deviné cellule par cellule', () => {
    expect(readAmount('1 234,56', 'decimal-comma')).toBe('1234.56');
    expect(readAmount('1,234.56', 'decimal-dot')).toBe('1234.56');
    expect(readAmount('1.234,56', 'decimal-comma')).toBe('1234.56');
    expect(readAmount('-0.5', 'decimal-dot')).toBe('-0.5');
    expect(readAmount('(0.5)', 'signed-decimal')).toBe('-0.5');
    expect(readAmount('abc', 'decimal-dot')).toBeNull();
  });
});

describe('appariement des libellés de type', () => {
  it('reconnaît une étiquette exacte, un synonyme, et une faute de frappe', () => {
    expect(matchTypeLabel('staking')?.target).toBe('staking');
    expect(matchTypeLabel('Récompense')?.target).toBe('reward');
    expect(matchTypeLabel('airdop')?.target).toBe('airdrop');
  });

  it('rend `null` sur un type d’échange : une ligne à deux jambes n’a besoin d’aucune étiquette', () => {
    for (const value of ['achat', 'vente', 'buy', 'sell']) {
      expect(matchTypeLabel(value), value).toBeNull();
    }
  });

  it('ne vise que les étiquettes que le moteur connaît', () => {
    for (const target of TYPE_TARGETS) expect(matchTypeLabel(target)?.target).toBe(target);
  });
});
