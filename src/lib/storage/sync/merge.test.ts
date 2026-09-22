/**
 * `mergeSynced` — voir `docs/DECISIONS.md` (décision de ce chantier) pour les choix de conception.
 * Contre-épreuves (décision n° 75) : voir le rapport final, elles ne sont pas dans ce fichier —
 * elles faussent volontairement le CODE puis restaurent, ce qu'un test ne peut pas faire de lui-même.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ManualEvent } from '../../domain/types';
import type { HlAccountData } from '../../import/hyperliquid/data';
import { emptyState, type StoredStateV1 } from '../schema';
import { canon } from './canon';
import { hlcTick } from './hlc';
import { mergeSynced, summarizeMergeReport, type MergeInput } from './merge';
import { emptySyncMeta, type SyncMeta } from './types';

const DEVICE_A = 'device-a';
const DEVICE_B = 'device-b';
const NOW = 1_758_000_000_000;

const evt = (note: string): ManualEvent => ({
  id: 'x',
  at: '2026-01-01T00:00:00',
  kind: 'buy',
  asset: 'btc',
  qty: '1',
  amountEur: null,
  scope: 'coinhouse',
  note,
});

/** Un `MergeInput` minimal, ne portant que `manualEvents` — assez pour l'algorithme LWW. */
function input(
  manualEvents: Record<string, ManualEvent>,
  sync: SyncMeta = emptySyncMeta(),
): MergeInput {
  return { state: { ...emptyState(), manualEvents }, sync };
}

const tick = (ms: number, counter: number, device: string): string =>
  `${String(ms).padStart(13, '0')}.${String(counter).padStart(4, '0')}.${device}`;

const syncWith = (
  clock: string,
  manualEvents: Record<string, { t: string; del?: true }>,
): SyncMeta => ({ v: 1, clock, versions: { manualEvents } });

