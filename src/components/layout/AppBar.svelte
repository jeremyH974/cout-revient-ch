<script lang="ts">
  import { onMount } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { fmtRelative } from '$lib/format/fr';
  import { router } from '$lib/router.svelte';
  import { app } from '../../state/app.svelte';

  let { title = 'Coût de revient CH', back = false }: { title?: string; back?: boolean } = $props();
  let tick = $state(nowMs());
  const THEMES = ['auto', 'light', 'dark'] as const;
  const THEME_LABELS = { auto: 'Système', light: 'Clair', dark: 'Sombre' } as const;
  const cycleTheme = (): void => {
    const current = THEMES.indexOf(app.state.ui.theme);
    app.setUi({ theme: THEMES[(current + 1) % THEMES.length] ?? 'auto' });
  };
  onMount(() => {
    const id = setInterval(() => (tick = nowMs()), 30_000);
    return () => clearInterval(id);
  });

  const fxNote = $derived.by((): string => {
    if (app.currency === 'EUR')
      return app.state.ui.displayCurrency === 'USD' ? ' · taux USD indisponibles' : '';
    return app.fxLookup.latestDay
      ? ` · taux BCE du ${app.fxLookup.latestDay.split('-').reverse().join('/')}`
      : '';
  });

  const freshness = $derived.by((): string => {
    const status = app.priceStatus;
    if (status.loading) return 'Mise à jour des prix…';
    if (app.state.ui.priceSource === 'off') return 'Prix désactivés (réglages)';
    if (!app.report.pricedAt)
      return status.online === false ? 'Hors ligne — aucun prix' : 'Prix non chargés';
    const rel = fmtRelative(app.report.pricedAt, tick);
    return (status.online === false ? `Hors ligne — derniers prix ${rel}` : `Prix ${rel}`) + fxNote;
  });
</script>

<header class="bar">
  {#if back}
    <a class="icon" href={router.href({ name: 'portfolio' })} aria-label="Retour au portefeuille">
      <svg viewBox="0 0 24 24" width="22" height="22"
        ><path
          d="M15 5l-7 7 7 7"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
    </a>
  {/if}
  <div class="titles">
    <h1>{title}</h1>
    <p class="muted small">{freshness}</p>
  </div>
  <div class="actions">
    <button
      class="icon"
      type="button"
      onclick={cycleTheme}
      aria-label="Thème : {THEME_LABELS[app.state.ui.theme]}. Changer."
      title="Thème : {THEME_LABELS[app.state.ui.theme]}"
    >
      {#if app.state.ui.theme === 'light'}
        <svg viewBox="0 0 24 24" width="22" height="22"
          ><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2" /><path
            d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          /></svg
        >
      {:else if app.state.ui.theme === 'dark'}
        <svg viewBox="0 0 24 24" width="22" height="22"
          ><path
            d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linejoin="round"
          /></svg
        >
      {:else}
        <svg viewBox="0 0 24 24" width="22" height="22"
          ><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" /><path
            d="M12 3a9 9 0 0 1 0 18z"
            fill="currentColor"
          /></svg
        >
      {/if}
    </button>
    <button
      class="icon currency"
      type="button"
      onclick={() => app.setCurrency(app.currency === 'EUR' ? 'USD' : 'EUR')}
      aria-label="Devise d'affichage : {app.currency}. Basculer."
      title="Devise d'affichage"
    >
      {app.currency === 'EUR' ? '€' : '$'}
    </button>
    <button
      class="icon"
      type="button"
      onclick={() => app.setUi({ discreet: !app.state.ui.discreet })}
      aria-pressed={app.state.ui.discreet}
      aria-label="Mode discret (masquer les montants)"
      title="Mode discret"
    >
      <svg viewBox="0 0 24 24" width="22" height="22"
        ><path
          d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        /><circle
          cx="12"
          cy="12"
          r="3"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        />{#if app.state.ui.discreet}<path
            d="M4 4l16 16"
            stroke="currentColor"
            stroke-width="2"
          />{/if}</svg
      >
    </button>
    <button
      class="icon"
      type="button"
      onclick={() => void app.refreshPrices(true)}
      disabled={app.priceStatus.loading || app.state.ui.priceSource === 'off'}
      aria-label="Actualiser les prix"
      title="Actualiser les prix"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" class:spin={app.priceStatus.loading}
        ><path
          d="M20 12a8 8 0 1 1-2.3-5.7"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        /><path
          d="M20 4v5h-5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
    </button>
  </div>
</header>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: calc(var(--space-2) + env(safe-area-inset-top)) var(--space-3) var(--space-2);
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--border);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h1 {
    font-size: var(--fs-lg);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .small {
    font-size: var(--fs-xs);
  }
  .actions {
    display: flex;
    gap: var(--space-1);
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap);
    min-height: var(--tap);
    border-radius: var(--radius-sm);
    color: var(--fg-muted);
  }
  .icon:hover,
  .icon[aria-pressed='true'] {
    color: var(--fg);
    background: var(--bg-elev);
  }
  .currency {
    font-weight: 700;
    font-size: var(--fs-lg);
  }
  .icon:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .spin {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
