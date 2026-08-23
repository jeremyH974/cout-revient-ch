<script lang="ts">
  import type { Big } from '$lib/domain/money';
  import { fmtPct, roundsToZero } from '$lib/format/fr';

  let { value, colored = true }: { value: Big | null; colored?: boolean } = $props();
  // Un pourcentage qui s'affiche « 0,0 % » (3 décimales du ratio) reste neutre.
  const tone = $derived(
    !colored || value === null || roundsToZero(value, 3) ? '' : value.lt('0') ? 'loss' : 'gain',
  );
</script>

<span class="num {tone}">{fmtPct(value)}</span>