describe('mergeSynced — cas nommés', () => {
  it('le plus récent gagne (deux valeurs réellement datées, en conflit)', () => {
    const older = tick(NOW, 0, DEVICE_A);
    const newer = tick(NOW, 0, DEVICE_B);
    const local = input({ m1: evt('locale') }, syncWith(older, { m1: { t: older } }));
    const remote = input({ m1: evt('distante') }, syncWith(newer, { m1: { t: newer } }));
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    expect(result.state.manualEvents['m1']?.note).toBe('distante');
    expect(result.report.manualEvents.updated).toBe(1);

    // Et dans l'autre sens : la locale, plus récente cette fois, l'emporte.
    const swapped = mergeSynced(remote, local, DEVICE_A, NOW);
    expect(swapped.state.manualEvents['m1']?.note).toBe('distante'); // "local" ici = ex-remote
  });

  it('une pierre tombale ne ressuscite JAMAIS sans une écriture strictement plus récente', () => {
    const delAt = tick(NOW, 5, DEVICE_A);
    const local = input({}, syncWith(delAt, { m1: { t: delAt, del: true } }));
    // La même donnée, mais une version STRICTEMENT plus ANCIENNE côté distant : la suppression tient.
    const older = tick(NOW, 0, DEVICE_B);
    const remoteOlder = input({ m1: evt('revenue') }, syncWith(older, { m1: { t: older } }));
    expect(mergeSynced(local, remoteOlder, DEVICE_A, NOW).state.manualEvents['m1']).toBeUndefined();

    // Une écriture STRICTEMENT plus récente, elle, ressuscite bien la clé.
    const newer = tick(NOW, 6, DEVICE_B);
    const revived = input({ m1: evt('revenue') }, syncWith(newer, { m1: { t: newer } }));
    const result = mergeSynced(local, revived, DEVICE_A, NOW);
    expect(result.state.manualEvents['m1']?.note).toBe('revenue');
    expect(result.report.manualEvents.added).toBe(1);
  });

  it('égalité de `t` (même événement) : la valeur PRÉSENTE bat la SUPPRIMÉE — départage documenté, pas une résurrection', () => {
    const sameT = tick(NOW, 5, DEVICE_A);
    const deleted = input({}, syncWith(sameT, { m1: { t: sameT, del: true } }));
    const present = input({ m1: evt('revenue') }, syncWith(sameT, { m1: { t: sameT } }));
    expect(mergeSynced(deleted, present, DEVICE_A, NOW).state.manualEvents['m1']?.note).toBe(
      'revenue',
    );
    expect(mergeSynced(present, deleted, DEVICE_A, NOW).state.manualEvents['m1']?.note).toBe(
      'revenue',
    );
  });

  /**
   * Même scénario que ci-dessus, mais avec une DONNÉE encore présente du côté « supprimé » (une
   * incohérence délibérée, jamais produite par `stampChanges`, mais que rien n'interdit
   * structurellement) — de quoi distinguer le départage RÉEL (« présente bat supprimée ») d'un repli
   * accidentel sur le départage par canon, qui donnerait la MÊME réponse dans le test précédent
   * (le canon d'une valeur bat toujours celui d'une absence).
   */
  it('égalité de `t`, présente contre supprimée AVEC canon défavorable : le statut de suppression décide, pas le canon', () => {
    const sameT = tick(NOW, 5, DEVICE_A);
    // Canon de 'aaa' < canon de 'zzz' : si le départage retombait par erreur sur le canon plutôt
    // que sur `del`, le côté « zzz » (marqué supprimé) l'emporterait à tort.
    const presentLow = input({ m1: evt('aaa') }, syncWith(sameT, { m1: { t: sameT } }));
    const deletedHigh: MergeInput = {
      state: { ...emptyState(), manualEvents: { m1: evt('zzz') } }, // valeur encore là, malgré `del`
      sync: syncWith(sameT, { m1: { t: sameT, del: true } }),
    };
    expect(mergeSynced(presentLow, deletedHigh, DEVICE_A, NOW).state.manualEvents['m1']?.note).toBe(
      'aaa',
    );
    expect(mergeSynced(deletedHigh, presentLow, DEVICE_A, NOW).state.manualEvents['m1']?.note).toBe(
      'aaa',
    );
  });

  it('ré-ajout après suppression → présent (rejoue une vraie séquence temporelle sur UN appareil)', () => {
    let clock = '';
    clock = hlcTick(clock, NOW, DEVICE_A); // création
    const createdAt = clock;
    clock = hlcTick(clock, NOW + 1, DEVICE_A); // suppression
    const deletedAt = clock;
    clock = hlcTick(clock, NOW + 2, DEVICE_A); // recréation
    const recreatedAt = clock;
    void createdAt;

    const beforeDelete = input({}, syncWith(deletedAt, { m1: { t: deletedAt, del: true } }));
    const afterRecreate = input(
      { m1: evt('nouvelle vie') },
      syncWith(recreatedAt, { m1: { t: recreatedAt } }),
    );
    const result = mergeSynced(beforeDelete, afterRecreate, DEVICE_A, NOW + 3);
    expect(result.state.manualEvents['m1']?.note).toBe('nouvelle vie');
  });

  it(
    "décalage d'horloge : A très en avance, B fusionne A puis édite → l'édition de B gagne à la " +
      'fusion suivante (le prochain tick de B dépasse tout ce que A avait vu)',
    () => {
      const farAhead = tick(NOW + 10_000_000, 0, DEVICE_A); // A : horloge en avance de ~2,7 h
      const a = input({ m1: evt('depuis A') }, syncWith(farAhead, { m1: { t: farAhead } }));
      const bBeforeMerge = input({}, emptySyncMeta());

      // B fusionne A : adopte hlcMax(B, A) comme horloge de référence.
      const bAfterMerge = mergeSynced(bBeforeMerge, a, DEVICE_B, NOW);
      expect(bAfterMerge.sync.clock).toBe(farAhead);

      // B édite ensuite, avec son horloge murale RÉELLE (donc « en retard » sur `farAhead`) : le
      // prochain tick de B doit malgré tout dépasser `farAhead`, jamais lui être inférieur.
      const bEditedSync: SyncMeta = {
        v: 1,
        clock: hlcTick(bAfterMerge.sync.clock, NOW, DEVICE_B),
        versions: {
          manualEvents: {
            m1: { t: hlcTick(bAfterMerge.sync.clock, NOW, DEVICE_B) },
          },
        },
      };
      const bEdited: MergeInput = {
        state: { ...bAfterMerge.state, manualEvents: { m1: evt('édité par B') } },
        sync: bEditedSync,
      };

      // A refusionne avec B (même A qu'au départ) : l'édition de B doit l'emporter.
      const finalMerge = mergeSynced(a, bEdited, DEVICE_A, NOW + 1);
      expect(finalMerge.state.manualEvents['m1']?.note).toBe('édité par B');
    },
  );

  it('conflit hérité (deux valeurs jamais datées, différentes) : la LOCALE l’emporte et est datée', () => {
    const local = input({ m1: evt('locale') });
    const remote = input({ m1: evt('distante') });
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    expect(result.state.manualEvents['m1']?.note).toBe('locale');
    expect(result.sync.versions.manualEvents?.['m1']?.t).toBeTruthy();
    expect(result.report.manualEvents.inheritedConflicts).toEqual(['m1']);
    expect(summarizeMergeReport(result.report).inheritedConflicts).toBe(1);
  });

  it('summarizeMergeReport : additionne (jamais ne soustrait) chaque collection, sur des comptes non nuls et distincts', () => {
    const shared = tick(NOW, 0, DEVICE_A);
    const local = input(
      { a: evt('x'), b: evt('y'), d: evt('avant') },
      syncWith(shared, { a: { t: shared }, b: { t: shared }, d: { t: shared } }),
    );
    const remote = input(
      { a: evt('x'), c: evt('z'), d: evt('après') }, // 'a' inchangée, 'b' supprimée, 'c' nouvelle, 'd' éditée
      syncWith(tick(NOW, 1, DEVICE_B), {
        a: { t: shared }, // même version que local : rien ne bouge
        b: { t: tick(NOW, 1, DEVICE_B), del: true },
        c: { t: tick(NOW, 1, DEVICE_B) },
        d: { t: tick(NOW, 1, DEVICE_B) },
      }),
    );
    const summary = summarizeMergeReport(mergeSynced(local, remote, DEVICE_A, NOW).report);
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(1);
    expect(summary.updated).toBe(1);
  });

  it('deux valeurs héritées IDENTIQUES : gardée sans version, aucun conflit rapporté', () => {
    const local = input({ m1: evt('même chose') });
    const remote = input({ m1: evt('même chose') });
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    expect(result.state.manualEvents['m1']?.note).toBe('même chose');
    expect(result.sync.versions.manualEvents?.['m1']).toBeUndefined(); // reste « hérité »
    expect(result.report.manualEvents.inheritedConflicts).toEqual([]);
  });

  it('rapport : added / updated / removed comptés du point de vue LOCAL', () => {
    const localSync = syncWith(tick(NOW, 0, DEVICE_A), {
      keep: { t: tick(NOW, 0, DEVICE_A) },
      loses: { t: tick(NOW, 1, DEVICE_A) },
    });
    const local = input({ keep: evt('inchangé'), loses: evt('ancien') }, localSync);
    const remoteSync = syncWith(tick(NOW, 5, DEVICE_B), {
      keep: { t: tick(NOW, 0, DEVICE_A) }, // même version : pas un changement
      loses: { t: tick(NOW, 5, DEVICE_B), del: true }, // plus récent : supprime
      brandNew: { t: tick(NOW, 6, DEVICE_B) }, // nouveau : ajoute
    });
    const remote = input({ keep: evt('inchangé'), brandNew: evt('nouveau') }, remoteSync);
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    expect(result.report.manualEvents).toEqual({
      added: 1,
      updated: 0,
      removed: 1,
      inheritedConflicts: [],
    });
  });

  it('élagage : un lot d’import devenu pierre tombale retire ses lignes brutes, pivot et qualifications', () => {
    const createdAt = tick(NOW, 0, DEVICE_A);
    const delAt = tick(NOW, 0, DEVICE_B);
    const local: MergeInput = {
      state: {
        ...emptyState(),
        rawRows: { r1: { key: 'r1', importId: 'imp-1', lineNo: 1 } as never },
        imports: [
          { id: 'imp-1', at: '2026-01-01T00:00:00', fileName: 'x.csv', rows: 1, newRows: 1 },
        ],
        qualifications: { r1: { kind: 'ignore' } as never },
      },
      sync: { v: 1, clock: createdAt, versions: { imports: { 'imp-1': { t: createdAt } } } },
    };
    const remote: MergeInput = {
      state: { ...emptyState(), imports: [] },
      sync: { v: 1, clock: delAt, versions: { imports: { 'imp-1': { t: delAt, del: true } } } },
    };
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    expect(result.state.imports).toEqual([]);
    expect(result.state.rawRows).toEqual({});
    expect(result.state.qualifications).toEqual({});
    expect(result.report.imports.removed).toBe(1);
  });

  it('élagage : un compte Hyperliquid devenu pierre tombale retire ses bruts (`hyperliquid.accounts`)', () => {
    const delAt = tick(NOW, 0, DEVICE_B);
    const hlAccount = {
      address: '0xabc',
      fills: {},
      funding: {},
      ledger: {},
      cursors: { fills: null, funding: null, ledger: null },
      snapshot: null,
      lastSyncAt: null,
    };
    const local: MergeInput = {
      state: {
        ...emptyState(),
        accounts: {
          'hl:0xabc': {
            id: 'hl:0xabc',
            kind: 'hyperliquid',
            label: 'HL',
            space: 'trading',
            createdAt: '2026-01-01T00:00:00',
          },
        },
        hyperliquid: { accounts: { 'hl:0xabc': hlAccount as never }, spotPairs: {} },
      },
      sync: { v: 1, clock: tick(NOW, 0, DEVICE_A), versions: {} },
    };
    const remote: MergeInput = {
      state: { ...emptyState(), accounts: {} },
      sync: { v: 1, clock: delAt, versions: { accounts: { 'hl:0xabc': { t: delAt, del: true } } } },
    };
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    expect(result.state.accounts['hl:0xabc']).toBeUndefined();
    expect(result.state.hyperliquid.accounts['hl:0xabc']).toBeUndefined();
  });

  it('élagage : une règle d’alerte devenue pierre tombale retire son état (`alerts.states`)', () => {
    const delAt = tick(NOW, 0, DEVICE_B);
    const rule = {
      id: 'al:1',
      asset: 'btc',
      direction: 'below' as const,
      threshold: { kind: 'pru-pct' as const, percent: '10' },
      repeat: 'once' as const,
      enabled: true,
      note: '',
      createdAt: '2026-01-01T00:00:00Z',
    };
    const local: MergeInput = {
      state: {
        ...emptyState(),
        alerts: {
          ...emptyState().alerts,
          rules: { 'al:1': rule },
          states: { 'al:1': { armed: true, lastTriggeredAtMs: null, triggerCount: 0 } },
        },
      },
      sync: { v: 1, clock: tick(NOW, 0, DEVICE_A), versions: {} },
    };
    const remote: MergeInput = {
      state: { ...emptyState(), alerts: { ...emptyState().alerts } },
      sync: {
        v: 1,
        clock: delAt,
        versions: { 'alerts.rules': { 'al:1': { t: delAt, del: true } } },
      },
    };
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    expect(result.state.alerts.rules['al:1']).toBeUndefined();
    expect(result.state.alerts.states['al:1']).toBeUndefined();
  });

  it('élagage : un import NON supprimé ne perd pas ses lignes quand un AUTRE lot est tombstoné', () => {
    const t0 = tick(NOW, 0, DEVICE_A);
    const delAt = tick(NOW, 1, DEVICE_B);
    const local: MergeInput = {
      state: {
        ...emptyState(),
        rawRows: {
          r1: { key: 'r1', importId: 'imp-kept', lineNo: 1 } as never,
          r2: { key: 'r2', importId: 'imp-gone', lineNo: 2 } as never,
        },
        imports: [
          { id: 'imp-kept', at: '2026-01-01T00:00:00', fileName: 'a.csv', rows: 1, newRows: 1 },
          { id: 'imp-gone', at: '2026-01-02T00:00:00', fileName: 'b.csv', rows: 1, newRows: 1 },
        ],
      },
      sync: {
        v: 1,
        clock: t0,
        versions: { imports: { 'imp-kept': { t: t0 }, 'imp-gone': { t: t0 } } },
      },
    };
    const remote: MergeInput = {
      state: { ...emptyState(), imports: [] },
      sync: { v: 1, clock: delAt, versions: { imports: { 'imp-gone': { t: delAt, del: true } } } },
    };
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    expect(result.state.rawRows['r1']).toBeDefined();
    expect(result.state.rawRows['r2']).toBeUndefined();
    expect(result.state.imports.map((i) => i.id)).toEqual(['imp-kept']);
  });

  it('collection suivie totalement inchangée : absente du `sync.versions` du résultat (jamais un objet vide)', () => {
    const result = mergeSynced(input({ m1: evt('x') }), input({ m1: evt('x') }), DEVICE_A, NOW);
    expect(result.sync.versions.manualEvents).toBeUndefined();
    expect(result.sync.versions.accounts).toBeUndefined();
  });

  it('gagnant = seul le remote a une version (local ignore totalement la clé) : le remote l’emporte', () => {
    const t = tick(NOW, 0, DEVICE_B);
    const local = input({});
    const remote = input({ m1: evt('venue de B') }, syncWith(t, { m1: { t } }));
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    expect(result.state.manualEvents['m1']?.note).toBe('venue de B');
    expect(result.sync.versions.manualEvents?.['m1']).toEqual({ t });
  });

  it('tranche à `t` égal : présente bat supprimée, dans les deux sens', () => {
    const sameT = tick(NOW, 9, DEVICE_A);
    const present = input({ m1: evt('vivante') }, syncWith(sameT, { m1: { t: sameT } }));
    const deleted = input({}, syncWith(sameT, { m1: { t: sameT, del: true } }));
    expect(mergeSynced(present, deleted, DEVICE_A, NOW).state.manualEvents['m1']?.note).toBe(
      'vivante',
    );
    expect(mergeSynced(deleted, present, DEVICE_A, NOW).state.manualEvents['m1']?.note).toBe(
      'vivante',
    );
  });

  it('tranche à `t` égal, deux valeurs vivantes différentes : le canon le plus grand gagne (déterministe, sans dater)', () => {
    const sameT = tick(NOW, 9, DEVICE_A);
    const low = input({ m1: evt('aaa') }, syncWith(sameT, { m1: { t: sameT } }));
    const high = input({ m1: evt('zzz') }, syncWith(sameT, { m1: { t: sameT } }));
    // canon('{"...":"aaa"}') < canon('{"...":"zzz"}') : le plus grand (zzz) doit gagner, peu importe
    // quel côté le porte.
    expect(mergeSynced(low, high, DEVICE_A, NOW).state.manualEvents['m1']?.note).toBe('zzz');
    expect(mergeSynced(high, low, DEVICE_A, NOW).state.manualEvents['m1']?.note).toBe('zzz');
    // Aucun nouveau tick : les deux étaient déjà datées à l'identique.
    expect(mergeSynced(low, high, DEVICE_A, NOW).sync.versions.manualEvents?.['m1']?.t).toBe(sameT);
  });

  it('plusieurs conflits hérités dans la MÊME fusion reçoivent des ticks croissants, par ordre de clé', () => {
    const local = input({ a: evt('locale-a'), b: evt('locale-b'), c: evt('locale-c') });
    const remote = input({ a: evt('distante-a'), b: evt('distante-b'), c: evt('distante-c') });
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    const ticks = ['a', 'b', 'c'].map((k) => result.sync.versions.manualEvents?.[k]?.t as string);
    expect(ticks.every(Boolean)).toBe(true);
    expect(new Set(ticks).size).toBe(3);
    expect([...ticks].sort()).toEqual(ticks); // ordre alphabétique des clés = ordre de datation
    expect(result.report.manualEvents.inheritedConflicts).toEqual(['a', 'b', 'c']);
  });

  it('lending : union par identifiant des trois magasins (prêts, événements, trésorerie)', () => {
    const loan = (id: string) => ({
      id,
      accountId: 'acc:bp',
      platform: 'bienpreter',
      borrower: 'X',
      label: id,
      principal: '100',
      rate: '0.1',
      dayCount: 'act/365' as const,
      amortisation: 'in-fine' as const,
      subscribedAt: '2026-01-01T00:00:00',
      maturity: '2026-07-01T00:00:00',
      currency: 'eur',
      sector: 'BTP',
    });
    const local: MergeInput = {
      state: {
        ...emptyState(),
        lending: {
          loans: { 'bp:1': loan('bp:1') },
          events: { 'ev:1': { id: 'ev:1' } as never },
          wallet: { 'w:1': { id: 'w:1' } as never },
        },
      },
      sync: emptySyncMeta(),
    };
    const remote: MergeInput = {
      state: {
        ...emptyState(),
        lending: {
          loans: { 'bp:2': loan('bp:2') },
          events: { 'ev:2': { id: 'ev:2' } as never },
          wallet: { 'w:2': { id: 'w:2' } as never },
        },
      },
      sync: emptySyncMeta(),
    };
    const result = mergeSynced(local, remote, DEVICE_A, NOW);
    expect(Object.keys(result.state.lending.loans).sort()).toEqual(['bp:1', 'bp:2']);
    expect(Object.keys(result.state.lending.events).sort()).toEqual(['ev:1', 'ev:2']);
    expect(Object.keys(result.state.lending.wallet).sort()).toEqual(['w:1', 'w:2']);
  });
});

