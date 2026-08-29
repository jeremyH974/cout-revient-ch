<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from '$lib/router.svelte';
  import BottomNav from './components/layout/BottomNav.svelte';
  import Toasts from './components/layout/Toasts.svelte';
  import Accounts from './routes/Accounts.svelte';
  import Help from './routes/Help.svelte';
  import Market from './routes/Market.svelte';
  import More from './routes/More.svelte';
  import News from './routes/News.svelte';
  import Overview from './routes/Overview.svelte';
  import Privacy from './routes/Privacy.svelte';
  import Reconciliation from './routes/Reconciliation.svelte';
  import Settings from './routes/Settings.svelte';
  import Trading from './routes/Trading.svelte';
  import Watch from './routes/Watch.svelte';
  import TradeAdd from './routes/trading/TradeAdd.svelte';
  import TradeStats from './routes/trading/TradeStats.svelte';
  import Fills from './routes/trading/Fills.svelte';
  import TradeDetail from './routes/trading/TradeDetail.svelte';
  import Trades from './routes/trading/Trades.svelte';
  import Welcome from './routes/Welcome.svelte';
  import Alerts from './routes/invest/Alerts.svelte';
  import AssetDetail from './routes/invest/AssetDetail.svelte';
  import Import from './routes/invest/Import.svelte';
  import ManualEntry from './routes/invest/ManualEntry.svelte';
  import Portfolio from './routes/invest/Portfolio.svelte';
  import Report from './routes/invest/Report.svelte';
  import { recordError } from '$lib/support/errors';
  import SupportSection from './components/settings/SupportSection.svelte';
  import { app } from './state/app.svelte';
  import { toasts, update } from './state/ui.svelte';

  const route = $derived(router.route);

  function seenVersion(): void {
    app.setUi({ lastSeenVersion: __APP_VERSION__ });
  }
  onMount(() => {
    // Première visite : on mémorise la version sans rien dire ; ensuite, un bandeau signale
    // chaque mise à jour installée et renvoie vers les nouveautés.
    if (app.state.ui.lastSeenVersion === null) seenVersion();
  });

  function leaveDemo(): void {
    app.exitDemo();
    toasts.push('Démo terminée : les données d’exemple ont été effacées.');
    router.navigate({ name: 'welcome' });
  }

  let systemDark = $state(true);
  onMount(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    systemDark = media.matches;
    const onChange = (e: MediaQueryListEvent): void => {
      systemDark = e.matches;
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  });
  $effect(() => {
    document.documentElement.dataset['theme'] = app.state.ui.theme;
    const dark = app.state.ui.theme === 'dark' || (app.state.ui.theme === 'auto' && systemDark);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#0f1115' : '#f6f7f9');
  });

  $effect(() => {
    // Sans données, les écrans qui en dépendent renvoient à l'accueil ; l'espace Trading (état
    // vide informatif) et le menu « Plus » restent accessibles.
    if (
      !app.hasData &&
      (route.name === 'overview' ||
        route.name === 'portfolio' ||
        route.name === 'asset' ||
        route.name === 'report')
    ) {
      router.navigate({ name: 'welcome' });
    }
  });

  onMount(() => {
    if (app.hasData) void app.refreshPrices();
  });
</script>

