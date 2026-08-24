<script lang="ts">
  /** Sous-navigation de l'espace Trading (contrôle segmenté) : jamais plus de destinations en bas. */
  import { router, type RouteName } from '$lib/router.svelte';

  type Tab = 'trading' | 'trades' | 'fills' | 'tradeStats';
  let { active }: { active: Tab } = $props();
  const TABS: { name: Tab; label: string; covers: RouteName[] }[] = [
    { name: 'trading', label: 'Tableau de bord', covers: ['trading'] },
    { name: 'trades', label: 'Trades', covers: ['trades', 'trade', 'tradeAdd'] },
    { name: 'fills', label: 'Fills', covers: ['fills'] },
    { name: 'tradeStats', label: 'Statistiques', covers: ['tradeStats'] },
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
  .tabs {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    margin-bottom: var(--space-3);
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    width: fit-content;
  }
  a {
    display: inline-flex;
    align-items: center;
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
