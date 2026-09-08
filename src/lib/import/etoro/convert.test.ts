import { describe, expect, it } from 'vitest';
import type { Workbook } from '../xlsx/index';
import { convertEtoroWorkbook, etoroDateToMs, leverageOf, splitRatioOf } from './convert';
import { detectEtoroWorkbook } from './sheets';

const HOLDINGS_HEADER = [
  'Snapshot Date',
  'Asset',
  'Position ID',
  'Direction',
  'Open Date',
  'Leverage',
  'Open Rate',
  'Units',
  'Current Rate',
  'Value in USD',
  'Value in EUR',
  'Type',
  'ISIN',
];
const ACTIVITY_HEADER = [
  'Date',
  'Type',
  'Détails',
  'Montant',
  'Unités',
  'Variation Fonds propres réalisés',
  'Équité réalisée',
  'Solde',
  'Identifiant de position',
  'Type d’actif',
  'NWA',
];
const CLOSED_HEADER = [
  'Identifiant de position',
  'Action',
  'Long / Short',
  'Montant',
  'Unités',
  'Date d’ouverture',
  'Date de clôture',
  'Effet de levier',
  'Frais de spread (USD)',
  'Spread du marché (USD)',
  'Profit (USD)',
  'Profit (EUR)',
  'Taux de change à l’ouverture (USD)',
  'Taux de change à la clôture (USD)',
  'Taux à l’ouverture',
  'Taux à la clôture',
  'Taux Take Profit',
  'Taux Stop Loss',
  'Frais overnight et dividendes',
  'Copie de',
  'Type',
  'ISIN',
  'Remarques',
];

/** Une ligne du grand livre : c'est elle, désormais, qui fait entrer une position. */
const open = (
  date: string,
  details: string,
  amount: string,
  units: string,
  id: string,
  assetType: string,
): string[] => [
  date,
  'Position ouverte',
  details,
  amount,
  units,
  '0',
  '0',
  '0',
  id,
  assetType,
  '0',
];

/** Une ligne de photo : elle ne produit rien, elle nomme et elle contrôle. */
const snap = (
  serial: string,
  name: string,
  id: string,
  units: string,
  type: string,
  isin = 'US0378331005',
): string[] => [
  serial,
  name,
  id,
  'Long',
  '01/02/2025 10:00:00',
  'X1',
  '100',
  units,
  '110',
  '1000',
  '900',
  type,
  isin,
];

const closed = (
  id: string,
  asset: string,
  amount: string,
  units: string,
  profit: string,
  lev: string,
  type: string,
): string[] => [
  id,
  asset,
  'Long',
  amount,
  units,
  '01/02/2025 10:00:00',
  '01/06/2025 10:00:00',
  lev,
  '0',
  '0',
  profit,
  '0',
  '1',
  '1',
  '10',
  '12',
  '0',
  '0',
  '0',
  '',
  type,
  'US0378331005',
  '',
];

const DIVIDEND_HEADER = [
  'Date du paiement',
  "Nom de l'instrument",
  'Dividende net reçu (USD)',
  'Dividende net reçu (EUR)',
  'Montant du prélèvement à la source (EUR)',
  'Identifiant de position',
  'ISIN',
];

/** Une ligne de dividende : date SANS heure, net encaissé, retenue à part, ISIN de l'instrument. */
const dividend = (
  date: string,
  instrument: string,
  netEur: string,
  withheldEur: string,
  id: string,
  isin: string,
): string[] => [date, instrument, '0', netEur, withheldEur, id, isin];

function book(
  activity: string[][],
  holdings: string[][] = [],
  closedRows: string[][] = [],
  names = ['Holdings', 'Activité du compte', 'Positions fermées'],
  dividends: string[][] = [],
): Workbook {
  return {
    sheets: [
      { name: names[0]!, rows: [HOLDINGS_HEADER, ...holdings] },
      { name: names[1]!, rows: [ACTIVITY_HEADER, ...activity] },
      { name: names[2]!, rows: [CLOSED_HEADER, ...closedRows] },
      ...(dividends.length > 0
        ? [{ name: 'Dividendes', rows: [DIVIDEND_HEADER, ...dividends] }]
        : []),
    ],
  };
}

