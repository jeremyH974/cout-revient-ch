<script lang="ts">
  /** Sous-navigation de l'espace Trading (contrôle segmenté) : jamais plus de destinations en bas. */
  import { router, type RouteName } from '$lib/router.svelte';

  type Tab = 'trading' | 'trades' | 'fills' | 'tradeStats' | 'tradeBreakeven';
  let { active }: { active: Tab } = $props();
  const TABS: { name: Tab; label: string; covers: RouteName[] }[] = [
    { name: 'trading', label: 'Tableau de bord', covers: ['trading'] },
    { name: 'trades', label: 'Trades', covers: ['trades', 'trade', 'tradeAdd'] },
    { name: 'fills', label: 'Fills', covers: ['fills'] },
    { name: 'tradeStats', label: 'Statistiques', covers: ['tradeStats'] },
    // Avant d'entrer : le gain brut minimum pour payer les frais (décision n° 158).
    { name: 'tradeBreakeven', label: 'Seuil', covers: ['tradeBreakeven'] },
  ];
</script>

<nav class="tabs" aria-label="Espace Trading">
  {#each TABS as tab (tab.name)}
    <a
      href={router.href({ name: tab.name })}
      aria-current={active === tab.name ? 'page' : undefined}>{tab.label}</a
    >
  {/each}
</nav>

<style>
  /*
   * Cinq onglets ne tiennent pas toujours sur un téléphone : 424 px pour 412 avec les polices Linux
   * de la CI, alors que Windows passait « Tableau de bord » sur deux lignes et tenait. Une barre qui
   * déborde fait dézoomer le navigateur mobile, et la navigation basse intercepte alors les clics.
   * Les onglets passent donc à la ligne plutôt que de pousser la page (WCAG 1.4.10, décision n° 158).
   */
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-1);
    margin-bottom: var(--space-3);
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    width: fit-content;
    max-width: 100%;
  }
  a {
    display: inline-flex;
    align-items: center;
    white-space: nowrap;
    min-height: 36px;
    padding: 0 var(--space-3);
    border-radius: calc(var(--radius-sm) - 2px);
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-decoration: none;
  }
  a[aria-current='page'] {
    background: var(--bg-elev);
    color: var(--fg);
    box-shadow: var(--shadow);
  }
</style>
