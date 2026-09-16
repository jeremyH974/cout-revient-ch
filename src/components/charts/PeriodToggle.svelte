<script lang="ts">
  /**
   * Ce composant définissait **son propre** type `Period`, copie de celui du domaine : la même
   * fragmentation que les trois vocabulaires, un cran plus bas (décision n° 157). Il lit désormais
   * le type et la liste de `$lib/history`, seule source.
   */
  import { DEFAULT_PERIOD, PRESET_PERIODS, type Period } from '$lib/history';

  let {
    value = $bindable<Period>(DEFAULT_PERIOD),
    available = PRESET_PERIODS as Period[],
  }: { value?: Period; available?: readonly Period[] } = $props();

  const labels: Record<Period, string> = {
    '1d': '1J',
    '1w': '1S',
    '1m': '1M',
    '3m': '3M',
    '1y': '1A',
    all: 'Tout',
    // Une pastille qui n'est pas une durée mais une PORTE : elle ouvre deux champs de date.
    custom: 'Dates',
  };
</script>

<div class="toggle" role="radiogroup" aria-label="Période">
  {#each available as period (period)}
    <button
      type="button"
      role="radio"
      aria-checked={value === period}
      class:active={value === period}
      onclick={() => (value = period)}
    >
      {labels[period]}
    </button>
  {/each}
</div>

<style>
  .toggle {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  button {
    min-width: 44px;
    min-height: 36px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
    background: var(--bg-elev);
  }
  button.active {
    background: var(--fg);
    color: var(--bg);
    border-color: var(--fg);
  }
</style>
