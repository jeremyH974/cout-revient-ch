<script lang="ts">
  let { asset, size = 36 }: { asset: string; size?: number } = $props();
  const hue = $derived([...asset].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
  const label = $derived(asset.slice(0, 4).toUpperCase());
</script>

<span
  class="badge"
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{Math.round(size * 0.3)}px"
  style:background="hsl({hue} 55% 28%)"
  style:color="hsl({hue} 80% 88%)"
  aria-hidden="true">{label}</span
>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-weight: 700;
    letter-spacing: 0.02em;
    flex: none;
  }
</style>
