<script lang="ts">
  /** Sous-navigation de l'espace Trading (contrôle segmenté) : jamais plus de destinations en bas. */
  import { router, type RouteName } from '$lib/router.svelte';
  import SpaceTabs from '../layout/SpaceTabs.svelte';

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
  const tabs = $derived(
    TABS.map((t) => ({
      href: router.href({ name: t.name }),
      label: t.label,
      current: active === t.name,
    })),
  );
</script>

<SpaceTabs ariaLabel="Espace Trading" {tabs} />
