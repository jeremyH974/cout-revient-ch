<script lang="ts">
  export type Period = '1d' | '1w' | '1m' | '3m' | '1y' | 'all';

  let {
    value = $bindable<Period>('1m'),
    available = ['1d', '1w', '1m', '3m', '1y', 'all'] as Period[],
  }: { value?: Period; available?: Period[] } = $props();

  const labels: Record<Period, string> = {
    '1d': '1J',
    '1w': '1S',
    '1m': '1M',
    '3m': '3M',
    '1y': '1A',
    all: 'Tout',
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
