<script lang="ts">
  /**
   * Vue d'ensemble : compose les rapports des espaces, ne recalcule rien. On additionne des
   * valeurs (soldes), jamais des résultats de nature différente : la plus-value d'investissement
   * et, demain, le P&L de trading restent côte à côte (proposition v2, § 6.0).
   */
  import { nowIso } from '$lib/clock';
  import { insightsToText, renderInsights } from '$lib/format/insights';
  import { router } from '$lib/router.svelte';
  import { isIOS, isStandalone } from '$lib/support/environment';
  import { runSelfChecks } from '$lib/support/self-check';
  import AppBar from '../components/layout/AppBar.svelte';
  import Info from '../components/shared/Info.svelte';
  import InsightList from '../components/shared/InsightList.svelte';
  import Money from '../components/shared/Money.svelte';
  import Pct from '../components/shared/Pct.svelte';
  import PriceFreshness from '../components/shared/PriceFreshness.svelte';
  import { app } from '../state/app.svelte';
  import { toasts } from '../state/ui.svelte';

  const t = $derived(app.report.totals);
  const openCount = $derived(app.report.positions.length + app.report.stablecoins.length);
  const trading = $derived(app.tradingReport);
  /** Équité de trading dans la devise d'affichage ; `null` tant qu'aucun taux USD n'est connu. */
  const tradingEquity = $derived(app.hasTrading ? app.usdcToDisplay(trading.equity) : null);
  // `totals.net` plutôt que la formule recopiée : une seule définition du réalisé net dans toute
  // l'app (moteur, tableau de bord, calendrier, Vue d'ensemble), donc rien qui puisse diverger.
  const tradingNet = $derived(app.hasTrading ? app.usdcToDisplay(trading.totals.net) : null);
  /** Valeur nette = valeur des positions + équité de trading (des soldes, jamais des P&L). */
  const netWorth = $derived(
    tradingEquity === null ? t.value : (t.value?.plus(tradingEquity) ?? tradingEquity),
  );
  /** Répartition du capital (%) entre les deux espaces ; `null` si un des deux est inconnu. */
  const split = $derived.by((): { invest: number; trading: number } | null => {
    if (!app.hasTrading || tradingEquity === null || t.value === null) return null;
    const total = t.value.plus(tradingEquity);
    if (!total.gt('0')) return null;
    const invest = Number(t.value.div(total).times('100').toFixed(1));
    return { invest, trading: Math.round((100 - invest) * 10) / 10 };
  });
  /** Flux vers/depuis le trading (dépôts et retraits USDC des comptes Hyperliquid, tout l'historique). */
  const flows = $derived.by(() => {
    if (!app.hasTrading) return null;
    const deposits = app.usdcToDisplay(trading.totals.deposits);
    const withdrawals = app.usdcToDisplay(trading.totals.withdrawals);
    return deposits === null || withdrawals === null ? null : { deposits, withdrawals };
  });
  /** Constats mis en avant sur l'accueil ; la liste complète vit dans le rapport. */
  const INSIGHTS_ON_OVERVIEW = 6;
  const insights = $derived(
    renderInsights(app.insights, {
      discreet: app.state.ui.discreet,
      currency: app.currency,
    }),
  );

  async function copyInsights(): Promise<void> {
    try {
      await navigator.clipboard.writeText(insightsToText(insights));
      toasts.push('Constats copiés : collez-les où vous voulez.', 'success');
    } catch {
      toasts.push('Copie impossible dans ce navigateur.', 'error');
    }
  }

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
      platform: { ios: isIOS(), standalone: isStandalone() },
      trading: app.tradingChecks,
      transfers: {
        pairs: app.transferPairing.pairs.length,
        unpairedWithdrawals: app.transferPairing.unpairedWithdrawals.length,
        unpairedDeposits: app.transferPairing.unpairedDeposits.length,
      },
      now: nowIso(),
    }).filter((c) => c.level === 'warn' || c.level === 'fail'),
  );
</script>

<AppBar title="Vue d'ensemble" />

