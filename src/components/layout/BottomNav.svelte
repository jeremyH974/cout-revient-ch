<script lang="ts">
  import { router } from '$lib/router.svelte';
  import { SPACES, spaceOf, type SpaceId } from '$lib/spaces';

  /** Icônes par espace (tracés 24 × 24, trait courant). */
  const ICONS: Record<SpaceId, string> = {
    overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    invest:
      'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
    trading: 'M7 3v4M7 17v4M5 7h4v10H5zM17 3v6M17 15v6M15 9h4v6h-4z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
  };
  const current = $derived(spaceOf(router.route.name).id);
</script>

<nav class="nav" aria-label="Navigation principale">
  {#each SPACES as space (space.id)}
    <a
      href={router.href(space.home)}
      class:active={current === space.id}
      class={space.id}
      aria-current={current === space.id ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"
        ><path
          d={ICONS[space.id]}
          fill="none"
          stroke="currentColor"
          stroke-width={space.id === 'more' ? 3 : 1.8}
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
      <span>{space.label}</span>
    </a>
  {/each}
</nav>

<style>
  .nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: var(--bg-elev);
    border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
  }
  a {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 56px;
    padding-top: 8px;
    color: var(--fg-muted);
    text-decoration: none;
    font-size: var(--fs-xs);
    text-align: center;
  }
  a.active {
    color: var(--accent);
  }
  a.active.invest {
    color: var(--accent-invest);
  }
  a.active.trading {
    color: var(--accent-trading);
  }
  @media (min-width: 768px) {
    .nav {
      position: sticky;
      top: 0;
      grid-template-columns: repeat(4, auto);
      justify-content: center;
      gap: var(--space-5);
      border-top: 0;
      border-bottom: 1px solid var(--border);
      order: -1;
    }
    a {
      flex-direction: row;
      gap: var(--space-2);
      min-height: var(--tap);
      padding: 0 var(--space-2);
      font-size: var(--fs-sm);
    }
  }

  /* ≥ 1024 px : rail de navigation à gauche (Material 3 / HIG), la gouttière est réservée par
     `.app { padding-left }` dans App.svelte. Mêmes destinations, jamais la couleur seule. */
  @media (min-width: 1024px) {
    .nav {
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      right: auto;
      width: 96px;
      grid-template-columns: 1fr;
      grid-auto-rows: min-content;
      align-content: start;
      justify-content: stretch;
      gap: var(--space-2);
      padding: var(--space-5) var(--space-2) var(--space-4);
      border-bottom: 0;
      border-right: 1px solid var(--border);
    }
    a {
      flex-direction: column;
      gap: 4px;
      min-height: 64px;
      justify-content: center;
      padding: var(--space-2);
      font-size: var(--fs-xs);
      border-radius: var(--radius-sm);
    }
    /* Pastille d'état actif derrière la seule ICÔNE (Material 3) : posée sous le libellé, elle
       éclaircissait le fond juste assez pour faire passer le texte 12 px sous 4,5:1 (axe WCAG
       2.2 AA). Le libellé reste donc sur le fond plein de la barre. */
    a.active svg {
      display: block;
      padding: 4px 14px;
      border-radius: 999px;
      background: color-mix(in srgb, currentColor 14%, transparent);
    }
  }
</style>
