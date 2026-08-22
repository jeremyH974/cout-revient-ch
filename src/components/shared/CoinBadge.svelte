<script lang="ts">
  import { iconUrl } from '$lib/pricing/icons';

  let { asset, size = 36 }: { asset: string; size?: number } = $props();
  const hue = $derived([...asset].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
  const label = $derived(asset.slice(0, 4).toUpperCase());
  const src = $derived(iconUrl(asset));
  /** Actif dont le logo n'a pas pu être chargé : repli sur les initiales. */
  let failedAsset = $state<string | null>(null);
</script>

{#if src !== null && failedAsset !== asset}
  <img
    class="badge icon"
    {src}
    alt=""
    width={size}
    height={size}
    loading="lazy"
    decoding="async"
    onerror={() => (failedAsset = asset)}
  />
{:else}
  <span
    class="badge initials"
    style:width="{size}px"
    style:height="{size}px"
    style:font-size="{Math.round(size * 0.3)}px"
    style:background="hsl({hue} 55% 28%)"
    style:color="hsl({hue} 80% 88%)"
    aria-hidden="true">{label}</span
  >
{/if}

<style>
  .badge {
    border-radius: 50%;
    flex: none;
  }

  .icon {
    display: block;
    overflow: hidden;
  }

  .initials {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
</style>