describe('rattacher un dividende à sa ligne', () => {
  const opened = open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions');
  const divOf = (result: ReturnType<typeof convertEtoroWorkbook>) =>
    result.drafts.filter((d) => d.label === 'dividend');

  it('suit l’identifiant de position quand le grand livre le connaît', () => {
    const result = convertEtoroWorkbook(
      book([opened], [], [], undefined, [
        dividend('02/04/2025', 'Apple Inc.', '0.85', '0.15', 'p1', 'US0378331005'),
      ]),
    );
    expect(divOf(result).map((d) => d.relatedAsset)).toEqual(['eq:aapl']);
    // Le BRUT : 0,85 encaissé + 0,15 retenu.
    expect(divOf(result)[0]?.received?.amount).toBe('1');
  });

  it('passe par l’ISIN quand seule la photo connaît la position', () => {
    // « p9 » n'a pas de ligne d'ouverture — position antérieure à la fenêtre du relevé. Son ISIN
    // est celui que la photo attache à « p1 », que le grand livre sait nommer.
    const result = convertEtoroWorkbook(
      book([opened], [snap('46023', 'Apple Inc.', 'p1', '10', 'Stocks')], [], undefined, [
        dividend('02/04/2025', 'Apple Inc.', '0.85', '0.15', 'p9', 'US0378331005'),
      ]),
    );
    expect(divOf(result).map((d) => d.relatedAsset)).toEqual(['eq:aapl']);
  });

  it('REFUSE un ISIN que deux codes se disputent, au lieu d’en choisir un', () => {
    // Un rattachement faux est pire qu'un rattachement absent : il fausserait le rendement de deux
    // lignes au lieu d'une, et rien à l'écran ne le signalerait.
    const result = convertEtoroWorkbook(
      book(
        [opened, open('01/03/2025 10:00:00', 'MSFT/USD', '900', '3', 'p2', 'Actions')],
        [
          snap('46023', 'Apple Inc.', 'p1', '10', 'Stocks', 'SHARED000001'),
          snap('46023', 'Microsoft Corp.', 'p2', '3', 'Stocks', 'SHARED000001'),
        ],
        [],
        undefined,
        [dividend('02/04/2025', 'Apple Inc.', '0.85', '0.15', 'p9', 'SHARED000001')],
      ),
    );
    expect(divOf(result).map((d) => d.relatedAsset)).toEqual([null]);
    expect(result.issues.map((i) => i.message).join(' ')).toContain(
      "dividende(s) dont la position n'est plus identifiable",
    );
  });

  it('n’invente rien d’un « - » : la colonne ISIN des cryptos n’est pas un identifiant', () => {
    // Dix actifs partagent ce « - » dans un relevé réel. Le prendre pour un ISIN rattacherait
    // n'importe quel dividende à n'importe quelle crypto.
    //
    // Ce qui protège ici est `reader.get`, qui rend « - » comme une absence dans tout le relevé —
    // et non un contrôle propre au rattachement. La contre-épreuve porte donc là : rendre « - » tel
    // quel au lecteur fait rougir ce test. Le vérifier importait, car une garde ajoutée en double
    // dans `normalizeIsin` aurait fait passer ce test pour une raison qui n'était pas la sienne.
    const result = convertEtoroWorkbook(
      book(
        [opened],
        [snap('46023', 'Bitcoin', 'p1', '10', 'Crypto Currencies', '-')],
        [],
        undefined,
        [dividend('02/04/2025', 'Apple Inc.', '0.85', '0.15', 'p9', '-')],
      ),
    );
    expect(divOf(result).map((d) => d.relatedAsset)).toEqual([null]);
  });
});

describe('détection d’un relevé eToro', () => {
  it('reconnaît les onglets en français comme en anglais', () => {
    expect(detectEtoroWorkbook(book([]))).toBe(true);
    expect(
      detectEtoroWorkbook(book([], [], [], ['Positions ouvertes', 'Account activity', 'X'])),
    ).toBe(true);
    expect(detectEtoroWorkbook({ sheets: [{ name: 'Feuil1', rows: [[]] }] })).toBe(false);
  });
});