<section class="card hero">
  <div class="tools">
    <p class="label">Synthèse</p>
    <div class="actions">
      <button
        class="tool"
        type="button"
        onclick={() => void app.refreshPrices(true)}
        disabled={app.priceStatus.loading || app.state.ui.priceSource === 'off'}
      >
        Actualiser
      </button>
    </div>
  </div>
  <PriceFreshness />
  <div class="trio">
    <div>
      <p class="label">
        <span>Valeur nette</span>
        <Info title="Valeur nette"
          >Valeur des positions d'investissement (dernier prix connu) + équité de trading (compte
          perps, USDC au taux BCE du jour). On additionne des soldes — jamais des résultats de
          nature différente.</Info
        >
      </p>
      <p class="big"><Money value={netWorth} compact strong /></p>
    </div>
    <div>
      <p class="label">Investissement</p>
      <p class="big"><Money value={t.value} compact /></p>
      <p class="muted small">
        Latent <Money value={t.unrealized} sign colored compact /> · réalisé
        <Money value={t.realized} sign colored compact />
      </p>
    </div>
    <div>
      <p class="label">Trading</p>
      {#if app.hasTrading}
        <p class="big"><Money value={tradingEquity} compact /></p>
        <p class="muted small">
          P&L net <Money value={tradingNet} sign colored compact /> · latent
          <Money value={app.usdcToDisplay(trading.unrealized)} sign colored compact />
        </p>
      {:else}
        <p class="big muted">—</p>
        <p class="muted small">Aucun compte de trading connecté.</p>
      {/if}
    </div>
  </div>
  {#if app.hasTrading && tradingEquity === null}
    <p class="muted small">
      Taux de change en cours de chargement : équité de trading non comptée.
    </p>
  {/if}
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
    aria-label={app.hasTrading ? "Ouvrir l'espace Trading" : "Découvrir l'espace Trading"}
  >
    <h2>Trading</h2>
    {#if app.hasTrading}
      <p class="muted small">
        {app.hlAccounts.length} compte{app.hlAccounts.length > 1 ? 's' : ''} · {trading.totals
          .fills} fills
      </p>
      <dl>
        <div>
          <dt>Équité</dt>
          <dd><Money value={tradingEquity} compact /></dd>
        </div>
        <div>
          <dt>Latent</dt>
          <dd><Money value={app.usdcToDisplay(trading.unrealized)} sign colored compact /></dd>
        </div>
        <div>
          <dt>P&L net</dt>
          <dd><Money value={tradingNet} sign colored compact /></dd>
        </div>
      </dl>
      <span class="go">Ouvrir l'espace Trading →</span>
    {:else}
      <p class="muted small">Trades, P&L net, journal, statistiques</p>
      <p class="soon">
        À venir : import Hyperliquid en lecture seule (adresse publique), saisie manuelle d'un
        trade, espérance en R, taux de réussite, drawdown.
      </p>
      <span class="go">Découvrir l'espace Trading →</span>
    {/if}
  </a>
</div>

{#if insights.length > 0}
  <section class="card insights" aria-labelledby="insights-title">
    <div class="tools">
      <h2 id="insights-title">Constats</h2>
      <button class="tool" type="button" onclick={copyInsights}>Copier</button>
    </div>
    <InsightList insights={insights.slice(0, INSIGHTS_ON_OVERVIEW)} />
    <p class="muted small">
      Des observations chiffrées tirées de vos données — jamais un conseil d'achat ou de vente.
      {#if insights.length > INSIGHTS_ON_OVERVIEW}
        <a href={router.href({ name: 'report' })}>Voir les {insights.length} constats</a>
      {:else}
        <a href={router.href({ name: 'report' })}>Le détail est dans le rapport</a>
      {/if}
    </p>
  </section>
{/if}

{#if split || flows}
  <section class="card capital">
    <h2>Capital</h2>
    {#if split}
      <div
        class="bar"
        role="img"
        aria-label="Répartition du capital : investissement {split.invest} %, trading {split.trading} %"
      >
        <span class="invest" style="width: {split.invest}%"></span>
        <span class="trading" style="width: {split.trading}%"></span>
      </div>
      <p class="muted small legend">
        <span
          ><span class="swatch invest" aria-hidden="true"></span>Investissement {split.invest.toLocaleString(
            'fr-FR',
          )} %</span
        >
        <span
          ><span class="swatch trading" aria-hidden="true"></span>Trading {split.trading.toLocaleString(
            'fr-FR',
          )} %</span
        >
      </p>
    {/if}
    {#if flows}
      <p class="muted small">
        Capital envoyé au trading (dépôts) : <Money value={flows.deposits} compact /> · rapatrié (retraits)
        : <Money value={flows.withdrawals} compact />.
      </p>
    {/if}
  </section>
{/if}

{#if app.unreadAlertCount > 0}
  <section class="card price-alerts">
    <h2>Alertes de prix</h2>
    <p class="small">
      {app.unreadAlertCount} déclenchement{app.unreadAlertCount > 1 ? 's' : ''} depuis votre dernière
      visite.
      <a href={router.href({ name: 'alerts' })}>Ouvrir le centre d’alertes</a>
    </p>
  </section>
{/if}

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
  <a href={router.href({ name: 'alerts' })}>Alertes de prix</a> ·
  <a href={router.href({ name: 'import' })}>Importer un export</a> ·
  <a href={router.href({ name: 'add' })}>Ajouter une opération</a>
</p>

<style>
  .hero {
    display: grid;
    gap: var(--space-3);
  }
  .trio {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .trio > div {
    display: grid;
    gap: var(--space-1);
    align-content: start;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  @media (max-width: 480px) {
    .trio {
      grid-template-columns: 1fr;
    }
  }
  .label {
    font-size: var(--fs-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
  }
  .big {
    font-size: var(--fs-xl);
    font-weight: 700;
    line-height: 1.1;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
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
  .capital {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .insights {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .insights h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .insights .small {
    font-size: var(--fs-sm);
  }
  .capital h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .bar {
    display: flex;
    height: 12px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-sunken);
  }
  .bar .invest {
    background: var(--accent-invest);
  }
  .bar .trading {
    background: var(--accent-trading);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin: 0;
  }
  .legend > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    display: inline-block;
  }
  .swatch.invest {
    background: var(--accent-invest);
  }
  .swatch.trading {
    background: var(--accent-trading);
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
  .price-alerts {
    border-left: 4px solid var(--accent-invest);
    margin-bottom: var(--space-3);
  }
  .price-alerts .small {
    font-size: var(--fs-sm);
  }
  .links {
    text-align: center;
    color: var(--fg-muted);
  }
</style>
