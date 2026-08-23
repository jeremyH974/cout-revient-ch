<script lang="ts">
  /**
   * Fills (exécutions brutes) : la matière première des aller-retours, dans son propre onglet
   * pour ne pas noyer le tableau de bord. Filtre par compte, affichage progressif (50 par 50).
   */
  import { D, ZERO, type Big } from '$lib/domain/money';
  import type { Execution } from '$lib/domain/trading/types';
  import { fmtDateTime, fmtPrice, fmtQty } from '$lib/format/fr';
  import AppBar from '../../components/layout/AppBar.svelte';
  import Money from '../../components/shared/Money.svelte';
  import TradingTabs from '../../components/trading/TradingTabs.svelte';
  import { app } from '../../state/app.svelte';

  const PAGE = 50;
  let shown = $state(PAGE);
  let selected = $state<string>('all');
  const accounts = $derived(app.hlAccounts);
  const fills = $derived(
    app.tradingReport.accounts
      .filter((a) => selected === 'all' || a.accountId === selected)
      .flatMap((a) => a.executions)
      .sort((a, b) => b.time - a.time),
  );
  const visible = $derived(fills.slice(0, shown));
  const money = (value: Big): Big | null => app.usdcToDisplay(value);
  const label = (accountId: string): string => app.accountLabels[accountId] ?? accountId;
  const fillLabel = (x: Execution): string => x.direction || (x.side === 'buy' ? 'Achat' : 'Vente');
</script>

<AppBar title="Fills" back={{ name: 'trading' }} />
<TradingTabs active="fills" />

<div class="head">
  <p class="muted small count">
    {fills.length} fill{fills.length > 1 ? 's' : ''} (spot et perps)
  </p>
  {#if accounts.length > 1}
    <select aria-label="Compte" bind:value={selected}>
      <option value="all">Tous les comptes</option>
      {#each accounts as a (a.id)}
        <option value={a.id}>{a.label}</option>
      {/each}
    </select>
  {/if}
</div>

{#if fills.length === 0}
  <section class="card">
    <p class="muted">
      Aucun fill pour l'instant : lancez une synchronisation depuis le tableau de bord.
    </p>
  </section>
{:else}
  <ul class="rows card" aria-label="Fills">
    {#each visible as x (x.id)}
      <li>
        <div class="main">
          <strong>{x.symbol} · {fillLabel(x)}</strong>
          <span class="muted small"
            >{fmtDateTime(x.at)} · {fmtQty(D(x.qty))} @ {fmtPrice(x.price, 'USD')}
            · {x.market === 'perp' ? 'perp' : 'spot'}{#if accounts.length > 1}
              · {label(x.accountId)}{/if}
            {#if x.liquidation}· <span class="warn">liquidation</span>{/if}</span
          >
        </div>
        <div class="side">
          {#if x.market === 'perp' && !D(x.closedPnl).eq(ZERO)}
            <Money value={money(D(x.closedPnl))} sign colored />
          {/if}
          <span class="muted small"
            >frais {#if x.feeNative}{fmtQty(D(x.feeNative.qty))} {x.feeNative.asset}{:else}<Money
                value={money(D(x.fee))}
              />{/if}</span
          >
        </div>
      </li>
    {/each}
  </ul>
  {#if fills.length > shown}
    <button class="secondary" type="button" onclick={() => (shown += PAGE)}>
      Afficher {Math.min(PAGE, fills.length - shown)} de plus ({fills.length - shown} restants)
    </button>
  {/if}
{/if}

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-bottom: var(--space-3);
  }
  .count {
    margin: 0;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding-top: 0;
    padding-bottom: 0;
    display: grid;
  }
  .rows li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--tap);
    padding: var(--space-2) 0;
  }
  .rows li + li {
    border-top: 1px solid var(--border);
  }
  .main {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .side {
    display: grid;
    gap: 2px;
    justify-items: end;
    text-align: right;
    flex-shrink: 0;
  }
  .warn {
    color: var(--warn);
    font-weight: 600;
  }
  .secondary {
    margin-top: var(--space-3);
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-weight: 600;
  }
</style>
