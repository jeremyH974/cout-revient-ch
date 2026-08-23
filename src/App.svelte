<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from '$lib/router.svelte';
  import BottomNav from './components/layout/BottomNav.svelte';
  import Toasts from './components/layout/Toasts.svelte';
  import AssetDetail from './routes/AssetDetail.svelte';
  import Help from './routes/Help.svelte';
  import Import from './routes/Import.svelte';
  import ManualEntry from './routes/ManualEntry.svelte';
  import Portfolio from './routes/Portfolio.svelte';
  import Privacy from './routes/Privacy.svelte';
  import Report from './routes/Report.svelte';
  import Settings from './routes/Settings.svelte';
  import Welcome from './routes/Welcome.svelte';
  import { app } from './state/app.svelte';
  import { toasts, update } from './state/ui.svelte';

  const route = $derived(router.route);

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
    if (
      !app.hasData &&
      (route.name === 'portfolio' || route.name === 'asset' || route.name === 'report')
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
    {#if route.name === 'welcome'}
      <Welcome />
    {:else if route.name === 'asset'}
      <AssetDetail asset={route.asset} />
    {:else if route.name === 'import'}
      <Import />
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
    {:else}
      <Portfolio />
    {/if}
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
  @media (min-width: 768px) {
    main {
      max-width: 1100px;
      margin: 0 auto;
      padding-bottom: var(--space-6);
    }
  }
</style>
