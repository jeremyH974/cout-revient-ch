import { describe, expect, it } from 'vitest';
import { computeDeclarations, concernedDeclarations } from './declarations-fr';
import type {
  Account,
  DepositEvent,
  FeeEvent,
  IncomeEvent,
  LedgerEvent,
  MigrationEvent,
  OpeningBalanceEvent,
  RewardEvent,
  SplitEvent,
  TradeEvent,
  UnqualifiedEvent,
  WithdrawalEvent,
} from './types';

let seq = 0;
const base = (accountId: string) => ({
  id: `e${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId,
  rowKeys: [],
  warnings: [],
});

const account = (over: Partial<Account> & Pick<Account, 'id' | 'kind'>): Account => ({
  label: over.id,
  space: 'invest',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const deposit = (accountId: string, at: string, asset: string, qty: string): DepositEvent => ({
  ...base(accountId),
  kind: 'deposit',
  at,
  in: { asset, qty },
  costEur: null,
});

const withdrawal = (
  accountId: string,
  at: string,
  asset: string,
  qty: string,
): WithdrawalEvent => ({
  ...base(accountId),
  kind: 'withdrawal',
  at,
  out: { asset, qty },
  proceedsEur: null,
});

const trade = (accountId: string, at: string, out: string, into: string): TradeEvent => ({
  ...base(accountId),
  kind: 'trade',
  at,
  out: { asset: out, qty: '1' },
  in: { asset: into, qty: '1' },
  valueEur: '100',
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});

const migration = (
  accountId: string,
  at: string,
  out: { asset: string; qty: string },
  into: { asset: string; qty: string },
): MigrationEvent => ({
  ...base(accountId),
  kind: 'migration',
  at,
  out,
  in: into,
  fairValueOutEur: null,
  fairValueInEur: null,
});

const reward = (accountId: string, at: string, asset: string, qty: string): RewardEvent => ({
  ...base(accountId),
  kind: 'reward',
  at,
  in: { asset, qty },
  fairValueEur: null,
});

const openingBalance = (
  accountId: string,
  at: string,
  asset: string,
  qty: string,
): OpeningBalanceEvent => ({
  ...base(accountId),
  kind: 'opening-balance',
  at,
  in: { asset, qty },
  costEur: '1000',
});

const unqualified = (
  accountId: string,
  at: string,
  legs: { asset: string; signedQty: string }[],
): UnqualifiedEvent => ({
  ...base(accountId),
  kind: 'unqualified',
  at,
  rawType: 'inconnu',
  legs: legs.map((leg) => ({ ...leg, valueEur: null })),
  reason: 'Ligne non reconnue automatiquement',
});

const fee = (accountId: string, at: string): FeeEvent => ({
  ...base(accountId),
  kind: 'fee',
  at,
  amountEur: '9.99',
  label: 'Abonnement',
});

const income = (accountId: string, at: string, asset: string | null = null): IncomeEvent => ({
  ...base(accountId),
  kind: 'income',
  at,
  asset,
  grossEur: '10',
  withheldEur: '0',
  nature: 'dividend',
  label: 'Dividende',
});

const split = (accountId: string, at: string, asset: string, ratio: string): SplitEvent => ({
  ...base(accountId),
  kind: 'split',
  at,
  asset,
  ratio,
});

describe('computeDeclarations — statut légal d’un compte (art. 1649 bis C du CGI)', () => {
  it('Coinhouse est hors périmètre : PSCA français, quel que soit son activité', () => {
    const a = account({ id: 'ch:main', kind: 'coinhouse' });
    const events: LedgerEvent[] = [deposit('ch:main', '2026-03-01T10:00:00', 'btc', '5')];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    expect(report.accounts[0]?.status).toBe('excluded-domestic');
    expect(report.includedCount).toBe(0);
  });

  it('un compte au pays FR explicite est hors périmètre, comme Coinhouse', () => {
    const a = account({ id: 'csv:fr', kind: 'csv', country: 'FR' });
    const report = computeDeclarations({ accounts: [a], events: [], year: 2026 });
    expect(report.accounts[0]?.status).toBe('excluded-domestic');
  });

  it('un compte CSV étranger utilisé dans l’année est à déclarer, et le dit', () => {
    const a = account({ id: 'csv:nl', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [deposit('csv:nl', '2026-03-01T10:00:00', 'btc', '1')];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    expect(d.status).toBe('included');
    expect(d.usedInYear).toBe(true);
    expect(d.country).toBe('NL');
    expect(report.includedCount).toBe(1);
  });

  it('on-chain et Hyperliquid restent incertains, jamais promus, même actifs', () => {
    const oc = account({ id: 'oc:btc-1', kind: 'onchain', chain: 'btc', address: 'bc1q…' });
    const hl = account({ id: 'hl:0xabc', kind: 'hyperliquid', address: '0xabc' });
    const events: LedgerEvent[] = [
      deposit('oc:btc-1', '2026-01-05T10:00:00', 'btc', '5'),
      trade('hl:0xabc', '2026-02-01T10:00:00', 'usdc', 'btc'),
    ];
    const report = computeDeclarations({ accounts: [oc, hl], events, year: 2026 });
    expect(report.accounts.map((d) => d.status)).toEqual([
      'uncertain-self-hosted',
      'uncertain-self-hosted',
    ]);
    expect(report.uncertainCount).toBe(2);
    expect(report.includedCount).toBe(0);
  });

  it('un compte manuel sans pays est signalé « inconnu », jamais deviné', () => {
    const a = account({ id: 'man:x', kind: 'manual' });
    const report = computeDeclarations({ accounts: [a], events: [], year: 2026 });
    expect(report.accounts[0]?.status).toBe('unknown');
    expect(report.accounts[0]?.country).toBeNull();
  });

  it('un compte étranger VIDE compte quand même dans includedCount (obligation sans seuil)', () => {
    const a = account({ id: 'csv:empty', kind: 'csv', country: 'AT' });
    const report = computeDeclarations({ accounts: [a], events: [], year: 2026 });
    const d = report.accounts[0]!;
    expect(d.status).toBe('included');
    expect(d.currentlyHolds).toBe(false);
    expect(d.usedInYear).toBe(false);
    expect(report.includedCount).toBe(1);
  });

  it('signale un compte peut-être clos dans l’année : détenu puis vidé avant son terme', () => {
    const a = account({ id: 'csv:closed', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      deposit('csv:closed', '2026-01-10T10:00:00', 'btc', '1'),
      withdrawal('csv:closed', '2026-06-10T10:00:00', 'btc', '1'),
    ];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    expect(d.currentlyHolds).toBe(false);
    expect(d.possiblyClosedInYear).toBe(true);
  });

  it('ne signale pas de clôture pour un compte toujours détenu à la fin de l’année', () => {
    const a = account({ id: 'csv:held', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [deposit('csv:held', '2026-01-10T10:00:00', 'btc', '1')];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    expect(d.currentlyHolds).toBe(true);
    expect(d.possiblyClosedInYear).toBe(false);
  });

  it('une réouverture APRÈS l’année visée ne change rien à l’année visée elle-même', () => {
    const a = account({ id: 'csv:reopened', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      deposit('csv:reopened', '2026-01-10T10:00:00', 'btc', '1'),
      withdrawal('csv:reopened', '2026-06-10T10:00:00', 'btc', '1'),
      deposit('csv:reopened', '2027-02-01T10:00:00', 'btc', '2'),
    ];
    const report2026 = computeDeclarations({ accounts: [a], events, year: 2026 });
    expect(report2026.accounts[0]?.possiblyClosedInYear).toBe(true);
    // « Maintenant » (grand livre entier) le compte est de nouveau approvisionné.
    expect(report2026.accounts[0]?.currentlyHolds).toBe(true);
  });

  it('concernedDeclarations écarte les comptes hors périmètre France', () => {
    const accounts = [
      account({ id: 'ch:main', kind: 'coinhouse' }),
      account({ id: 'csv:nl', kind: 'csv', country: 'NL' }),
    ];
    const report = computeDeclarations({ accounts, events: [], year: 2026 });
    expect(concernedDeclarations(report).map((d) => d.accountId)).toEqual(['csv:nl']);
  });
});

describe('computeDeclarations — effet de solde par nature d’événement', () => {
  it('une migration retire l’actif cédé ET crédite l’actif reçu : un seul des deux suffirait à fausser la détention', () => {
    const a = account({ id: 'csv:migre', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      deposit('csv:migre', '2026-01-05T10:00:00', 'lunc', '100'),
      migration(
        'csv:migre',
        '2026-02-01T10:00:00',
        { asset: 'lunc', qty: '100' },
        { asset: 'luna', qty: '1' },
      ),
      withdrawal('csv:migre', '2026-03-01T10:00:00', 'luna', '1'),
    ];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    // Si le retrait de lunc ne comptait pas, lunc resterait à 100 : le compte semblerait encore
    // détenu. Si le crédit de luna ne comptait pas, le retrait de luna passerait son solde en
    // négatif : même symptôme (un solde non nul, pour la mauvaise raison).
    expect(d.currentlyHolds).toBe(false);
    expect(d.possiblyClosedInYear).toBe(true);
  });

  it('un reward crédite l’actif reçu, comme un dépôt', () => {
    const a = account({ id: 'csv:reward', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [reward('csv:reward', '2026-04-01T10:00:00', 'btc', '0.001')];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    expect(report.accounts[0]?.currentlyHolds).toBe(true);
  });

  it('un solde d’ouverture crédite l’actif reçu, comme un dépôt', () => {
    const a = account({ id: 'csv:ouverture', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      openingBalance('csv:ouverture', '2026-01-01T00:00:00', 'eth', '2'),
    ];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    expect(report.accounts[0]?.currentlyHolds).toBe(true);
  });

  it('une ligne non qualifiée déplace quand même le solde de ses actifs', () => {
    const a = account({ id: 'csv:inconnu', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      unqualified('csv:inconnu', '2026-05-01T10:00:00', [
        { asset: 'eur', signedQty: '-50' },
        { asset: 'btc', signedQty: '0.001' },
      ]),
    ];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    expect(report.accounts[0]?.currentlyHolds).toBe(true);
  });

  it('un frais ne touche aucun actif : le compte reste vide à ses yeux, jamais « peut-être clos »', () => {
    const a = account({ id: 'csv:frais', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [fee('csv:frais', '2026-03-01T10:00:00')];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    expect(d.currentlyHolds).toBe(false);
    // Un compte qui n'a JAMAIS rien détenu n'est pas un compte « peut-être clos » : les deux ne se
    // distinguent que si un solde resté vide ne compte pour rien dans l'historique de détention.
    expect(d.possiblyClosedInYear).toBe(false);
  });

  it('un revenu en espèces (dividende, intérêt) ne touche aucun actif, jamais « peut-être clos »', () => {
    const a = account({ id: 'csv:dividende', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [income('csv:dividende', '2026-04-15T10:00:00')];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    expect(d.currentlyHolds).toBe(false);
    expect(d.possiblyClosedInYear).toBe(false);
  });

  /**
   * Le fractionnement redimensionne le solde, et c'est ce qui décide si un compte paraît vidé.
   *
   * Un relevé rapporte les mouvements POSTÉRIEURS en quantités post-fractionnement : après un
   * « 1 pour 2 » sur dix titres, c'est vingt titres qui sortent. Tant que ce cas ne faisait rien
   * ici, le retrait intégral laissait un solde de −10 — non nul, donc lu comme « détient encore ».
   * Le compte restait affiché ouvert le jour même où il était soldé.
   */
  it('un fractionnement redimensionne le solde : le retrait intégral vide bien le compte', () => {
    const a = account({ id: 'csv:fractionne', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      deposit('csv:fractionne', '2026-01-10T10:00:00', 'aapl', '10'),
      split('csv:fractionne', '2026-02-01T10:00:00', 'aapl', '2'),
      withdrawal('csv:fractionne', '2026-03-01T10:00:00', 'aapl', '20'),
    ];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    expect(d.currentlyHolds).toBe(false);
    expect(d.possiblyClosedInYear).toBe(true);
  });

  /**
   * Le cas ordinaire — un dividende reçu sur une ligne qu'on détient — et le seul qui distingue un
   * revenu vraiment neutre d'un revenu qui tomberait dans la branche voisine. Sans son étiquette de
   * `case`, il irait se faire redimensionner comme un fractionnement, sur un ratio qui n'existe pas.
   * Le test précédent ne le voyait pas : son dividende n'était rattaché à aucun titre.
   */
  it('un dividende rattaché à un titre DÉTENU laisse le solde exactement où il était', () => {
    const a = account({ id: 'csv:porteur', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      deposit('csv:porteur', '2026-01-10T10:00:00', 'aapl', '10'),
      income('csv:porteur', '2026-04-15T10:00:00', 'aapl'),
      withdrawal('csv:porteur', '2026-06-01T10:00:00', 'aapl', '10'),
    ];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    expect(report.accounts[0]?.currentlyHolds).toBe(false);
  });

  it('un fractionnement d’un titre que le compte n’a jamais eu ne casse rien', () => {
    // La garde `held !== undefined` n'est pas décorative : un relevé porte les fractionnements de
    // toute une place, y compris sur des lignes que ce compte-là n'a jamais détenues.
    const a = account({ id: 'csv:inconnu', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      split('csv:inconnu', '2026-02-01T10:00:00', 'tsla', '2'),
      deposit('csv:inconnu', '2026-03-01T10:00:00', 'aapl', '4'),
    ];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    expect(report.accounts[0]?.currentlyHolds).toBe(true);
  });

  it('et un retrait de la quantité d’AVANT le fractionnement en laisse la moitié', () => {
    // Le revers de la même pièce : sans le redimensionnement, ces dix titres soldaient le compte.
    const a = account({ id: 'csv:fractionne', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      deposit('csv:fractionne', '2026-01-10T10:00:00', 'aapl', '10'),
      split('csv:fractionne', '2026-02-01T10:00:00', 'aapl', '2'),
      withdrawal('csv:fractionne', '2026-03-01T10:00:00', 'aapl', '10'),
    ];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    expect(report.accounts[0]?.currentlyHolds).toBe(true);
  });

  it('refuse une nature d’événement inconnue plutôt que de l’ignorer silencieusement', () => {
    // Même défense qu'ailleurs dans le moteur (décision n° 129, voir tax-fr.test.ts) : un type
    // d'événement neuf doit faire une erreur bruyante qui le NOMME. Rendu silencieux, il laisserait
    // un solde inchangé sans le dire — un compte pourrait sembler vide alors qu'un événement,
    // juste ignoré, ne l'a jamais touché.
    const a = account({ id: 'csv:neuf', kind: 'csv', country: 'NL' });
    const neuf = { ...base('csv:neuf'), at: '2026-03-01T10:00:00', kind: 'staking-lock' };
    expect(() =>
      computeDeclarations({ accounts: [a], events: [neuf as unknown as LedgerEvent], year: 2026 }),
    ).toThrow(/staking-lock/);
  });
});

describe('computeDeclarations — le rejeu respecte l’ordre chronologique, pas l’ordre de saisie', () => {
  it('un événement d’une année postérieure, saisi en premier, ne doit pas masquer ceux de l’année visée', () => {
    const a = account({ id: 'csv:desordre', kind: 'csv', country: 'NL' });
    // Volontairement hors ordre : si le rejeu n'est pas trié par date, le premier élément du
    // tableau (2027) ferait sortir la boucle de replayThroughYear avant même de voir le dépôt et
    // le retrait de 2026 — le compte semblerait n'avoir jamais rien détenu cette année-là.
    const events: LedgerEvent[] = [
      deposit('csv:desordre', '2027-01-01T10:00:00', 'btc', '1'),
      deposit('csv:desordre', '2026-01-10T10:00:00', 'eth', '5'),
      withdrawal('csv:desordre', '2026-06-10T10:00:00', 'eth', '5'),
    ];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    expect(d.currentlyHolds).toBe(true); // le dépôt btc de 2027 compte dans « maintenant »
    // La preuve que le tri a eu lieu : sans lui, la boucle s'arrête au tout premier événement du
    // tableau (2027 > 2026) et ne voit jamais le dépôt/retrait 2026 qui rendent ce compte « vidé ».
    expect(d.possiblyClosedInYear).toBe(true);
  });
});

describe('computeDeclarations — compte détenu, compte vidé, compte jamais détenu, sur deux années', () => {
  it('un même relevé distingue les trois verdicts, et usedInYear change avec l’année demandée', () => {
    const held = account({ id: 'csv:tenu', kind: 'csv', country: 'NL' });
    const closed = account({ id: 'csv:vide', kind: 'csv', country: 'NL' });
    const untouched = account({ id: 'csv:jamais', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      deposit('csv:tenu', '2026-01-10T10:00:00', 'btc', '1'),
      deposit('csv:vide', '2026-02-10T10:00:00', 'btc', '1'),
      withdrawal('csv:vide', '2026-05-10T10:00:00', 'btc', '1'),
      fee('csv:jamais', '2026-03-01T10:00:00'),
      deposit('csv:tenu', '2027-01-05T10:00:00', 'btc', '1'),
    ];
    const accounts = [held, closed, untouched];

    const report2026 = computeDeclarations({ accounts, events, year: 2026 });
    const [dHeld, dClosed, dNever] = report2026.accounts;
    expect(dHeld?.currentlyHolds).toBe(true);
    expect(dHeld?.possiblyClosedInYear).toBe(false);
    expect(dClosed?.currentlyHolds).toBe(false);
    expect(dClosed?.possiblyClosedInYear).toBe(true);
    // Vide comme « vidé », mais jamais « peut-être clos » : il n'y a jamais rien eu à clore. Si la
    // garde qui protège everHeld disparaissait, un compte à frais seul semblerait « peut-être clos ».
    expect(dNever?.currentlyHolds).toBe(false);
    expect(dNever?.possiblyClosedInYear).toBe(false);

    // Même grand livre, année différente : seul « tenu » a un événement en 2027. Si le filtre sur
    // l'année disparaissait, les trois compteraient comme « utilisés » quelle que soit l'année.
    const report2027 = computeDeclarations({ accounts, events, year: 2027 });
    const [dHeld27, dClosed27, dNever27] = report2027.accounts;
    expect(dHeld27?.usedInYear).toBe(true);
    expect(dClosed27?.usedInYear).toBe(false);
    expect(dNever27?.usedInYear).toBe(false);
  });
});