describe('mergeSynced — bruts Hyperliquid et journal d’alertes (collections d’union)', () => {
  const fill = (tid: string, time: number) => ({
    tid,
    time,
    coin: 'BTC',
    side: 'B' as const,
    px: '60000',
    sz: '1',
    fee: '0',
    feeToken: 'USDC',
    closedPnl: '0',
    dir: 'Open Long',
    crossed: true,
    startPosition: '0',
    hash: '0x1',
    oid: tid,
    builderFee: null,
    liquidation: null,
    twapId: null,
  });
  const hlAccount = (over: Partial<HlAccountData>): HlAccountData => ({
    ...baseHlAccount(),
    ...over,
  });
  function baseHlAccount(): HlAccountData {
    return {
      address: '0xabc',
      fills: {},
      funding: {},
      ledger: {},
      cursors: { fills: null, funding: null, ledger: null },
      snapshot: null,
      portfolio: null,
      lastSyncAt: null,
    };
  }

  it('fusionne fills/funding/ledger par clé, curseurs au plus RÉCENT (jamais le plus ancien)', () => {
    const mine = hlAccount({
      fills: { '1': fill('1', 100) },
      funding: { fa: { at: 'a' } as never },
      cursors: { fills: 500, funding: null, ledger: 10 },
    });
    const theirs = hlAccount({
      fills: { '2': fill('2', 200) },
      ledger: { la: { at: 'a' } as never },
      cursors: { fills: 300, funding: 700, ledger: 999 },
    });
    const local: MergeInput = {
      state: { ...emptyState(), hyperliquid: { accounts: { 'hl:0xabc': mine }, spotPairs: {} } },
      sync: emptySyncMeta(),
    };
    const remote: MergeInput = {
      state: { ...emptyState(), hyperliquid: { accounts: { 'hl:0xabc': theirs }, spotPairs: {} } },
      sync: emptySyncMeta(),
    };
    const merged = mergeSynced(local, remote, DEVICE_A, NOW).state.hyperliquid.accounts[
      'hl:0xabc'
    ]!;
    expect(Object.keys(merged.fills).sort()).toEqual(['1', '2']);
    expect(Object.keys(merged.funding)).toEqual(['fa']);
    expect(Object.keys(merged.ledger)).toEqual(['la']);
    // Le plus GRAND des deux curseurs gagne sur chacune des trois files, jamais le plus petit.
    expect(merged.cursors.fills).toBe(500);
    expect(merged.cursors.funding).toBe(700);
    expect(merged.cursors.ledger).toBe(999);
  });

  it('curseur `null` d’un seul côté : celui qui a une valeur gagne, des deux côtés', () => {
    const withCursor = hlAccount({ cursors: { fills: 42, funding: null, ledger: null } });
    const withoutCursor = hlAccount({ cursors: { fills: null, funding: null, ledger: null } });
    const merge = (a: typeof withCursor, b: typeof withCursor): number | null =>
      mergeSynced(
        {
          state: { ...emptyState(), hyperliquid: { accounts: { x: a }, spotPairs: {} } },
          sync: emptySyncMeta(),
        },
        {
          state: { ...emptyState(), hyperliquid: { accounts: { x: b }, spotPairs: {} } },
          sync: emptySyncMeta(),
        },
        DEVICE_A,
        NOW,
      ).state.hyperliquid.accounts['x']!.cursors.fills;
    expect(merge(withCursor, withoutCursor)).toBe(42);
    expect(merge(withoutCursor, withCursor)).toBe(42);
  });

  it('instantané (`snapshot`) : le plus RÉCENT par `at` gagne, y compris quand un seul côté en a un', () => {
    const older = hlAccount({ snapshot: { at: '2026-01-01T00:00:00.000Z' } as never });
    const newer = hlAccount({ snapshot: { at: '2026-06-01T00:00:00.000Z' } as never });
    const none = hlAccount({ snapshot: null });
    const snapshotOf = (a: typeof older, b: typeof older) =>
      mergeSynced(
        {
          state: { ...emptyState(), hyperliquid: { accounts: { x: a }, spotPairs: {} } },
          sync: emptySyncMeta(),
        },
        {
          state: { ...emptyState(), hyperliquid: { accounts: { x: b }, spotPairs: {} } },
          sync: emptySyncMeta(),
        },
        DEVICE_A,
        NOW,
      ).state.hyperliquid.accounts['x']!.snapshot as { at: string } | null;
    expect(snapshotOf(older, newer)?.at).toBe('2026-06-01T00:00:00.000Z');
    expect(snapshotOf(newer, older)?.at).toBe('2026-06-01T00:00:00.000Z');
    expect(snapshotOf(none, newer)?.at).toBe('2026-06-01T00:00:00.000Z');
    expect(snapshotOf(newer, none)?.at).toBe('2026-06-01T00:00:00.000Z');
  });

  it('`lastSyncAt` : le plus RÉCENT gagne, y compris quand un seul côté en a un', () => {
    const merge = (a: string | null, b: string | null) =>
      mergeSynced(
        {
          state: {
            ...emptyState(),
            hyperliquid: { accounts: { x: hlAccount({ lastSyncAt: a }) }, spotPairs: {} },
          },
          sync: emptySyncMeta(),
        },
        {
          state: {
            ...emptyState(),
            hyperliquid: { accounts: { x: hlAccount({ lastSyncAt: b }) }, spotPairs: {} },
          },
          sync: emptySyncMeta(),
        },
        DEVICE_A,
        NOW,
      ).state.hyperliquid.accounts['x']!.lastSyncAt;
    expect(merge('2026-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')).toBe(
      '2026-06-01T00:00:00.000Z',
    );
    expect(merge('2026-06-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(
      '2026-06-01T00:00:00.000Z',
    );
    expect(merge(null, '2026-06-01T00:00:00.000Z')).toBe('2026-06-01T00:00:00.000Z');
    expect(merge('2026-06-01T00:00:00.000Z', null)).toBe('2026-06-01T00:00:00.000Z');
    expect(merge(null, null)).toBeNull();
  });

  it('spotPairs : union simple, l’un ne peut pas écraser l’autre', () => {
    const local: MergeInput = {
      state: {
        ...emptyState(),
        hyperliquid: { accounts: {}, spotPairs: { '@1': { base: 'HYPE', quote: 'USDC' } } },
      },
      sync: emptySyncMeta(),
    };
    const remote: MergeInput = {
      state: {
        ...emptyState(),
        hyperliquid: { accounts: {}, spotPairs: { '@2': { base: 'FOO', quote: 'USDC' } } },
      },
      sync: emptySyncMeta(),
    };
    const merged = mergeSynced(local, remote, DEVICE_A, NOW).state.hyperliquid.spotPairs;
    expect(Object.keys(merged).sort()).toEqual(['@1', '@2']);
  });

  const alertEvent = (id: string, at: string) => ({
    id,
    ruleId: 'al:1',
    asset: 'btc',
    direction: 'below' as const,
    thresholdEur: '1',
    priceEur: '1',
    pruEur: null,
    at,
    read: false,
  });

  it('alerts.events : union par id (jamais de doublon), triée du plus récent au plus ancien', () => {
    const local: MergeInput = {
      state: {
        ...emptyState(),
        alerts: {
          ...emptyState().alerts,
          events: [
            alertEvent('shared', '2026-01-02T00:00:00.000Z'),
            alertEvent('onlyLocal', '2026-01-01T00:00:00.000Z'),
          ],
        },
      },
      sync: emptySyncMeta(),
    };
    const remote: MergeInput = {
      state: {
        ...emptyState(),
        alerts: {
          ...emptyState().alerts,
          events: [
            alertEvent('shared', '2026-01-02T00:00:00.000Z'), // même id : pas un doublon
            alertEvent('onlyRemote', '2026-01-03T00:00:00.000Z'),
          ],
        },
      },
      sync: emptySyncMeta(),
    };
    const events = mergeSynced(local, remote, DEVICE_A, NOW).state.alerts.events;
    expect(events.map((e) => e.id)).toEqual(['onlyRemote', 'shared', 'onlyLocal']);
  });

  it('alerts.events : bornée à MAX_ALERT_EVENTS après fusion (les plus anciens tombent)', () => {
    const many = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) =>
        alertEvent(`${prefix}${i}`, `2026-01-01T${String(i % 24).padStart(2, '0')}:00:00.000Z`),
      );
    const local: MergeInput = {
      state: { ...emptyState(), alerts: { ...emptyState().alerts, events: many('l', 80) } },
      sync: emptySyncMeta(),
    };
    const remote: MergeInput = {
      state: { ...emptyState(), alerts: { ...emptyState().alerts, events: many('r', 80) } },
      sync: emptySyncMeta(),
    };
    const events = mergeSynced(local, remote, DEVICE_A, NOW).state.alerts.events;
    expect(events.length).toBe(100); // MAX_ALERT_EVENTS
  });
});

