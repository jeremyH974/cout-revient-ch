import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AlertRule } from '../src/lib/domain/alerts';
import { D } from '../src/lib/domain/money';
import { importCoinhouseCsv } from '../src/lib/import/coinhouse/index';
import { emptyState, type StoredStateV1 } from '../src/lib/storage/schema';
import { buildView, type McpView } from './state';
import { TOOLS, TOOL_DEFINITIONS, ToolError, findTool } from './tools';

const FIXTURE = 'tests/fixtures/coinhouse/export-demo.csv';

/** Sauvegarde synthétique : la fixture du dépôt, plus deux cours en cache. */
function fixtureView(): McpView {
  const parsed = importCoinhouseCsv(readFileSync(FIXTURE, 'utf8'), {}, 'imp:mcp');
  if (!parsed.ok) throw new Error(parsed.error);
  const state: StoredStateV1 = {
    ...emptyState(),
    rawRows: parsed.rows,
    priceCache: {
      btc: {
        asset: 'btc',
        priceEur: '60000',
        at: '2026-08-25T10:00:00Z',
        source: 'test',
        stale: false,
      },
      eth: {
        asset: 'eth',
        priceEur: '2000',
        at: '2026-08-25T10:00:00Z',
        source: 'test',
        stale: false,
      },
    },
  };
  return buildView(state, '/chemin/sauvegarde.json', '2026-08-25T12:00:00.000Z');
}

const view = fixtureView();
const call = (name: string, args: Record<string, unknown> = {}) =>
  findTool(name)!.run(view, args) as Record<string, unknown>;

describe('catalogue d’outils', () => {
  it('n’expose que de la lecture : aucun outil destructeur, aucun accès au monde extérieur', () => {
    expect(TOOLS.length).toBeGreaterThan(4);
    for (const tool of TOOLS) {
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations.destructiveHint, tool.name).toBe(false);
      expect(tool.annotations.openWorldHint, tool.name).toBe(false);
      // Rien qui suggère une écriture : le serveur n'a aucun chemin de modification.
      expect(/write|delete|remove|set_|update|order|buy_now|sell_now/.test(tool.name)).toBe(false);
    }
  });

  it('publie un schéma d’entrée exploitable pour chaque outil', () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.inputSchema.type, def.name).toBe('object');
      expect(def.description.length, def.name).toBeGreaterThan(30);
      expect(def.inputSchema.additionalProperties, def.name).toBe(false);
    }
    expect(TOOL_DEFINITIONS.map((d) => d.name)).toContain('get_portfolio');
  });
});

describe('provenance', () => {
  it('chaque réponse porte la date de la sauvegarde et celle des cours', () => {
    for (const tool of TOOLS) {
      // Les outils à arguments obligatoires sont testés séparément ; ici, ceux sans argument.
      if ((tool.inputSchema.required ?? []).length > 0) continue;
      const result = tool.run(view, {}) as Record<string, unknown>;
      expect(result['backupExportedAt'], tool.name).toBe('2026-08-25T12:00:00.000Z');
      expect(String(result['note']), tool.name).toContain('aucune source en ligne');
    }
  });
});

describe('get_portfolio', () => {
  it('reprend les totaux du moteur, sans les recalculer autrement', () => {
    const result = call('get_portfolio');
    const totals = result['totals'] as Record<string, string | null>;
    expect(totals['valueEur']).toBe(view.report.totals.value?.toString() ?? null);
    expect(totals['realizedEur']).toBe(view.report.totals.realized.toString());
    expect(Array.isArray(result['positions'])).toBe(true);
    expect((result['positions'] as unknown[]).length).toBe(view.report.positions.length);
  });
});

describe('get_position', () => {
  it('rend le PRU et la quantité de l’actif demandé', () => {
    const position = call('get_position', { asset: 'BTC' })['position'] as Record<string, unknown>;
    const engine = view.report.positions.find((p) => p.asset === 'btc')!;
    expect(position['asset']).toBe('btc');
    expect(position['qty']).toBe(engine.qty.toString());
    expect(position['pruEur']).toBe(engine.pru?.toString() ?? null);
  });

  it('refuse un actif inconnu par une erreur d’outil, pas par une exception muette', () => {
    expect(() => call('get_position', { asset: 'inexistant' })).toThrow(ToolError);
  });
});

