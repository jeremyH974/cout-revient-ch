/**
 * Outils du serveur MCP local (décision n° 47) — **lecture seule**, et rien d'autre.
 *
 * Aucun outil n'écrit, ne supprime, ni ne passe d'ordre : le serveur lit une sauvegarde et répond.
 * Chaque réponse porte sa **provenance** (date de la sauvegarde, date des cours) parce qu'un
 * chiffre juste hier et présenté comme actuel est un chiffre faux.
 *
 * Module PUR : les fonctions prennent la vue déjà chargée et rendent du JSON. Le transport
 * (`server.ts`) ne fait que router — ce qui rend tout ce fichier testable sans processus.
 */
import { renderInsights } from '../src/lib/format/insights';
import { COINHOUSE_FEES, ZERO_FEE, type FeeRate } from '../src/lib/domain/fees';
import { D, toDecimalString, type Big } from '../src/lib/domain/money';
import { simulateBuy, simulateSell } from '../src/lib/domain/simulate';
import { alertThresholdEur } from '../src/lib/domain/alerts';
import type { PositionReport } from '../src/lib/domain/engine';
import type { McpView } from './state';

/** Schéma JSON d'un outil (sous-ensemble suffisant : le protocole accepte du JSON Schema brut). */
export interface JsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  /** Annotations du protocole : toutes nos opérations sont en lecture seule et sans effet. */
  annotations: { readOnlyHint: true; destructiveHint: false; openWorldHint: false };
}

export interface Tool extends ToolDefinition {
  run(view: McpView, args: Record<string, unknown>): unknown;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

const dec = (value: Big | null): string | null => (value === null ? null : toDecimalString(value));

/** Provenance jointe à CHAQUE réponse : sans elle, un chiffre daté passerait pour actuel. */
function provenance(view: McpView): Record<string, unknown> {
  return {
    backupExportedAt: view.exportedAt,
    backupPath: view.path,
    pricedAt: view.pricedAt,
    note: 'Chiffres à la date de la sauvegarde, cours issus de son cache : ce serveur ne consulte aucune source en ligne.',
  };
}

function positionOf(view: McpView, asset: string): PositionReport | null {
  const code = asset.trim().toLowerCase();
  const all = [...view.report.positions, ...view.report.stablecoins, ...view.report.closed];
  return all.find((p) => p.asset === code) ?? null;
}

function positionJson(p: PositionReport): Record<string, unknown> {
  return {
    asset: p.asset,
    qty: toDecimalString(p.qty),
    pruEur: dec(p.pru),
    costBasisEur: toDecimalString(p.costBasis),
    valueEur: dec(p.value),
    unrealizedEur: dec(p.unrealized),
    realizedEur: toDecimalString(p.realized),
    totalEur: dec(p.total),
    roi: dec(p.roi),
    priceEur: p.price ? p.price.priceEur : null,
    priceAt: p.price ? p.price.at : null,
    capitalRecovered: p.capitalRecovered,
    closed: p.closed,
  };
}

/** Barème de frais nommé, ou aucun. Un nom inconnu est une erreur d'appel, pas un défaut silencieux. */
function feeOf(name: unknown): FeeRate | null {
  if (name === undefined || name === null || name === 'none') return ZERO_FEE;
  if (typeof name !== 'string') return null;
  return name in COINHOUSE_FEES ? COINHOUSE_FEES[name as keyof typeof COINHOUSE_FEES] : null;
}

const decimalArg = (value: unknown): Big | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return D(String(value));
  if (typeof value !== 'string') return null;
  try {
    return D(value.trim().replace(',', '.'));
  } catch {
    return null;
  }
};

/** Erreur d'exécution d'outil : renvoyée au client avec `isError`, jamais levée en erreur JSON-RPC. */
export class ToolError extends Error {}

const NO_ARGS: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
const ASSET_ARG: JsonSchema = {
  type: 'object',
  properties: { asset: { type: 'string', description: 'Code de l’actif, par exemple « btc ».' } },
  required: ['asset'],
  additionalProperties: false,
};