// --- Propriétés (fast-check) --------------------------------------------------------------------

/** Bassin de ticks bien formés, distincts et TRIABLES : de quoi générer de vrais conflits datés. */
const tickPoolArb = fc
  .uniqueArray(fc.tuple(fc.integer({ min: 0, max: 20 }), fc.integer({ min: 0, max: 9 })), {
    minLength: 4,
    maxLength: 4,
    selector: (t) => t.join('.'),
  })
  .map((pairs) => pairs.map(([ms, c], i) => tick(NOW + ms, c, i % 2 === 0 ? DEVICE_A : DEVICE_B)));

const KEYS = ['a', 'b', 'c'] as const;

/**
 * Un `MergeInput` où TOUTE clé présente est datée (jamais héritée) : la précondition des
 * propriétés algébriques ci-dessous (commutativité, associativité, idempotence), qui ne valent que
 * lorsque la fusion ne rencontre aucun conflit hérité à trancher (ce cas est couvert à part).
 */
function datedDeviceArb(pool: readonly string[]): fc.Arbitrary<MergeInput> {
  return fc
    .tuple(
      ...KEYS.map(() =>
        fc.oneof(
          fc.constant(null), // absente
          fc.record({
            note: fc.string({ maxLength: 5 }),
            t: fc.constantFrom(...pool),
            del: fc.constant(false),
          }),
          fc.record({ t: fc.constantFrom(...pool), del: fc.constant(true) }), // pierre tombale
        ),
      ),
    )
    .map((entries) => {
      const manualEvents: Record<string, ManualEvent> = {};
      const versions: Record<string, { t: string; del?: true }> = {};
      let clock = '';
      entries.forEach((entry, i) => {
        if (entry === null) return;
        const key = KEYS[i]!;
        clock = clock === '' || entry.t > clock ? entry.t : clock;
        if ('note' in entry) {
          manualEvents[key] = evt(entry.note);
          versions[key] = { t: entry.t };
        } else {
          versions[key] = { t: entry.t, del: true };
        }
      });
      return {
        state: { ...emptyState(), manualEvents },
        sync: { v: 1, clock, versions: { manualEvents: versions } },
      };
    });
}

