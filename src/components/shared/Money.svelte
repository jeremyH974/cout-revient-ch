<script lang="ts">
  import type { Big } from '$lib/domain/money';
  import { fmtEur } from '$lib/format/fr';
  import { app } from '../../state/app.svelte';

  let {
    value,
    sign = false,
    compact = false,
    colored = false,
    strong = false,
  }: {
    value: Big | null;
    sign?: boolean;
    compact?: boolean;
    colored?: boolean;
    strong?: boolean;
  } = $props();

  const text = $derived(
    value === null ? '—' : app.state.ui.discreet ? '•••• €' : fmtEur(value, { sign, compact }),
  );
  const tone = $derived(
    !colored || value === null ? '' : value.lt('0') ? 'loss' : value.gt('0') ? 'gain' : '',
  );
</script>

<span class="num {tone}" class:strong>{text}</span>

<style>
  .strong {
    font-weight: 700;
  }
</style>
