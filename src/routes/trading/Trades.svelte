<script lang="ts">
  /**
   * Liste des trades (aller-retours reconstruits + trades manuels), du plus récent au plus
   * ancien : sens, taille, entrée → sortie, P&L net (coloré), R quand le plan le permet, badges
   * (ouvert, liquidation, incomplet, setup). La saisie ne vit jamais ici (P21).
   */
  import { ZERO, type Big } from '$lib/domain/money';
  import type { JournaledTrip } from '$lib/domain/trading/journal';
  import { downloadText } from '$lib/export/download';
  import { tradesToCsv } from '$lib/export/trades-csv';
  import { fmtDate, fmtPct, fmtPrice, fmtQty } from '$lib/format/fr';
  import { router } from '$lib/router.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import Money from '../../components/shared/Money.svelte';
  import TradingTabs from '../../components/trading/TradingTabs.svelte';
  import { app } from '../../state/app.svelte';

  const trips = $derived(app.roundTrips);
  const closed = $derived(trips.filter((t) => t.trip.status === 'closed').length);
  const money = (t: JournaledTrip, value: Big): Big | null =>
    app.quoteToDisplay(t.trip.quote, value);
  const label = (id: string): string => app.accountLabels[id] ?? id;
  const rText = (r: Big): string => `${r.gte(ZERO) ? '+' : ''}${r.toFixed(2).replace('.', ',')} R`;

  function exportCsv(): void {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(
      `${app.state.ui.demoMode ? 'demo-' : ''}trades-${stamp}.csv`,
      tradesToCsv(trips, app.accountLabels),
      'text/csv',
    );
  }
</script>

<AppBar title="Trades" back={{ name: 'trading' }} />
<TradingTabs active="trades" />

<div class="head">
  <p class="muted small count">
    {trips.length} trade{trips.length > 1 ? 's' : ''} · {closed} clos
  </p>
  <div class="actions">
    {#if trips.length > 0}
      <button class="secondary" type="button" onclick={exportCsv}>Exporter (CSV)</button>
    {/if}
    <a class="primary" href={router.href({ name: 'tradeAdd' })}>Ajouter un trade</a>
  </div>
</div>

{#if trips.length === 0}
  <section class="card">
    <p class="muted">
      Aucun trade pour l'instant : synchronisez un compte Hyperliquid (les aller-retours se
      reconstruisent tout seuls) ou saisissez un trade d'une autre plateforme.
    </p>
  </section>
{:else}
  <ul class="trades" aria-label="Trades">
    {#each trips as t (t.trip.id)}
      <li>
        <a class="card row" href={router.href({ name: 'trade', id: t.trip.id })}>
          <div class="main">
            <p class="title">
              <span class="dir {t.trip.direction}"
                >{t.trip.direction === 'long' ? 'Long' : 'Short'}</span
              >
              <strong>{t.trip.symbol}</strong>
              <span class="muted small">× {fmtQty(t.trip.qtyMax, { abbreviate: true })}</span>
              {#if t.trip.status === 'open'}<span class="badge open">ouvert</span>{/if}
              {#if t.trip.liquidated}<span class="badge liq">liquidation</span>{/if}
              {#if t.trip.incomplete}<span class="badge">historique partiel</span>{/if}
              {#if t.journal?.setup}<span class="badge setup">{t.journal.setup}</span>{/if}
            </p>
            <p class="muted small">
              {fmtDate(t.trip.openedAt)}{t.trip.closedAt ? ` → ${fmtDate(t.trip.closedAt)}` : ''}
              · {t.trip.avgEntry ? fmtPrice(t.trip.avgEntry, 'USD') : '?'}
              {#if t.trip.avgExit}→ {fmtPrice(t.trip.avgExit, 'USD')}{/if}
              {#if app.hlAccounts.length > 0}· {label(t.trip.accountId)}{/if}
            </p>
            {#if t.journal?.thesis}
              <p class="muted small thesis">{t.journal.thesis}</p>
            {/if}
          </div>
          <div class="side">
            {#if t.trip.status === 'closed'}
              <Money value={money(t, t.trip.netPnl)} sign colored strong />
              {#if t.r}
                <span class="muted small num">{rText(t.r)}</span>
              {:else if t.entrySlippage}
                <span class="muted small"
                  >écart entrée {fmtPct(t.entrySlippage, { sign: true })}</span
                >
              {/if}
            {:else}
              <span class="muted small">en cours</span>
            {/if}
          </div>
        </a>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .count {
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .primary {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 700;
    text-decoration: none;
  }
  .secondary {
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-weight: 600;
  }
  .trades {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    color: inherit;
    text-decoration: none;
  }
  .row:hover {
    border-color: var(--accent);
  }
  .main {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .main p {
    margin: 0;
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .dir {
    font-size: var(--fs-xs);
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--gain);
    color: var(--accent-fg);
  }
  .dir.short {
    background: var(--loss);
  }
  .badge {
    font-size: var(--fs-xs);
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--fg-muted);
  }
  .badge.open {
    border-color: var(--info);
    color: var(--info);
  }
  .badge.liq {
    border-color: var(--warn);
    color: var(--warn);
  }
  .badge.setup {
    border-color: var(--accent-trading);
    color: var(--accent-trading);
  }
  .thesis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 48ch;
  }
  .side {
    display: grid;
    gap: 2px;
    justify-items: end;
    text-align: right;
    flex-shrink: 0;
  }
</style>