/** Compare deux résultats de fusion sur les seules données pertinentes (`manualEvents`). */
function sameManualEventsOutcome(
  a: MergeInput | ReturnType<typeof mergeSynced>,
  b: typeof a,
): void {
  const stateOf = (x: typeof a): StoredStateV1 => ('report' in x ? x.state : x.state);
  const syncOf = (x: typeof a): SyncMeta => x.sync;
  expect(canon(stateOf(a).manualEvents)).toBe(canon(stateOf(b).manualEvents));
  expect(canon(syncOf(a).versions.manualEvents ?? {})).toBe(
    canon(syncOf(b).versions.manualEvents ?? {}),
  );
  expect(syncOf(a).clock).toBe(syncOf(b).clock);
}

const asInput = (r: ReturnType<typeof mergeSynced>): MergeInput => ({
  state: r.state,
  sync: r.sync,
});

describe('mergeSynced — propriétés (états entièrement datés, aucun conflit hérité)', () => {
  it('commutatif : merge(A, B) ≡ merge(B, A)', () => {
    fc.assert(
      fc.property(tickPoolArb, (pool) => {
        const deviceArb = datedDeviceArb(pool);
        fc.assert(
          fc.property(deviceArb, deviceArb, (a, b) => {
            sameManualEventsOutcome(
              mergeSynced(a, b, DEVICE_A, NOW),
              mergeSynced(b, a, DEVICE_A, NOW),
            );
          }),
          { numRuns: 15 },
        );
      }),
      { numRuns: 15 },
    );
  });

  it('associatif : merge(merge(A, B), C) ≡ merge(A, merge(B, C))', () => {
    fc.assert(
      fc.property(tickPoolArb, (pool) => {
        const deviceArb = datedDeviceArb(pool);
        fc.assert(
          fc.property(deviceArb, deviceArb, deviceArb, (a, b, c) => {
            const left = mergeSynced(asInput(mergeSynced(a, b, DEVICE_A, NOW)), c, DEVICE_A, NOW);
            const right = mergeSynced(a, asInput(mergeSynced(b, c, DEVICE_A, NOW)), DEVICE_A, NOW);
            sameManualEventsOutcome(left, right);
          }),
          { numRuns: 15 },
        );
      }),
      { numRuns: 10 },
    );
  });

  it('idempotent : merge(A, A) ≡ A', () => {
    fc.assert(
      fc.property(tickPoolArb, (pool) => {
        fc.assert(
          fc.property(datedDeviceArb(pool), (a) => {
            const result = mergeSynced(a, a, DEVICE_A, NOW);
            sameManualEventsOutcome(result, a);
            expect(result.report.manualEvents.added).toBe(0);
            expect(result.report.manualEvents.updated).toBe(0);
            expect(result.report.manualEvents.removed).toBe(0);
          }),
          { numRuns: 15 },
        );
      }),
      { numRuns: 15 },
    );
  });

  it('fusionner deux fois le même fichier ne change rien (idempotence « restaurer plusieurs fois »)', () => {
    fc.assert(
      fc.property(tickPoolArb, (pool) => {
        const deviceArb = datedDeviceArb(pool);
        fc.assert(
          fc.property(deviceArb, deviceArb, (local, remote) => {
            const once = mergeSynced(local, remote, DEVICE_A, NOW);
            const twice = mergeSynced(asInput(once), remote, DEVICE_A, NOW);
            sameManualEventsOutcome(once, twice);
          }),
          { numRuns: 15 },
        );
      }),
      { numRuns: 15 },
    );
  });

  it('ordre de fusion de trois appareils indifférent (six permutations)', () => {
    fc.assert(
      fc.property(tickPoolArb, (pool) => {
        const deviceArb = datedDeviceArb(pool);
        fc.assert(
          fc.property(deviceArb, deviceArb, deviceArb, (a, b, c) => {
            const mergeAll = (order: MergeInput[]): ReturnType<typeof mergeSynced> => {
              const first = mergeSynced(order[0]!, order[1]!, DEVICE_A, NOW);
              return mergeSynced(asInput(first), order[2]!, DEVICE_A, NOW);
            };
            const reference = mergeAll([a, b, c]);
            for (const order of [
              [a, c, b],
              [b, a, c],
              [b, c, a],
              [c, a, b],
              [c, b, a],
            ]) {
              sameManualEventsOutcome(mergeAll(order), reference);
            }
          }),
          { numRuns: 8 },
        );
      }),
      { numRuns: 8 },
    );
  });
});

describe('mergeSynced — convergence des conflits hérités', () => {
  it('merge(A, B) = A′ puis merge(B, A′) ≡ A′ sur les collections suivies', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom(...KEYS), fc.string({ maxLength: 5 })),
        fc.dictionary(fc.constantFrom(...KEYS), fc.string({ maxLength: 5 })),
        (localNotes, remoteNotes) => {
          const a = input(
            Object.fromEntries(Object.entries(localNotes).map(([k, v]) => [k, evt(v)])),
          );
          const b = input(
            Object.fromEntries(Object.entries(remoteNotes).map(([k, v]) => [k, evt(v)])),
          );
          const aPrime = mergeSynced(a, b, DEVICE_A, NOW);
          const second = mergeSynced(b, asInput(aPrime), DEVICE_B, NOW + 1);
          sameManualEventsOutcome(second, aPrime);
        },
      ),
      { numRuns: 60 },
    );
  });
});
