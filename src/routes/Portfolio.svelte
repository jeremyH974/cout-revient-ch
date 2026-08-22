<script lang="ts">
  import type { PositionReport } from '$lib/domain/engine';
  import { ZERO } from '$lib/domain/money';
  import { fmtDate, fmtRelative } from '$lib/format/fr';
  import { assetName } from '$lib/pricing/tickers';
  import { router } from '$lib/router.svelte';
  import { nowMs } from '$lib/clock';
  import AppBar from '../components/layout/AppBar.svelte';
  import AssetRow from '../components/portfolio/AssetRow.svelte';
  import SummaryHeader from '../components/portfolio/SummaryHeader.svelte';
  import Money from '../components/shared/Money.svelte';
  import { app } from '../state/app.svelte';

  type SortKey = 'value' | 'total' | 'unrealizedPct' | 'realized' | 'asset';
  let query = $state('');
  let sort = $state<SortKey>('value');

  const sorters: Record<SortKey, (a: PositionReport, b: PositionReport) => number> = {
    value: (a, b) => (b.value ?? ZERO).cmp(a.value ?? ZERO),
    total: (a, b) => (b.total ?? ZERO).cmp(a.total ?? ZERO),
    unrealizedPct: (a, b) => (b.unrealizedPct ?? ZERO).cmp(a.unrealizedPct ?? ZERO),
    realized: (a, b) => b.realized.cmp(a.realized),
    asset: (a, b) => a.asset.localeCompare(b.asset),
  };
  const matches = (p: PositionReport): boolean => {
    const q = query.trim().toLowerCase();
    return q === '' || p.asset.includes(q) || assetName(p.asset).toLowerCase().includes(q);
  };
  const positions = $derived([...app.report.positions].filter(matches).sort(sorters[sort]));
  const stablecoins = $derived(app.report.stablecoins.filter(matches));
  const closed = $derived(app.report.closed.filter(matches));
  const lastImport = $derived(app.state.imports[app.state.imports.length - 1] ?? null);
</script>

<AppBar />
<SummaryHeader />

<div class="toolbar">
  <input
    type="search"
    placeholder="Rechercher un actif…"
    bind:value={query}
    aria-label="Rechercher un actif"
  />
  <label class="sort">
    <span class="sr-only">Trier par</span>
    <select bind:value={sort}>
      <option value="value">Valeur</option>
      <option value="total">P&L total</option>
      <option value="unrealizedPct">Latent %</option>
      <option value="realized">Réalisé</option>
      <option value="asset">Nom</option>
    </select>
  </label>
</div>

<section class="list" role="table" aria-label="Positions">
  <div class="head" role="row">
    <span>Actif</span><span>Quantité · PRU</span><span>Prix</span><span>Valeur</span><span
      >Latent</span
    ><span>Réalisé</span><span>Total</span>
  </div>
  {#each positions as p (p.asset)}
    <AssetRow position={p} />
  {:else}
    <p class="empty muted">Aucune position ouverte{query ? ' pour cette recherche' : ''}.</p>
  {/each}
</section>

{#if stablecoins.length > 0}
  <section class="list">
    <h2 class="section">
      Stablecoins <span class="muted small">— cash en attente, valorisé au cours de l'euro</span>
    </h2>
    {#each stablecoins as p (p.asset)}
      <AssetRow position={p} />
    {/each}
  </section>
{/if}

{#if app.report.blocked.length > 0}
  <section class="list alert">
    <h2 class="section">Historique d'achat manquant</h2>
    {#each app.report.blocked as p (p.asset)}
      <a class="line" href={router.href({ name: 'asset', asset: p.asset })}
        ><strong>{p.asset.toUpperCase()}</strong> <span class="small">{p.warnings[0]}</span></a
      >
    {/each}
  </section>
{/if}

{#if app.report.unqualified.length > 0}
  <section class="list alert">
    <h2 class="section">À qualifier ({app.report.unqualified.length})</h2>
    {#each app.report.unqualified as e (e.id)}
      <p class="line small">
        {fmtDate(e.at)} · {e.rawType} · {e.legs
          .map((l) => `${l.signedQty} ${l.asset.toUpperCase()}`)
          .join(' / ')} — {e.reason}
      </p>
    {/each}
  </section>
{/if}

{#if closed.length > 0 && !app.state.ui.hideClosed}
  <details class="list">
    <summary class="section"
      >Positions clôturées ({closed.length}) <Money
        value={closed.reduce((acc, p) => acc.plus(p.realized), ZERO)}
        sign
        colored
      /></summary
    >
    {#each closed as p (p.asset)}
      <a class="line" href={router.href({ name: 'asset', asset: p.asset })}>
        <strong>{p.asset.toUpperCase()}</strong>
        <span class="muted small">{assetName(p.asset)}</span>
        <span class="grow"></span>
        <Money value={p.realized} sign colored />
      </a>
    {/each}
  </details>
{/if}

<footer class="foot muted small">
  {#if lastImport}Dernier import : {fmtRelative(lastImport.at, nowMs())} ({lastImport.fileName}) ·
  {/if}
  Sauvegarde : {app.state.ui.lastBackupAt
    ? fmtRelative(app.state.ui.lastBackupAt, nowMs())
    : 'jamais ⚠'} ·
  <a href={router.href({ name: 'import' })}>Ré-importer</a>
</footer>

<style>
  .toolbar {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-2);
  }
  input[type='search'],
  select {
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    padding: 0 var(--space-3);
  }
  input[type='search'] {
    flex: 1;
    min-width: 0;
  }
  .list {
    margin: 0 0 var(--space-3);
  }
  .head {
    display: none;
  }
  .section {
    font-size: var(--fs-sm);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    padding: var(--space-3) var(--space-4) var(--space-1);
    cursor: pointer;
  }
  .small {
    font-size: var(--fs-xs);
    text-transform: none;
    letter-spacing: 0;
  }
  .empty {
    padding: var(--space-5) var(--space-4);
    text-align: center;
  }
  .line {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-2) var(--space-4);
    color: inherit;
    text-decoration: none;
    min-height: var(--tap);
    border-bottom: 1px solid var(--border);
  }
  .grow {
    flex: 1;
  }
  .alert .section {
    color: var(--warn);
  }
  .foot {
    padding: var(--space-4);
    text-align: center;
  }
  @media (min-width: 768px) {
    .head {
      display: grid;
      grid-template-columns: 2fr 1.4fr 1fr 1fr 1.2fr 1fr 1fr;
      padding: var(--space-2) var(--space-4);
      font-size: var(--fs-xs);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--fg-muted);
      border-bottom: 1px solid var(--border);
    }
    .head span:not(:first-child) {
      text-align: right;
    }
  }
</style>
