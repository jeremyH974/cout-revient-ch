/**
 * Chargement de l'état pour le serveur MCP local (décision n° 47).
 *
 * Le serveur ne parle à rien : il LIT un fichier de sauvegarde JSON produit par l'app (export
 * manuel ou sauvegarde automatique dans un dossier) et rejoue le MÊME pipeline que l'écran —
 * assemblage du grand livre, appariement des virements, moteur de PRU. Mêmes fonctions, donc
 * mêmes chiffres : il n'existe pas de « calcul du MCP » qui pourrait diverger de l'app.
 *
 * Deux conséquences assumées, répétées dans chaque réponse d'outil :
 * - les chiffres valent **à la date de la sauvegarde**, pas à l'instant présent ;
 * - les prix sont ceux du **cache de la sauvegarde** — le serveur ne va jamais chercher de cours.
 */
import { readFile } from 'node:fs/promises';
import { computePortfolio, type PortfolioReport } from '../src/lib/domain/engine';
import { buildInsights, type Insight } from '../src/lib/domain/insights';
import { pairTransfers } from '../src/lib/domain/transfers';
import { analyzeSubscription, type SubscriptionAnalysis } from '../src/lib/domain/subscription';
import type { AccountId, LedgerEvent } from '../src/lib/domain/types';
import { rateLookup } from '../src/lib/fx';
import { balanceRecords } from '../src/lib/import/coinhouse/balances';
import { normalizeCoinhouseRows } from '../src/lib/import/coinhouse/normalize';
import { normalizeHlAccount } from '../src/lib/import/hyperliquid/normalize';
import { manualToLedgerEvent } from '../src/lib/import/manual';
import { pivotLedgerEvents } from '../src/lib/import/pivot/events';
import { parseBackup } from '../src/lib/storage/json-io';
import type { StoredStateV1 } from '../src/lib/storage/schema';

export interface McpView {
  /** Date d'export de la sauvegarde lue ; `null` si le fichier ne la porte pas. */
  exportedAt: string | null;
  path: string;
  state: StoredStateV1;
  events: LedgerEvent[];
  /** Rapport du moteur, EN EUROS (la devise d'affichage de l'app ne concerne que l'écran). */
  report: PortfolioReport;
  insights: Insight[];
  subscription: SubscriptionAnalysis;
  /** Date de la cotation la plus ancienne retenue ; `null` si aucun prix en cache. */
  pricedAt: string | null;
}

/** Assemble le grand livre exactement comme l'app : mêmes sources, même ordre, mêmes options. */
function assembleEvents(state: StoredStateV1): LedgerEvent[] {
  const { events } = normalizeCoinhouseRows(Object.values(state.rawRows), state.qualifications);
  for (const manual of Object.values(state.manualEvents)) events.push(manualToLedgerEvent(manual));

  const usd = rateLookup(state.fx.rates.USD ?? {});
  // Comptes Hyperliquid dont le spot est routé vers l'Investissement : mêmes événements que l'app.
  const hlAccounts = Object.values(state.accounts)
    .filter((a) => a.kind === 'hyperliquid')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const account of hlAccounts) {
    const data = state.hyperliquid.accounts[account.id as AccountId];
    if (!data) continue;
    const normalized = normalizeHlAccount(data, {
      accountId: account.id,
      spotPairs: state.hyperliquid.spotPairs,
      spotAsInvestment: account.spotAsInvestment === true,
      eurUsdRate: (day) => usd.rate(day),
    });
    events.push(...normalized.investEvents);
  }

  const pivotRows = Object.values(state.pivotRows);
  if (pivotRows.length > 0)
    events.push(
      ...pivotLedgerEvents(pivotRows, state.qualifications, (day) => usd.rate(day)).events,
    );
  return events;
}

/** Construit la vue complète à partir d'un état déjà validé. Pur : aucun accès disque ni réseau. */
export function buildView(state: StoredStateV1, path: string, exportedAt: string | null): McpView {
  const events = pairTransfers(assembleEvents(state), state.transferOverrides).events;
  const report = computePortfolio({
    events,
    prices: state.priceCache,
    settings: state.engineSettings,
    balances: balanceRecords(Object.values(state.rawRows)),
  });
  const subscription = analyzeSubscription(events);
  return {
    exportedAt,
    path,
    state,
    events,
    report,
    subscription,
    // Sans historique de prix (le serveur ne charge rien), ni repère ni mesure de risque : les
    // règles correspondantes se taisent d'elles-mêmes plutôt que de rendre un chiffre partiel.
    insights: buildInsights({ report, subscription }),
    pricedAt: report.pricedAt,
  };
}

export class BackupError extends Error {}

/** Lit et valide le fichier de sauvegarde. Toute erreur est explicite : le chemin est humain. */
export async function loadView(path: string): Promise<McpView> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BackupError(`Sauvegarde illisible (${path}) : ${reason}`);
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) throw new BackupError(`Sauvegarde invalide (${path}) : ${parsed.error}`);
  return buildView(parsed.state, path, parsed.exportedAt);
}