<div class="app">
  {#if update.ready}
    <div class="update" role="status">
      Nouvelle version disponible.
      <button type="button" onclick={() => update.apply()}>Recharger</button>
    </div>
  {/if}
  {#if app.state.ui.lastSeenVersion !== null && app.state.ui.lastSeenVersion !== __APP_VERSION__}
    <div class="update news" role="status">
      Version {__APP_VERSION__} installée.
      <a href={router.href({ name: 'news' })} onclick={seenVersion}>Voir les nouveautés</a>
      <button type="button" onclick={seenVersion} aria-label="Masquer ce message">✕</button>
    </div>
  {/if}
  {#if app.loadError}
    <div class="update error" role="alert">
      Données locales illisibles ({app.loadError}). Restaurez une sauvegarde depuis les réglages.
    </div>
  {/if}
  {#if app.state.ui.demoMode}
    <div class="update demo" role="status">
      Données d’exemple (fictives) — importez votre export pour voir vos chiffres.
      <button type="button" onclick={leaveDemo}>Quitter la démo</button>
    </div>
  {/if}
  <main>
    <!-- Une erreur dans une page ne doit jamais laisser un écran blanc : on l'explique et on
         donne le diagnostic à copier (message + pile, jamais de données). -->
    <svelte:boundary onerror={(error) => recordError(error, 'page')}>
      {#if route.name === 'welcome'}
        <Welcome />
      {:else if route.name === 'portfolio'}
        <Portfolio />
      {:else if route.name === 'trades'}
        <Trades />
      {:else if route.name === 'trade'}
        <TradeDetail id={route.id} />
      {:else if route.name === 'tradeAdd'}
        <TradeAdd />
      {:else if route.name === 'tradeStats'}
        <TradeStats />
      {:else if route.name === 'fills'}
        <Fills />
      {:else if route.name === 'trading'}
        <Trading />
      {:else if route.name === 'more'}
        <More />
      {:else if route.name === 'market'}
        <Market />
      {:else if route.name === 'watch'}
        <Watch />
      {:else if route.name === 'accounts'}
        <Accounts />
      {:else if route.name === 'reconciliation'}
        <Reconciliation />
      {:else if route.name === 'asset'}
        <AssetDetail asset={route.asset} />
      {:else if route.name === 'import'}
        <Import />
      {:else if route.name === 'alerts'}
        <Alerts />
      {:else if route.name === 'add'}
        <ManualEntry />
      {:else if route.name === 'settings'}
        <Settings />
      {:else if route.name === 'privacy'}
        <Privacy />
      {:else if route.name === 'help'}
        <Help />
      {:else if route.name === 'report'}
        <Report />
      {:else if route.name === 'news'}
        <News />
      {:else}
        <Overview />
      {/if}
      {#snippet failed(error, reset)}
        <section class="card crash" role="alert">
          <h2>Une erreur inattendue s’est produite sur cette page</h2>
          <p class="muted">
            Vos données sont intactes (elles sont enregistrées dans ce navigateur). Réessayez, ou
            copiez le diagnostic ci-dessous et signalez le problème : il contient le message
            d’erreur, jamais vos montants.
          </p>
          <p class="error-text">
            {error instanceof Error ? `${error.name} : ${error.message}` : String(error)}
          </p>
          <div class="crash-actions">
            <button class="primary" type="button" onclick={reset}>Réessayer</button>
            <button
              class="secondary"
              type="button"
              onclick={() => router.navigate({ name: 'overview' })}>Retour à l'accueil</button
            >
          </div>
          <SupportSection intro="Le diagnostic ci-dessous inclut l’erreur rencontrée." />
        </section>
      {/snippet}
    </svelte:boundary>
  </main>
  <BottomNav />
  <Toasts />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  main {
    flex: 1;
    width: 100%;
    padding-bottom: calc(72px + env(safe-area-inset-bottom));
  }
  /* ≥ 1024 px : le rail de navigation (BottomNav) occupe une gouttière fixe à gauche. */
  @media (min-width: 1024px) {
    .app {
      padding-left: 96px;
    }
    main {
      padding-bottom: var(--space-6);
    }
  }
  .update {
    background: var(--accent);
    color: var(--accent-fg);
    padding: var(--space-2) var(--space-4);
    font-size: var(--fs-sm);
    display: flex;
    gap: var(--space-3);
    align-items: center;
    justify-content: center;
  }
  .update button {
    font-weight: 700;
    text-decoration: underline;
    color: inherit;
  }
  .update.error {
    background: var(--loss);
    color: #fff;
  }
  .update.demo {
    /* Couleurs fixes (pas de jeton de thème) : contraste ≥ 12:1 en clair comme en sombre. */
    background: #fbbf24;
    color: #1a1208;
  }
  .update.news a {
    color: inherit;
    font-weight: 700;
  }
  .crash {
    margin: var(--space-4) auto;
    max-width: 640px;
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
    border-color: var(--loss);
  }
  .crash h2 {
    color: var(--loss);
  }
  .error-text {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
  .crash-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .crash .primary,
  .crash .secondary {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    font-weight: 700;
  }
  .crash .primary {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .crash .secondary {
    border: 1px solid var(--border);
    color: var(--fg);
  }
  @media (min-width: 768px) {
    main {
      max-width: 1100px;
      margin: 0 auto;
      padding-bottom: var(--space-6);
    }
  }
</style>
