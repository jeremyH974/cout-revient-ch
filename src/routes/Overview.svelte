<script lang="ts">
  /**
   * Vue d'ensemble : compose les rapports des espaces, ne recalcule rien. On additionne des
   * valeurs (soldes), jamais des résultats de nature différente : la plus-value d'investissement
   * et, demain, le P&L de trading restent côte à côte (proposition v2, § 6.0).
   */
  import { nowIso } from '$lib/clock';
  import { router } from '$lib/router.svelte';
  import { runSelfChecks } from '$lib/support/self-check';
  import AppBar from '../components/layout/AppBar.svelte';
  import Money from '../components/shared/Money.svelte';
  import Pct from '../components/shared/Pct.svelte';
  import PriceFreshness from '../components/shared/PriceFreshness.svelte';
  import { app } from '../state/app.svelte';

  const t = $derived(app.report.totals);
  const openCount = $derived(app.report.positions.length + app.report.stablecoins.length);
  const alerts = $derived(
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
      now: nowIso(),
    }).filter((c) => c.level === 'warn' || c.level === 'fail'),
  );
</script>

<AppBar title="Vue d'ensemble" />

<section class="card hero">
  <p class="label">Valeur nette</p>
  <p class="big"><Money value={t.value} compact strong /></p>
  <p class="muted small">
    Valeur de vos positions d'investissement au dernier prix connu. L'équité de trading s'y ajoutera
    quand l'espace Trading sera alimenté.
  </p>
  <div class="tools">
    <button
      class="tool"
      type="button"
      onclick={() => void app.refreshPrices(true)}
      disabled={app.priceStatus.loading || app.state.ui.priceSource === 'off'}
    >
      Actualiser
    </button>
    <PriceFreshness />
  </div>
</section>

<div class="spaces">
  <a
    class="card space invest"
    href={router.href({ name: 'portfolio' })}
    aria-label="Ouvrir l'espace Investissement"
  >
    <h2>Investissement</h2>
    <p class="muted small">
      {openCount} position{openCount > 1 ? 's' : ''} · PRU, plus-values, lots
    </p>
    <dl>
      <div>
        <dt>Valeur</dt>
        <dd><Money value={t.value} compact /></dd>
      </div>
      <div>
        <dt>Latent</dt>
        <dd><Money value={t.unrealized} sign colored compact /></dd>
      </div>
      <div>
        <dt>Réalisé</dt>
        <dd><Money value={t.realized} sign colored compact /></dd>
      </div>
      <div>
        <dt>ROI</dt>
        <dd><Pct value={t.roi} /></dd>
      </div>
    </dl>
    <span class="go">Ouvrir l'espace Investissement →</span>
  </a>
  <a
    class="card space trading"
    href={router.href({ name: 'trading' })}
    aria-label="Découvrir l'espace Trading"
  >
    <h2>Trading</h2>
    <p class="muted small">Trades, P&L net, journal, statistiques</p>
    <p class="soon">
      À venir : import Hyperliquid en lecture seule (adresse publique), saisie manuelle d'un trade,
      espérance en R, taux de réussite, drawdown.
    </p>
    <span class="go">Découvrir l'espace Trading →</span>
  </a>
</div>

{#if alerts.length > 0}
  <section class="card">
    <h2>À vérifier</h2>
    <ul class="alerts">
      {#each alerts as check (check.id)}
        <li>
          <strong>{check.label}</strong> — {check.detail}
          {#if check.action}<span class="muted">{check.action}</span>{/if}
        </li>
      {/each}
    </ul>
    <p class="small">
      <a href={router.href({ name: 'settings' })}>Toutes les auto-vérifications (réglages)</a>
    </p>
  </section>
{/if}

<p class="links small">
  <a href={router.href({ name: 'report' })}>Rapport PDF</a> ·
  <a href={router.href({ name: 'import' })}>Importer un export</a> ·
  <a href={router.href({ name: 'add' })}>Ajouter une opération</a>
</p>

<style>
  .hero {
    display: grid;
    gap: var(--space-2);
  }
  .label {
    font-size: var(--fs-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
  }
  .big {
    font-size: var(--fs-xl);
    font-weight: 700;
    line-height: 1.1;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }
  .tool {
    min-height: 40px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .tool:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .tool:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .spaces {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin: var(--space-3) 0;
  }
  .space {
    display: grid;
    align-content: start;
    gap: var(--space-2);
    color: inherit;
    text-decoration: none;
    border-left: 4px solid var(--accent-invest);
  }
  .space.trading {
    border-left-color: var(--accent-trading);
  }
  .space:hover .go {
    text-decoration: underline;
  }
  .space h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  dl {
    display: grid;
    gap: var(--space-1);
    margin: 0;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--fs-sm);
  }
  dt {
    color: var(--fg-muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .soon {
    font-size: var(--fs-sm);
    margin: 0;
  }
  .go {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--accent);
  }
  .alerts {
    display: grid;
    gap: var(--space-2);
    padding-left: 1.2em;
    font-size: var(--fs-sm);
  }
  .links {
    text-align: center;
    color: var(--fg-muted);
  }
</style>