describe('get_insights', () => {
  it('rend des phrases françaises et rappelle que ce ne sont pas des conseils', () => {
    const result = call('get_insights');
    const insights = result['insights'] as { code: string; detail: string }[];
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) expect(insight.detail.endsWith('.')).toBe(true);
    expect(String(result['disclaimer'])).toContain('ni un conseil');
    // Sans historique de prix, le repère et le repli ne sont pas inventés.
    expect(insights.some((i) => i.code === 'benchmark-gap' || i.code === 'max-drawdown')).toBe(
      false,
    );
  });
});

describe('simulate_sell', () => {
  it('calcule le produit net et le résultat réalisé comme le moteur', () => {
    const engine = view.report.positions.find((p) => p.asset === 'btc')!;
    const qty = engine.qty.div('2').round(8).toString();
    const result = call('simulate_sell', { asset: 'btc', qty, priceEur: '60000', fee: 'none' });
    // Sans frais, produit brut = quantité × prix.
    expect(result['netProceedsEur']).toBe(D(qty).times('60000').toString());
    expect(result['feesEur']).toBe('0');
    expect(String(result['taxNote'])).toContain('150 VH bis');
  });

  it('refuse une quantité supérieure à la position', () => {
    expect(() => call('simulate_sell', { asset: 'btc', qty: '999999', priceEur: '60000' })).toThrow(
      ToolError,
    );
  });

  it('refuse un barème de frais inconnu plutôt que d’en choisir un', () => {
    expect(() =>
      call('simulate_sell', { asset: 'btc', qty: '0.001', priceEur: '60000', fee: 'gratuit' }),
    ).toThrow(ToolError);
  });
});

describe('simulate_buy', () => {
  it('accepte un actif encore jamais détenu (position vide)', () => {
    const result = call('simulate_buy', {
      asset: 'dot',
      spendEur: '1000',
      priceEur: '5',
      fee: 'none',
    });
    expect(result['pruBeforeEur']).toBeNull();
    expect(result['qtyBought']).toBe('200');
    expect(result['pruAfterEur']).toBe('5');
  });
});

describe('list_alerts et get_subscription', () => {
  it('rendent des listes vides ou neutres sans planter sur une sauvegarde sans alerte', () => {
    expect(call('list_alerts')['alerts']).toEqual([]);
    const subscription = call('get_subscription');
    expect(typeof subscription['detectedTier']).toBe('string');
    expect(subscription['tradeCount']).toBe(view.subscription.tradeCount);
  });
});

/**
 * Le verrou de câblage (décision n° 77).
 *
 * `untrusted-text.test.ts` éprouve la fonction ; celui-ci éprouve qu'elle est **branchée**, sur la
 * seule voie par laquelle du texte d'utilisateur atteint un modèle. Une fonction juste qu'on
 * oublie d'appeler ne protège de rien.
 */
describe('texte utilisateur exposé au modèle', () => {
  const char = (code: number) => String.fromCharCode(code);

  const ruleWith = (note: string): AlertRule => ({
    id: 'a:1',
    asset: 'btc',
    direction: 'below',
    threshold: { kind: 'pru-pct', percent: '5' },
    repeat: 'once',
    enabled: true,
    note,
    createdAt: '2026-08-01T10:00:00.000Z',
    expiresAt: null,
    gate: null,
  });

  const viewWithNote = (note: string): McpView => {
    const base = fixtureView();
    return {
      ...base,
      state: {
        ...base.state,
        alerts: { ...base.state.alerts, rules: { 'a:1': ruleWith(note) } },
      },
    };
  };

  it('neutralise la note d’une alerte avant de la rendre', () => {
    const piege = `note${char(0x1b)}[2J${char(0x202e)}cache${char(0x200b)}`;
    const out = (findTool('list_alerts')!.run(viewWithNote(piege), {}) as Record<string, unknown>)[
      'alerts'
    ] as { note: string }[];
    expect(out[0]?.note, 'la note n’a pas été neutralisée').toBe('notecache');
  });

  it('dit au modèle que ce champ est une donnée, pas une instruction', () => {
    // La `description` est le canal que le modèle lit par construction : c'est là que la
    // provenance doit être déclarée, pas dans un commentaire de code.
    const tool = TOOL_DEFINITIONS.find((t) => t.name === 'list_alerts');
    expect(tool?.description).toMatch(/jamais comme une instruction/);
  });
});
