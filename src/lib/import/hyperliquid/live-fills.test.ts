/**
 * Exécutions en direct : dédoublonnage par `tid`, snapshot traité comme une pousse ordinaire,
 * charges malformées ignorées sans exception, curseurs de la synchronisation REST intacts.
 */
import { describe, expect, it } from 'vitest';
import { emptyHlAccountData } from './data';
import { liveFillSubscriptions, mergeLiveEnvelope, readLiveEnvelope } from './live-fills';

const ADDR = '0xDFC24B077BC1425AD1DEA75BCB6F8158E10DF303';
const LOWER = ADDR.toLowerCase();

const fill = (tid: string, time: number) => ({
  coin: 'BTC',
  px: '65000',
  sz: '0.1',
  side: 'B',
  time,
  startPosition: '0',
  dir: 'Open Long',
  closedPnl: '0',
  hash: `0x${tid}`,
  oid: 1,
  crossed: true,
  fee: '1.5',
  tid,
  feeToken: 'USDC',
});

describe('liveFillSubscriptions', () => {
  it('pose fills et funding par compte, en minuscules, et ignore une adresse invalide', () => {
    expect(liveFillSubscriptions([ADDR, 'pas-une-adresse'])).toEqual([
      { type: 'userFills', user: LOWER },
      { type: 'userFundings', user: LOWER },
    ]);
  });
});

describe('readLiveEnvelope', () => {
  it('lit un snapshot et une pousse de la même façon', () => {
    const snap = readLiveEnvelope('userFills', {
      isSnapshot: true,
      user: ADDR,
      fills: [fill('1', 1000)],
    });
    expect(snap?.isSnapshot).toBe(true);
    expect(snap?.user).toBe(LOWER);
    expect(snap?.fills).toHaveLength(1);
    const push = readLiveEnvelope('userFills', { user: ADDR, fills: [fill('2', 2000)] });
    expect(push?.isSnapshot).toBe(false);
    expect(push?.fills).toHaveLength(1);
  });

  it('ignore un canal étranger et une charge malformée, sans lever', () => {
    expect(readLiveEnvelope('allMids', { mids: {} })).toBeNull();
    expect(readLiveEnvelope('userFills', null)).toBeNull();
    expect(readLiveEnvelope('userFills', { user: ADDR, fills: 'non' })?.fills).toEqual([]);
    expect(readLiveEnvelope('userFills', { user: ADDR, fills: [{ tid: 'x' }] })?.fills).toEqual([]);
  });

  it('lit le funding sur son propre canal', () => {
    const envelope = readLiveEnvelope('userFundings', {
      user: ADDR,
      fundings: [
        {
          time: 5000,
          hash: '0xf',
          delta: { coin: 'BTC', usdc: '-0.42', szi: '1', fundingRate: '0.0001' },
        },
      ],
    });
    expect(envelope?.fundings).toHaveLength(1);
    expect(envelope?.fundings[0]!.usdc).toBe('-0.42');
  });
});

describe('mergeLiveEnvelope', () => {
  const base = emptyHlAccountData(LOWER);

  it('ajoute les fills inconnus et ignore ceux déjà présents (clé = tid)', () => {
    const first = mergeLiveEnvelope(
      base,
      readLiveEnvelope('userFills', {
        isSnapshot: true,
        user: ADDR,
        fills: [fill('1', 1000), fill('2', 2000)],
      })!,
    );
    expect(first.added).toBe(2);
    // Le snapshot rejoue l'historique : la pousse suivante contient un fill déjà connu.
    const second = mergeLiveEnvelope(
      first.data,
      readLiveEnvelope('userFills', {
        user: ADDR,
        fills: [fill('2', 2000), fill('3', 3000)],
      })!,
    );
    expect(second.added).toBe(1);
    expect(Object.keys(second.data.fills).sort()).toEqual(['1', '2', '3']);
  });

  it('ne touche jamais aux curseurs de la synchronisation REST', () => {
    const withCursors = { ...base, cursors: { fills: 1234, funding: 5678, ledger: 9012 } };
    const merged = mergeLiveEnvelope(
      withCursors,
      readLiveEnvelope('userFills', {
        user: ADDR,
        fills: [fill('9', 9000)],
      })!,
    );
    expect(merged.data.cursors).toEqual(withCursors.cursors);
    expect(merged.data.snapshot).toBeNull();
  });

  it('rien de nouveau : l’objet d’origine est rendu tel quel (aucune écriture inutile)', () => {
    const envelope = readLiveEnvelope('userFills', { user: ADDR, fills: [] })!;
    const merged = mergeLiveEnvelope(base, envelope);
    expect(merged.added).toBe(0);
    expect(merged.data).toBe(base);
  });
});
