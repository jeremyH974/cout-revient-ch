/**
 * Le jeu de démonstration Hyperliquid commis doit être exactement la sortie du générateur, se
 * synchroniser et se resynchroniser sans erreur ni doublon, et rester cohérent de bout en bout :
 * chaîne `startPosition` par coin perp, réconciliation de l'équité (`computeTradingAccount`), et
 * soldes spot recalculés indépendamment depuis les fills et le grand livre.
 */
import Big from 'big.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  generateHlFixture,
  HL_DEMO_ADDRESS,
  HL_FIXTURE_PATH,
} from '../../scripts/generate-hl-fixture';
import {
  isSpotCoin,
  parseClearinghouse,
  parseFills,
  parseLedger,
  parseSpotClearinghouse,
} from '../../src/lib/import/hyperliquid/api-types';
import { computeTradingAccount } from '../../src/lib/domain/trading/compute';
import type { HlFixture } from '../../src/lib/import/hyperliquid/fixture-client';
import { fixtureClient } from '../../src/lib/import/hyperliquid/fixture-client';
import { sortedFills } from '../../src/lib/import/hyperliquid/data';
import { normalizeHlAccount } from '../../src/lib/import/hyperliquid/normalize';
import { syncAccount, type SyncResult } from '../../src/lib/import/hyperliquid/sync';

const EPS_GAP = new Big('0.000001');
const EPS_TIGHT = new Big('0.000000001');
const close = (a: Big, b: Big, eps: Big): boolean => a.minus(b).abs().lte(eps);
const ACCOUNT_ID = `hl:${HL_DEMO_ADDRESS}`;
const NOW = (): number => 1_755_900_000_000;

async function sync(
  fixture: HlFixture,
  previous: SyncResult['data'] | null = null,
): Promise<SyncResult> {
  return syncAccount(fixtureClient(fixture), previous, HL_DEMO_ADDRESS, { now: NOW });
}