describe('le grand livre est la source', () => {
  it('importe une position ouverte APRÈS la dernière photo — le défaut que la photo cachait', () => {
    // La photo (46023 = 01/01/2026) ignore tout ce qui suit ; le grand livre, non.
    const result = convertEtoroWorkbook(
      book(
        [
          open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions'),
          open('15/03/2026 09:00:00', 'NOW/USD', '900', '3', 'p2', 'Actions'),
        ],
        [snap('46023', 'Apple Inc.', 'p1', '10', 'Stocks')],
      ),
    );
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts.map((d) => d.received?.currency)).toEqual(['eq:aapl', 'eq:now']);
  });

  it('lit le ticker du couple « TICKER/DEVISE », suffixes de place compris', () => {
    const result = convertEtoroWorkbook(
      book([
        open('01/02/2025 10:00:00', 'SXR8.DE/EUR', '500', '1', 'p1', 'ETF'),
        open('01/02/2025 10:00:00', 'SPCX.24-7/USD', '100', '2', 'p2', 'Actions'),
      ]),
    );
    expect(result.drafts.map((d) => d.received?.currency)).toEqual(['eq:sxr8.de', 'eq:spcx.24-7']);
  });

  it('donne à chaque actif la classe que la source déclare', () => {
    const result = convertEtoroWorkbook(
      book([
        open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions'),
        open('01/02/2025 10:00:00', 'BTC/USD', '600', '2', 'p2', 'Crypto-monnaies'),
      ]),
    );
    expect(result.drafts.map((d) => d.received?.currency)).toEqual(['eq:aapl', 'btc']);
  });

  it('écarte un contrat pour différence en nommant le motif', () => {
    const result = convertEtoroWorkbook(
      book([open('01/02/2025 10:00:00', 'OIL/USD', '500', '2', 'p9', 'CFD')]),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.issues[0]?.message).toContain('hors périmètre');
  });

  it('signale une ligne dont le ticker est illisible', () => {
    const result = convertEtoroWorkbook(
      book([open('01/02/2025 10:00:00', 'sans ticker', '500', '2', 'p9', 'Actions')]),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('ticker illisible');
  });

  it('refuse un relevé sans grand livre', () => {
    const result = convertEtoroWorkbook({
      sheets: [{ name: 'Holdings', rows: [HOLDINGS_HEADER] }],
    });
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('activité');
  });
});