export const TOOLS: readonly Tool[] = [
  {
    name: 'get_portfolio',
    title: 'Portefeuille',
    description:
      'Synthèse du portefeuille d’investissement : valeur, investi, plus-values réalisées et ' +
      'latentes, ROI, et une ligne par position. Montants en euros.',
    inputSchema: NO_ARGS,
    annotations: READ_ONLY,
    run: (view) => {
      const t = view.report.totals;
      return {
        ...provenance(view),
        totals: {
          valueEur: dec(t.value),
          costBasisEur: toDecimalString(t.costBasis),
          investedTotalEur: toDecimalString(t.investedTotal),
          netInvestedEur: toDecimalString(t.netInvested),
          realizedEur: toDecimalString(t.realized),
          unrealizedEur: toDecimalString(t.unrealized),
          totalEur: toDecimalString(t.total),
          roi: dec(t.roi),
          feesEur: toDecimalString(t.feesEur),
          unpricedAssets: t.unpricedAssets,
        },
        positions: view.report.positions.map(positionJson),
        stablecoins: view.report.stablecoins.map(positionJson),
        unqualifiedCount: view.report.unqualified.length,
      };
    },
  },
  {
    name: 'get_position',
    title: 'Position d’un actif',
    description:
      'Détail d’une position : quantité, prix de revient unitaire (PRU), valeur, plus-value ' +
      'latente et réalisée. Cherche aussi parmi les positions clôturées.',
    inputSchema: ASSET_ARG,
    annotations: READ_ONLY,
    run: (view, args) => {
      const asset = String(args['asset'] ?? '');
      const position = positionOf(view, asset);
      if (!position) throw new ToolError(`Aucune position connue pour « ${asset} ».`);
      return { ...provenance(view), position: positionJson(position) };
    },
  },
  {
    name: 'get_insights',
    title: 'Constats',
    description:
      'Observations chiffrées tirées des données : frais, concentration, rendement, résultat ' +
      'encaissé, lignes à qualifier… Chaque constat est un FAIT, jamais une recommandation ' +
      'd’acheter ou de vendre.',
    inputSchema: NO_ARGS,
    annotations: READ_ONLY,
    run: (view) => ({
      ...provenance(view),
      insights: renderInsights(view.insights, { discreet: false, currency: 'EUR' }).map((i) => ({
        code: i.code,
        tone: i.tone,
        title: i.title,
        detail: i.detail,
      })),
      disclaimer:
        'Ces observations décrivent le portefeuille. Elles ne constituent ni un conseil en ' +
        'investissement, ni un conseil fiscal.',
    }),
  },
  {
    name: 'get_subscription',
    title: 'Abonnement Coinhouse',
    description:
      'Offre Coinhouse déduite de l’export (Classique, Investisseur, Gestion Privée), remises ' +
      'obtenues, abonnements payés et rentabilité réalisée sur 12 mois glissants.',
    inputSchema: NO_ARGS,
    annotations: READ_ONLY,
    run: (view) => {
      const s = view.subscription;
      return {
        ...provenance(view),
        detectedTier: s.detectedTier,
        detectionNote: s.detectionNote,
        tradeCount: s.tradeCount,
        rebates12mEur: s.rebates12m,
        subscriptions12mEur: s.subscriptions12m,
        feesNet12mEur: s.feesNet12m,
        netOfSubscription12mEur: s.netOfSubscription12m,
        savedVsClassiqueEur: s.savedVsClassique,
        volume12mEur: s.volume12m,
        windowStart: s.windowStart,
        // Clé distincte de `note` : celle-ci vient de `provenance` et ne doit jamais être écrasée.
        estimateNote:
          'Le contrefactuel « grille Classique » est une estimation (achat supposé par virement).',
      };
    },
  },
  {
    name: 'list_alerts',
    title: 'Alertes de prix',
    description:
      'Règles d’alerte définies dans l’app, avec leur seuil en euros calculé au PRU du moment, ' +
      'leur état d’armement et leur éventuelle date d’expiration.',
    inputSchema: NO_ARGS,
    annotations: READ_ONLY,
    run: (view) => {
      const rules = Object.values(view.state.alerts.rules);
      return {
        ...provenance(view),
        alerts: rules.map((rule) => {
          const position = positionOf(view, rule.asset);
          const threshold =
            position === null
              ? null
              : alertThresholdEur(
                  rule,
                  { pruEur: dec(position.pru), qty: toDecimalString(position.qty) },
                  null,
                );
          const state = view.state.alerts.states[rule.id];
          return {
            id: rule.id,
            asset: rule.asset,
            direction: rule.direction,
            kind: rule.threshold.kind,
            thresholdEur: threshold === null ? null : toDecimalString(threshold),
            enabled: rule.enabled,
            armed: state?.armed ?? null,
            triggerCount: state?.triggerCount ?? 0,
            expiresAt: rule.expiresAt ?? null,
            gate: rule.gate ?? null,
            note: rule.note,
          };
        }),
      };
    },
  },
  {
    name: 'simulate_sell',
    title: 'Simuler une vente',
    description:
      'Ce que donnerait la vente d’une quantité à un prix donné : produit net de frais, résultat ' +
      'réalisé, position et PRU restants. Ne passe aucun ordre — c’est un calcul.',
    inputSchema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'Code de l’actif, par exemple « btc ».' },
        qty: { type: 'string', description: 'Quantité à vendre (chaîne décimale).' },
        priceEur: { type: 'string', description: 'Prix de vente unitaire en euros.' },
        fee: {
          type: 'string',
          enum: ['sell-eur', 'crypto-crypto', 'none'],
          description: 'Barème de frais ; « none » pour ignorer les frais.',
        },
      },
      required: ['asset', 'qty', 'priceEur'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    run: (view, args) => {
      const asset = String(args['asset'] ?? '');
      const position = positionOf(view, asset);
      if (!position) throw new ToolError(`Aucune position connue pour « ${asset} ».`);
      const qty = decimalArg(args['qty']);
      const price = decimalArg(args['priceEur']);
      const fee = feeOf(args['fee'] ?? 'sell-eur');
      if (qty === null || price === null) throw new ToolError('Quantité ou prix illisible.');
      if (fee === null) throw new ToolError('Barème de frais inconnu.');
      const result = simulateSell(
        { qty: position.qty, costBasis: position.costBasis },
        qty,
        price,
        fee,
      );
      if (!result)
        throw new ToolError(
          `Quantité hors de la position (détenu : ${toDecimalString(position.qty)}).`,
        );
      return {
        ...provenance(view),
        asset: position.asset,
        grossEur: toDecimalString(result.grossEur),
        feesEur: toDecimalString(result.feesEur),
        netProceedsEur: toDecimalString(result.netProceedsEur),
        realizedEur: toDecimalString(result.realizedEur),
        qtyAfter: toDecimalString(result.qtyAfter),
        pruAfterEur: dec(result.pruAfter),
        taxNote:
          'La plus-value IMPOSABLE en France suit la méthode globale de l’article 150 VH bis et ' +
          'diffère de ce résultat réalisé. Voir l’app pour l’estimation fiscale.',
      };
    },
  },
  {
    name: 'simulate_buy',
    title: 'Simuler un achat',
    description:
      'Ce que donnerait un achat d’un montant donné à un prix donné : quantité acquise, frais, ' +
      'nouveau PRU. Ne passe aucun ordre — c’est un calcul.',
    inputSchema: {
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'Code de l’actif, par exemple « btc ».' },
        spendEur: { type: 'string', description: 'Montant à investir, frais compris.' },
        priceEur: { type: 'string', description: 'Prix d’achat unitaire en euros.' },
        fee: {
          type: 'string',
          enum: ['buy-sepa', 'buy-card', 'crypto-crypto', 'none'],
          description: 'Barème de frais ; « none » pour ignorer les frais.',
        },
      },
      required: ['asset', 'spendEur', 'priceEur'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    run: (view, args) => {
      const asset = String(args['asset'] ?? '');
      const position = positionOf(view, asset);
      const spend = decimalArg(args['spendEur']);
      const price = decimalArg(args['priceEur']);
      const fee = feeOf(args['fee'] ?? 'buy-sepa');
      if (spend === null || price === null) throw new ToolError('Montant ou prix illisible.');
      if (fee === null) throw new ToolError('Barème de frais inconnu.');
      // Un actif encore jamais détenu part d'une position vide : le calcul reste valable.
      const base = position
        ? { qty: position.qty, costBasis: position.costBasis }
        : { qty: D('0'), costBasis: D('0') };
      const result = simulateBuy(base, spend, price, fee);
      if (!result) throw new ToolError('Montant ou prix hors bornes.');
      return {
        ...provenance(view),
        asset: asset.trim().toLowerCase(),
        feesEur: toDecimalString(result.feesEur),
        qtyBought: toDecimalString(result.qtyBought),
        qtyAfter: toDecimalString(result.qtyAfter),
        pruBeforeEur: position ? dec(position.pru) : null,
        pruAfterEur: dec(result.pruAfter),
      };
    },
  },
];

export const TOOL_DEFINITIONS: ToolDefinition[] = TOOLS.map(
  ({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations,
  }),
);

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}
