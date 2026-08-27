/**
 * Auto-vérifications de l'application, assemblées **en un seul endroit**.
 *
 * Elles étaient montées deux fois — une fois dans les réglages, une fois sur le tableau de bord —
 * avec des entrées qui avaient déjà commencé à diverger. Deux listes de contrôles qui ne
 * contrôlent pas la même chose, c'est un contrôle de moins, et personne ne s'en aperçoit : le seul
 * écran où le voyant manquant se serait vu est justement celui qui ne le calculait pas.
 */
import { nowIso } from '$lib/clock';
import { reconcileNetWorth, latestNetWorth } from '$lib/history/net-worth';
import { isIOS, isStandalone } from '$lib/support/environment';
import { runSelfChecks, type SelfCheck } from '$lib/support/self-check';
import { app } from './app.svelte';
import { history } from './history.svelte';

class ChecksState {
  /** Réconciliation du dernier jour connu : `null` tant que l'historique n'est pas chargé. */
  reconciliation = $derived(reconcileNetWorth(latestNetWorth(history.netWorth)));

  all = $derived.by((): SelfCheck[] =>
    runSelfChecks({
      report: app.hasData ? app.report : null,
      quotes: app.quotes,
      prices: {
        source: app.state.ui.priceSource,
        online: app.priceStatus.online,
        lastRefreshAt: app.priceStatus.lastRefreshAt,
      },
      storage: {
        lastBackupAt: app.state.ui.lastBackupAt,
        persisted: null,
        saveError: app.saveError,
      },
      platform: { ios: isIOS(), standalone: isStandalone() },
      trading: app.tradingChecks,
      transfers: {
        pairs: app.transferPairing.pairs.length,
        unpairedWithdrawals: app.transferPairing.unpairedWithdrawals.length,
        unpairedDeposits: app.transferPairing.unpairedDeposits.length,
      },
      reconciliation: this.reconciliation,
      now: nowIso(),
    }),
  );

  /** Celles qui demandent quelque chose : le reste n'a pas sa place sur un tableau de bord. */
  actionable = $derived(this.all.filter((c) => c.level === 'warn' || c.level === 'fail'));

  /**
   * Un échec invalide les chiffres : il doit remonter AVANT eux. Un simple avertissement reste en
   * bas de l'écran — sinon plus rien n'est prioritaire.
   */
  blocking = $derived(this.all.some((c) => c.level === 'fail'));
}

export const checks = new ChecksState();