describe('positions fermées', () => {
  it('ne produit QUE la vente : l’achat est déjà dans le grand livre', () => {
    const result = convertEtoroWorkbook(
      book(
        [open('01/02/2025 10:00:00', 'AAPL/USD', '1000', '10', 'c1', 'Actions')],
        [],
        [closed('c1', 'Apple Inc. (AAPL)', '1000', '10', '250', '1', 'Actions')],
      ),
    );
    expect(result.drafts).toHaveLength(2);
    const [buy, sell] = result.drafts;
    expect(buy?.received).toEqual({ amount: '10', currency: 'eq:aapl' });
    expect(sell?.sent).toEqual({ amount: '10', currency: 'eq:aapl' });
    // Produit = montant investi + profit.
    expect(sell?.received).toEqual({ amount: '1250', currency: 'usd' });
  });

  it('écarte une position fermée à effet de levier', () => {
    const result = convertEtoroWorkbook(
      book([], [], [closed('c4', 'Tesla (TSLA)', '500', '2', '10', '2', 'Actions')]),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('levier');
  });

  it('préfère le nom complet de la position fermée au ticker seul', () => {
    const result = convertEtoroWorkbook(
      book(
        [open('01/02/2025 10:00:00', 'DOGE/USD', '100', '5', 'c2', 'Crypto-monnaies')],
        [],
        [closed('c2', 'Dogecoin (DOGE)', '100', '5', '20', '1', 'Crypto-monnaies')],
      ),
    );
    expect(result.labels['doge']).toBe('Dogecoin');
  });
});

describe('la photo contrôle, elle ne produit plus rien', () => {
  it('ne signale rien quand la quantité reconstituée correspond', () => {
    const result = convertEtoroWorkbook(
      book(
        [open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions')],
        [snap('46023', 'Apple Inc.', 'p1', '10', 'Stocks')],
      ),
    );
    expect(result.issues).toHaveLength(0);
    expect(result.labels['eq:aapl']).toBe('Apple Inc.');
  });

  it('signale un écart entre le grand livre et la photo', () => {
    const result = convertEtoroWorkbook(
      book(
        [open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions')],
        [snap('46023', 'Apple Inc.', 'p1', '25', 'Stocks')],
      ),
    );
    expect(result.issues[0]?.message).toContain('quantité reconstituée diffère');
    expect(result.issues[0]?.message).toContain('eq:aapl');
  });

  it('ignore les opérations postérieures à la photo dans le contrôle', () => {
    // L'achat de 2026 ne doit pas faire croire à un écart sur la photo de 2026-01-01.
    const result = convertEtoroWorkbook(
      book(
        [
          open('01/02/2025 10:00:00', 'AAPL/USD', '2000', '10', 'p1', 'Actions'),
          open('15/03/2026 09:00:00', 'AAPL/USD', '900', '3', 'p2', 'Actions'),
        ],
        [snap('46023', 'Apple Inc.', 'p1', '10', 'Stocks')],
      ),
    );
    expect(result.issues).toHaveLength(0);
  });
});

describe('formats propres à eToro', () => {
  it('lit une date jour/mois/année', () => {
    expect(etoroDateToMs('23/12/2024 08:00:22')).toBe(Date.UTC(2024, 11, 23, 8, 0, 22));
    expect(etoroDateToMs('2024-12-23 08:00:22')).toBeNull();
    expect(etoroDateToMs('')).toBeNull();
  });

  it('lit un effet de levier écrit « X1 » comme « 1 »', () => {
    expect([leverageOf('X1'), leverageOf('1'), leverageOf('2'), leverageOf('')]).toEqual([
      1, 1, 2, 1,
    ]);
    expect(leverageOf('abc')).toBeNaN();
  });
});

/** Une ligne de fractionnement : ni montant, ni quantité — seulement un ratio dans le libellé. */
const splitRow = (date: string, details: string, id: string, assetType: string): string[] => [
  date,
  'corp action: Split',
  details,
  '0',
  '-',
  '0',
  '0',
  '0',
  id,
  assetType,
  '0',
];

describe('fractionnement d’action', () => {
  it('lit le ratio du libellé, « a devient b »', () => {
    expect(splitRatioOf('HON/USD 1:2')).toBe('2');
    // Un regroupement deux contre un : la quantité est divisée par deux.
    expect(splitRatioOf('ABC/USD 2:1')).toBe('0.5');
    expect(splitRatioOf('ABC/USD 1:1.5')).toBe('1.5');
    expect(splitRatioOf('sans ratio')).toBeNull();
    expect(splitRatioOf('ABC/USD 0:2')).toBeNull();
  });

  it('rattache le fractionnement à l’actif de la position, et le signale', () => {
    const result = convertEtoroWorkbook(
      book([
        open('01/02/2025 10:00:00', 'HON/USD', '400', '1', 'p1', 'Actions'),
        splitRow('29/06/2026 06:27:00', 'HON/USD 1:2', 'p1', 'Actions'),
      ]),
    );
    expect(result.drafts).toHaveLength(2);
    const split = result.drafts[1];
    expect(split?.corporateAction).toEqual({ kind: 'split', asset: 'eq:hon', ratio: '2' });
    // Ni montant envoyé ni montant reçu : ce n'est pas un échange.
    expect(split?.sent).toBeNull();
    expect(split?.received).toBeNull();
    // Le sens du ratio n'est pas documenté par eToro : on le dit.
    expect(result.issues[0]?.message).toContain('Vérifiez le sens');
  });

  it('retrouve l’actif par son ticker même sans position connue', () => {
    const result = convertEtoroWorkbook(
      book([splitRow('29/06/2026 06:27:00', 'HON/USD 1:2', 'inconnue', 'Actions')]),
    );
    expect(result.drafts[0]?.corporateAction?.asset).toBe('eq:hon');
  });

  it('refuse un ratio illisible plutôt que d’en inventer un', () => {
    const result = convertEtoroWorkbook(
      book([splitRow('29/06/2026 06:27:00', 'HON/USD regroupement', 'p1', 'Actions')]),
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('ratio illisible');
  });
});