describe('jeu de démonstration Hyperliquid synthétique', () => {
  it('le fichier commis est identique à la sortie du générateur (déterministe)', () => {
    const generated = generateHlFixture();
    const serialized = JSON.stringify(generated, null, 1) + '\n';
    expect(JSON.stringify(generateHlFixture(), null, 1) + '\n').toBe(serialized);
    expect(readFileSync(HL_FIXTURE_PATH, 'utf8')).toBe(serialized);
  });

  it('se synchronise sans erreur ni troncature, et resynchronise sans rien ajouter (idempotence)', async () => {
    const fixture = generateHlFixture();
    const first = await sync(fixture);
    expect(first.error).toBeNull();
    expect(first.truncated).toBe(false);
    expect(first.added.fills).toBe(fixture.userFillsByTime.length);
    expect(first.added.funding).toBe(fixture.userFunding.length);
    expect(first.added.ledger).toBe(fixture.userNonFundingLedgerUpdates.length);

    const second = await sync(fixture, first.data);
    expect(second.error).toBeNull();
    expect(second.truncated).toBe(false);
    expect(second.added.fills).toBe(0);
    expect(second.added.funding).toBe(0);
    expect(second.added.ledger).toBe(0);
    expect(Object.keys(second.data.fills)).toHaveLength(fixture.userFillsByTime.length);
  });

  it('réconciliation de l’équité perps : gap nul à 1e-6 près, aucun type de grand livre inconnu', async () => {
    const fixture = generateHlFixture();
    const { data, spotPairs, error } = await sync(fixture);
    expect(error).toBeNull();

    const normalized = normalizeHlAccount(data, {
      accountId: ACCOUNT_ID,
      spotPairs,
      spotAsInvestment: false,
      eurUsdRate: () => '1.1',
    });
    expect(normalized.unknownLedgerTypes).toEqual([]);

    const report = computeTradingAccount(normalized.trading);
    const reconciliation = report.reconciliation;
    if (!reconciliation) throw new Error('réconciliation absente : instantané manquant');
    expect(close(reconciliation.gap, new Big('0'), EPS_GAP)).toBe(true);

    // `computeTotals` (src/lib/domain/trading/compute.ts) compte TOUTES les exécutions dans
    // `totals.fills`, spot et perps confondus, dès lors que `spotAsInvestment` ne les a pas
    // routées ailleurs : on vérifie donc les deux familles séparément plutôt que d'attendre que
    // `totals.fills` n'égale que les fills perps ici (voir le scénario `spotAsInvestment: true`
    // plus bas, où c'est littéralement le cas puisque le spot est alors entièrement exclu).
    const allRawFills = parseFills(fixture.userFillsByTime);
    const expectedPerpFills = allRawFills.filter((f) => !isSpotCoin(f.coin)).length;
    const expectedSpotFills = allRawFills.filter((f) => isSpotCoin(f.coin)).length;
    const perpExecutions = normalized.trading.executions.filter((x) => x.market === 'perp');
    const spotExecutions = normalized.trading.executions.filter((x) => x.market === 'spot');
    expect(perpExecutions).toHaveLength(expectedPerpFills);
    expect(spotExecutions).toHaveLength(expectedSpotFills);
    expect(report.totals.fills).toBe(perpExecutions.length + spotExecutions.length);
  });

  it('chaîne startPosition par coin perp, cohérente fill après fill jusqu’à l’instantané', async () => {
    const fixture = generateHlFixture();
    const { data } = await sync(fixture);
    const perps = parseClearinghouse(fixture.clearinghouseState);
    if (!perps) throw new Error('clearinghouseState invalide');
    const solPosition = perps.positions.find((p) => p.coin === 'SOL');
    if (!solPosition) throw new Error('position SOL absente de l’instantané');

    const allFills = sortedFills(data.fills);
    for (const coin of ['BTC', 'ETH', 'HYPE', 'SOL'] as const) {
      const coinFills = allFills.filter((f) => f.coin === coin);
      expect(coinFills.length).toBeGreaterThan(0);
      let position = new Big('0');
      for (const fill of coinFills) {
        expect(close(new Big(fill.startPosition), position, EPS_TIGHT)).toBe(true);
        position = fill.side === 'B' ? position.plus(fill.sz) : position.minus(fill.sz);
      }
      const expectedFinal = coin === 'SOL' ? new Big(solPosition.szi) : new Big('0');
      expect(close(position, expectedFinal, EPS_TIGHT)).toBe(true);
    }
  });

  it('soldes spot : USDC/PURR/HYPE recalculés depuis les fills et le grand livre, à 1e-9 près', async () => {
    const fixture = generateHlFixture();
    const { data } = await sync(fixture);
    const allFills = sortedFills(data.fills);
    const spotFills = allFills.filter((f) => isSpotCoin(f.coin));
    const ledgerEntries = parseLedger(fixture.userNonFundingLedgerUpdates);

    let usdc = new Big('0');
    let hype = new Big('0');
    for (const entry of ledgerEntries) {
      if (entry.type === 'accountClassTransfer') {
        const amount = new Big(String(entry.fields['usdc']));
        usdc = entry.fields['toPerp'] === true ? usdc.minus(amount) : usdc.plus(amount);
      } else if (entry.type === 'spotTransfer' && entry.fields['token'] === 'HYPE') {
        hype = hype.plus(new Big(String(entry.fields['amount'])));
      }
    }
    let purr = new Big('0');
    for (const f of spotFills) {
      const isHype = f.coin === '@107';
      const sz = new Big(f.sz);
      const px = new Big(f.px);
      const fee = new Big(f.fee);
      if (f.side === 'B') {
        const net = sz.minus(fee);
        if (isHype) hype = hype.plus(net);
        else purr = purr.plus(net);
        usdc = usdc.minus(px.times(sz));
      } else {
        if (isHype) hype = hype.minus(sz);
        else purr = purr.minus(sz);
        usdc = usdc.plus(px.times(sz).minus(fee));
      }
    }

    const balances = parseSpotClearinghouse(fixture.spotClearinghouseState);
    const byCoin = (coin: string) => balances.find((b) => b.coin === coin);
    const usdcBalance = byCoin('USDC');
    const purrBalance = byCoin('PURR');
    const hypeBalance = byCoin('HYPE');
    if (!usdcBalance || !purrBalance || !hypeBalance) throw new Error('soldes spot manquants');
    expect(close(usdc, new Big(usdcBalance.total), EPS_TIGHT)).toBe(true);
    expect(close(purr, new Big(purrBalance.total), EPS_TIGHT)).toBe(true);
    expect(close(hype, new Big(hypeBalance.total), EPS_TIGHT)).toBe(true);
  });

  it('spotAsInvestment : route le spot vers l’Investissement (taux constant) ou le laisse de côté (aucun taux)', async () => {
    const fixture = generateHlFixture();
    const { data, spotPairs } = await sync(fixture);
    const allRawFills = parseFills(fixture.userFillsByTime);
    const expectedPerpFills = allRawFills.filter((f) => !isSpotCoin(f.coin)).length;
    const expectedSpotFills = allRawFills.filter((f) => isSpotCoin(f.coin)).length;

    const withRate = normalizeHlAccount(data, {
      accountId: ACCOUNT_ID,
      spotPairs,
      spotAsInvestment: true,
      eurUsdRate: () => '1.1',
    });
    expect(withRate.investEvents.length).toBeGreaterThan(0);
    expect(withRate.investEvents).toHaveLength(expectedSpotFills);
    expect(
      withRate.investEvents.every((e) => e.kind === 'trade' && e.accountId === ACCOUNT_ID),
    ).toBe(true);
    expect(withRate.fxMissing).toBe(0);
    // Le spot est entièrement routé vers investEvents : `totals.fills` ne compte plus que les perps.
    const reportWithRate = computeTradingAccount(withRate.trading);
    expect(reportWithRate.totals.fills).toBe(expectedPerpFills);

    const withoutRate = normalizeHlAccount(data, {
      accountId: ACCOUNT_ID,
      spotPairs,
      spotAsInvestment: true,
      eurUsdRate: () => null,
    });
    expect(withoutRate.investEvents).toEqual([]);
    expect(withoutRate.fxMissing).toBe(expectedSpotFills);
  });
});
