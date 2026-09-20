import { describe, expect, it } from 'vitest';
import { accountDeclarationsToCsv, cessionsToCsv } from './csv-export';
import { computeDeclarations } from '../domain/declarations-fr';
import { computeFrenchTax } from '../domain/tax-fr';
import { computePortfolio } from '../domain/engine';
import { D, type Big } from '../domain/money';
import {
  DEFAULT_ENGINE_SETTINGS,
  type Account,
  type LedgerEvent,
  type TradeEvent,
} from '../domain/types';
import { lotsToCsv, operationsToCsv, positionsToCsv, seriesToCsv } from './csv-export';

const base = (id: string) => ({
  id,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
  rowKeys: [],
  warnings: [],
});
const buy = (id: string, at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  ...base(id),
  kind: 'trade',
  at,
  out: { asset: 'eur', qty: eur },
  in: { asset, qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const sell = (id: string, at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  ...base(id),
  kind: 'trade',
  at,
  out: { asset, qty },
  in: { asset: 'eur', qty: eur },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});

const report = computePortfolio({
  events: [
    buy('man:a', '2026-01-01T10:00:00', 'btc', '1', '100'),
    buy('man:b', '2026-01-02T10:00:00', 'btc', '1', '200'),
    sell('man:c', '2026-01-03T10:00:00', 'btc', '1', '300'),
  ],
  prices: {
    btc: {
      asset: 'btc',
      priceEur: '250',
      at: '2026-08-22T10:00:00Z',
      source: 'test',
      stale: false,
    },
  },
  settings: DEFAULT_ENGINE_SETTINGS,
});

const lines = (csv: string): string[] =>
  csv
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split('\r\n');

describe('exports CSV', () => {
  it('positions : BOM, point-virgule, virgule décimale, devise', () => {
    const csv = positionsToCsv(report, 'USD');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = lines(csv);
    expect(header).toContain('PRU ($)');
    expect(row).toBe('"BTC";"ok";1;150;150;250;250;100;66,67;150;250;83,33;0;0;0');
  });

  it('opérations : chronologiques avec PRU après chaque ligne', () => {
    const rows = lines(operationsToCsv(report, 'EUR'));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('PRU après (€)');
    expect(rows[1]).toMatch(
      /^01\/01\/2026;10:00;"BTC";"Achat";1;100;100;"EUR";;"";0;0;;100;1;"Manuel";"Coinhouse";"a";""$/,
    );
    expect(rows[3]).toMatch(
      /^03\/01\/2026;10:00;"BTC";"Vente";-1;300;300;"EUR";;"";0;0;150;150;1;"Manuel";"Coinhouse";"c";""$/,
    );
    expect(lines(operationsToCsv(report, 'EUR', 'eth'))).toHaveLength(1);
  });

  it('« Compte » : en-tête juste après « Source », étiquette fournie ou identifiant brut à défaut', () => {
    const header = lines(operationsToCsv(report, 'EUR'))[0]!;
    expect(header).toContain('Source;Compte');

    const acctReport = computePortfolio({
      events: [{ ...buy('man:z', '2026-01-05T10:00:00', 'btc', '1', '100'), accountId: 'man:x1' }],
      prices: {
        btc: {
          asset: 'btc',
          priceEur: '250',
          at: '2026-08-22T10:00:00Z',
          source: 'test',
          stale: false,
        },
      },
      settings: DEFAULT_ENGINE_SETTINGS,
    });
    const withLabel = lines(operationsToCsv(acctReport, 'EUR', undefined, { 'man:x1': 'Ledger' }));
    expect(withLabel[1]).toContain('"Ledger"');
    const withoutLabel = lines(operationsToCsv(acctReport, 'EUR'));
    expect(withoutLabel[1]).toContain('"man:x1"');
  });

  it('lots et série', () => {
    const lots = lines(lotsToCsv(report));
    expect(lots).toHaveLength(3);
    expect(lots[1]).toMatch(
      // La colonne « Acquisitions regroupées » vaut 1 pour un lot ordinaire (décision n° 152).
      /^"BTC";01\/01\/2026 10:00;"purchase";"EUR";1;1;0,5;100;50;100;125;75;150$/,
    );
    const series = lines(
      seriesToCsv(
        [
          {
            day: '2026-01-03',
            value: D('250'),
            cost: D('150'),
            qty: D('1'),
            price: D('250'),
            estimated: false,
            estimatedValue: D('0'),
          },
        ],
        'EUR',
      ),
    );
    expect(series[0]).toMatch(/^Jour;/);
    expect(series[1]).toBe('03/01/2026;250;150;100;66,67;1;250;150');
  });

  it('série intraday : en-tête « Instant », horodatage ISO conservé, prix vide si estimé', () => {
    const rows = lines(
      seriesToCsv([
        {
          day: '2026-08-22T12:30:00.000Z',
          value: D('250'),
          cost: D('150'),
          qty: D('1'),
          price: D('250'),
          estimated: false,
          estimatedValue: D('0'),
        },
        {
          day: '2026-08-22T12:45:00.000Z',
          value: D('150'),
          cost: D('150'),
          qty: D('1'),
          price: null,
          estimated: true,
          estimatedValue: D('150'),
        },
      ]),
    );
    expect(rows[0]).toMatch(/^Instant;/);
    expect(rows[1]).toBe('"2026-08-22T12:30:00.000Z";250;150;100;66,67;1;250;150');
    expect(rows[2]).toBe('"2026-08-22T12:45:00.000Z";150;150;0;0;1;;150');
  });
});

describe('cessionsToCsv — une colonne par ligne du formulaire 2086', () => {
  /**
   * L'exemple du banc d'essai public (`docs/exactitude.md`) : 10 000 € investis, un portefeuille de
   * 12 000 €, une vente de 3 000 € dont 30 € de frais. La plus-value est de **470 €** — et de 495 €
   * si le rapport de la formule part du prix NET des frais, ce que le fichier exporté faisait faire
   * à qui le recopiait dans le formulaire, faute de dire lequel de ses deux prix il écrivait.
   */
  const withFee = (event: TradeEvent, grossEur: string): TradeEvent => ({
    ...event,
    fee: { asset: 'eur', gross: grossEur, rebate: '0', grossEur, rebateEur: '0' },
  });
  const events: LedgerEvent[] = [
    buy('e1', '2025-01-01T10:00:00', 'btc', '1', '10000'),
    withFee(sell('e2', '2025-06-01T10:00:00', 'btc', '0.25', '2970'), '30'),
    sell('e3', '2026-06-01T10:00:00', 'btc', '0.25', '2000'),
  ];
  // Valeur globale = clôture du jour + ce qui est sorti du portefeuille : 12 000 puis 8 000.
  const closingValueAt = (day: string): Big | null =>
    day === '2025-06-01' ? D('9000') : day === '2026-06-01' ? D('6000') : null;
  const ledger = computeFrenchTax({ events, closingValueAt });
  const lines = (year?: number): string[] => cessionsToCsv(ledger, year).trimEnd().split('\r\n');

  it('nomme chaque colonne par la ligne du formulaire où elle se recopie', () => {
    const header = lines()[0]!.replace('\ufeff', '').split(';');
    expect(header).toEqual([
      'Date de la cession (211)',
      'Valeur globale du portefeuille (212)',
      'Prix de cession (213)',
      'Frais de cession (214)',
      'Prix de cession net des frais (215)',
      "Prix total d'acquisition (220)",
      'Fractions de capital initial (221)',
      "Prix total d'acquisition net (223)",
      'Plus ou moins-value de la cession',
      'Estimation complète',
    ]);
    // Le prix BRUT en 213, les frais en 214, le net en 215 : l'ancien fichier écrivait 2 970 sous
    // l'intitulé du prix de cession, et rien nulle part sur les 30 € de frais.
    expect(lines()[1]!.split(';')).toEqual([
      '"01/06/2025"',
      '12000',
      '3000',
      '30',
      '2970',
      '10000',
      '0',
      '10000',
      '470',
      '"oui"',
    ]);
  });

  it('se recopie dans le formulaire et y redonne la plus-value du moteur', () => {
    // La formule imprimée sur le formulaire, appliquée aux CASES DU FICHIER :
    // l. 218 − [l. 223 × (l. 217 / l. 212)], avec 217 = 213 et 218 = 215 faute de soulte.
    const rows = lines().slice(1);
    expect(rows).toHaveLength(2);
    rows.forEach((row, i) => {
      const cells = row.split(';');
      const box = (index: number): Big => D(cells[index]!.replace(',', '.'));
      expect(box(2).minus(box(3)).toString()).toBe(box(4).toString());
      expect(box(5).minus(box(6)).toString()).toBe(box(7).toString());
      const gain = box(4).minus(box(7).times(box(2)).div(box(1)));
      expect(gain.toFixed(2)).toBe(D(ledger.cessions[i]!.gainEur!).toFixed(2));
    });
  });

  it('compte les fractions déjà imputées depuis la première cession, pas depuis le 1ᵉʳ janvier', () => {
    expect(lines(2025)).toHaveLength(2);
    const cells = lines(2026)[1]!.split(';');
    expect(cells[0]).toBe('"01/06/2026"');
    // 221 : les 2 500 € imputés en 2025, que le millésime 2026 ne montre pas — sans eux, la 220
    // repartirait du prix d'acquisition d'origine et le formulaire imputerait deux fois.
    expect(cells[6]).toBe('2500');
    expect(cells[5]).toBe('10000');
    expect(cells[7]).toBe('7500');
  });

  it('dit ligne par ligne ce qui n’a pas pu être chiffré, au lieu d’inventer', () => {
    const blind = computeFrenchTax({ events });
    const cells = cessionsToCsv(blind).trimEnd().split('\r\n')[1]!.split(';');
    expect(cells[1]).toBe('"inconnue"');
    expect(cells[8]).toBe('"—"');
    expect(cells[9]).toContain('non');
  });
});

describe('accountDeclarationsToCsv — comptes à déclarer (formulaire 3916-bis, P66)', () => {
  const acc = (id: string, kind: Account['kind'], country?: string): Account => ({
    id,
    kind,
    label: id,
    space: 'invest',
    createdAt: '2026-01-01T00:00:00Z',
    ...(country === undefined ? {} : { country }),
  });

  it('ne liste que les comptes concernés : Coinhouse et le pays FR sont écartés', () => {
    const declarations = computeDeclarations({
      accounts: [
        acc('ch:main', 'coinhouse'),
        acc('csv:fr', 'csv', 'FR'),
        acc('csv:nl', 'csv', 'NL'),
      ],
      events: [],
      year: 2026,
    });
    const lines = accountDeclarationsToCsv(declarations).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Statut');
    expect(lines[1]).toContain('"csv:nl"');
    expect(lines[1]).toContain('Pays-Bas');
  });

  it('dit « inconnu » plutôt que d’inventer un pays', () => {
    const declarations = computeDeclarations({
      accounts: [acc('man:x', 'manual')],
      events: [],
      year: 2026,
    });
    const cells = accountDeclarationsToCsv(declarations).trimEnd().split('\r\n')[1]!.split(';');
    expect(cells[2]).toBe('"inconnu"');
  });

  it('un compte étranger vide reste dans l’export, marqué « non » utilisé et « non » détenu', () => {
    const declarations = computeDeclarations({
      accounts: [acc('csv:empty', 'csv', 'AT')],
      events: [],
      year: 2026,
    });
    const cells = accountDeclarationsToCsv(declarations).trimEnd().split('\r\n')[1]!.split(';');
    expect(cells[3]).toBe('"non"');
    expect(cells[4]).toBe('"non"');
  });
});
