<script lang="ts">
  import type { Big } from '$lib/domain/money';
  import { fmtPct } from '$lib/format/fr';

  let { value, colored = true }: { value: Big | null; colored?: boolean } = $props();
  const tone = $derived(
    !colored || value === null ? '' : value.lt('0') ? 'loss' : value.gt('0') ? 'gain' : '',
  );
</script>

<span class="num {tone}">{fmtPct(value)}</span>
