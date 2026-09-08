<script lang="ts">
  import { iconUrl, recordIconFailure } from '$lib/pricing/icons';

  let {
    asset,
    size = 36,
    /**
     * Chercher un logo. Faux pour un titre : la bibliothèque d'icônes est crypto, et un ticker
     * partagé y prendrait le logo d'une autre classe d'actif (décision n° 103).
     */
    logo = true,
    /** Logo déjà résolu ailleurs (titres) : il prime sur la bibliothèque locale. */
    url = null,
  }: { asset: string; size?: number; logo?: boolean; url?: string | null } = $props();
  const hue = $derived([...asset].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
  const label = $derived(asset.slice(0, 4).toUpperCase());
  /** 0 = premier chargement ; 1 = réessai en contournant les caches (navigateur, service worker). */
  let attempt = $state(0);
  /** Actif dont le logo n'a pas pu être chargé malgré le réessai : repli sur les initiales. */
  let failedAsset = $state<string | null>(null);
  const src = $derived.by(() => {
    if (url !== null)
      return attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`;
    if (!logo) return null;
    const base = iconUrl(asset);
    if (base === null) return null;
    return attempt === 0 ? base : `${base}?retry=${attempt}`;
  });

  function onError(): void {
    if (attempt === 0) {
      setTimeout(() => (attempt = 1), 1500);
      return;
    }
    failedAsset = asset;
    if (src !== null) recordIconFailure(asset, src);
  }
</script>

{#if src !== null && failedAsset !== asset}
  <img
    class="badge icon"
    {src}
    alt=""
    width={size}
    height={size}
    decoding="async"
    onerror={onError}
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
