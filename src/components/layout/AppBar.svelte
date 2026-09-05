<script lang="ts">
  import { onMount } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { fmtDate, fmtRelative } from '$lib/format/fr';
  import { router, type Route } from '$lib/router.svelte';
  import { spaceOf } from '$lib/spaces';
  import { app } from '../../state/app.svelte';

  /** `back` : `true` = retour à l'accueil de l'espace courant ; une route = cible explicite. */
  let { title = 'Coût de revient CH', back = false }: { title?: string; back?: boolean | Route } =
    $props();
  const space = $derived(spaceOf(router.route.name));
  const backTo = $derived(typeof back === 'object' ? back : space.home);
  const backLabel = $derived(typeof back === 'object' ? 'Retour' : space.backLabel);
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

  /**
   * Devise : annoncée quel que soit l'état des prix, car le repli USD → EUR (taux BCE absents)
   * concerne aussi les chiffres sans cours (investi, PRU, réalisé).
   */
  const fxNote = $derived.by((): string => {
    const wanted = app.state.ui.displayCurrency;
    if (wanted !== 'EUR' && app.currency === 'EUR')
      return ` · taux ${wanted} indisponibles : montants en €`;
    /*
     * Le taux BCE s'applique AUSSI quand l'écran est en euros, dès qu'un montant est libellé en
     * dollars — tout l'espace Trading l'est (USDC assimilé USD, décision n° 18). Le taire laissait
     * croire que « Prix il y a 2 min » couvrait l'ensemble, alors que la série de taux n'est
     * rafraîchie qu'au-delà de quatre jours : sur un compte réel, les montants en dollars étaient
     * convertis au taux d'il y a trois jours, sans un mot (décision n° 101).
     */
    const day = wanted === 'EUR' ? app.usdRateDay : app.fxLookup.latestDay;
    if (day === null || (wanted === 'EUR' && !app.hasTrading)) return '';
    const stale = app.fxStatus.error ? ' (mise à jour impossible)' : '';
    return ` · taux BCE du ${fmtDate(day)}${stale}`;
  });

  const freshness = $derived.by((): string => {
    const status = app.priceStatus;
    let prices: string;
    if (status.loading) prices = 'Mise à jour des prix…';
    else if (app.state.ui.priceSource === 'off') prices = 'Prix désactivés (réglages)';
    else if (!app.report.pricedAt)
      prices = status.online === false ? 'Hors ligne — aucun prix' : 'Prix non chargés';
    else {
      const rel = fmtRelative(app.report.pricedAt, tick);
      prices = status.online === false ? `Hors ligne — derniers prix ${rel}` : `Prix ${rel}`;
    }
    return prices + fxNote;
  });
</script>

<header class="bar">
  {#if back}
    <a class="icon" href={router.href(backTo)} aria-label={backLabel}>
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
