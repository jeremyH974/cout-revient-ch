/**
 * La liste des comptes, calculée depuis l'état stocké (décision n° 94).
 *
 * Un compte n'est pas toujours déclaré : trois d'entre eux **existent parce que des données
 * existent**. Un import Coinhouse fait apparaître « Coinhouse », une saisie hors Coinhouse fait
 * apparaître « Saisies manuelles », un trade saisi à la main fait apparaître « Trades manuels ».
 * C'est cette règle-là qui vaut d'être extraite : elle décide de ce que l'utilisateur voit dans
 * chaque sélecteur de compte, et elle vivait dans un `$derived` qu'aucun test n'atteignait.
 */
import { manualAccountId } from '../import/manual';
import {
  COINHOUSE_ACCOUNT_ID,
  MANUAL_ACCOUNT_ID,
  MANUAL_TRADING_ACCOUNT_ID,
  type Account,
  type AccountId,
  type ManualEvent,
} from '../domain/types';
import type { ManualTrade } from '../domain/trading/journal';

export interface AccountSources {
  /** Clés des lignes brutes Coinhouse : leur seule présence fait exister le compte Coinhouse. */
  rawRowKeys: readonly string[];
  manualEvents: readonly ManualEvent[];
  manualTrades: readonly ManualTrade[];
  /** Comptes explicitement déclarés par l'utilisateur. */
  declared: readonly Account[];
}

/** Un compte implicite n'a pas de date de création : il n'a jamais été créé, il est déduit. */
const implicit = (
  id: AccountId,
  kind: Account['kind'],
  label: string,
  space: Account['space'],
): Account => ({ id, kind, label, space, createdAt: '' });

/**
 * Les comptes visibles, implicites d'abord puis déclarés par ancienneté.
 *
 * L'ordre n'est pas cosmétique : c'est celui des sélecteurs, et le premier élément sert de choix
 * par défaut à plusieurs écrans.
 */
export function allAccounts(sources: AccountSources): Account[] {
  const list: Account[] = [];
  if (sources.rawRowKeys.length > 0)
    list.push(implicit(COINHOUSE_ACCOUNT_ID, 'coinhouse', 'Coinhouse', 'invest'));
  if (sources.manualEvents.some((m) => manualAccountId(m) === MANUAL_ACCOUNT_ID))
    list.push(
      implicit(MANUAL_ACCOUNT_ID, 'manual', 'Saisies manuelles (hors Coinhouse)', 'invest'),
    );
  if (sources.manualTrades.some((t) => t.accountId === MANUAL_TRADING_ACCOUNT_ID))
    list.push(implicit(MANUAL_TRADING_ACCOUNT_ID, 'manual', 'Trades manuels', 'trading'));
  const declared = [...sources.declared].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...list, ...declared];
}

/**
 * Les comptes de l'espace Investissement — **et les comptes de trading routés vers lui**.
 *
 * `spotAsInvestment` fait entrer le spot d'un compte Hyperliquid dans l'Investissement sans
 * déplacer le compte lui-même : filtrer sur le seul `space` en oublierait la moitié.
 */
export const investAccounts = (accounts: readonly Account[]): Account[] =>
  accounts.filter((a) => a.space === 'invest' || a.spotAsInvestment === true);

export const accountLabels = (accounts: readonly Account[]): Record<AccountId, string> =>
  Object.fromEntries(accounts.map((a) => [a.id, a.label]));
