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
</style>
