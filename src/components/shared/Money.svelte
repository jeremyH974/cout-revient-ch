<script lang="ts">
  import type { Big } from '$lib/domain/money';
  import { fmtMasked, fmtMoney, roundsToZero } from '$lib/format/fr';
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
    value === null
      ? '—'
      : app.state.ui.discreet
        ? fmtMasked(app.currency)
        : fmtMoney(value, app.currency, { sign, compact }),
  );
  // Couleur décidée sur la valeur arrondie : « 0,00 € » n'est ni un gain ni une perte.
  const tone = $derived(
    !colored || value === null || roundsToZero(value) ? '' : value.lt('0') ? 'loss' : 'gain',
  );
</script>

<span class="num {tone}" class:strong>{text}</span>

<style>
  .strong {
    font-weight: 700;
  }
</style>
