<script lang="ts">
  import type { Big } from '$lib/domain/money';
  import { fmtQty } from '$lib/format/fr';
  import { app } from '../../state/app.svelte';

  let {
    value,
    asset = '',
    abbreviate = false,
    sign = false,
  }: { value: Big | null; asset?: string; abbreviate?: boolean; sign?: boolean } = $props();
  const text = $derived(
    value === null ? '—' : app.state.ui.discreet ? '••••' : fmtQty(value, { abbreviate, sign }),
  );
</script>

<span class="num"
  >{text}{#if asset}&nbsp;{asset.toUpperCase()}{/if}</span
>
