<script lang="ts">
  import { router, type Route } from '$lib/router.svelte';

  const items: { route: Route; label: string; icon: string }[] = [
    {
      route: { name: 'portfolio' },
      label: 'Portefeuille',
      icon: 'M3 13h4v8H3zM10 3h4v18h-4zM17 8h4v13h-4z',
    },
    {
      route: { name: 'import' },
      label: 'Importer',
      icon: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3',
    },
    { route: { name: 'add' }, label: 'Ajouter', icon: 'M12 5v14M5 12h14' },
    {
      route: { name: 'settings' },
      label: 'Réglages',
      icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8 4l2-1-1-3-2 .3-1.4-1.4.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L7 8.3 5 8l-1 3 2 1v2l-2 1 1 3 2-.3 1.4 1.4-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.4-1.4 2 .3 1-3-2-1z',
    },
  ];
  const active = $derived(
    (r: Route): boolean =>
      r.name === router.route.name || (r.name === 'portfolio' && router.route.name === 'asset'),
  );
</script>

<nav class="nav" aria-label="Navigation principale">
  {#each items as item (item.route.name)}
    <a
      href={router.href(item.route)}
      class:active={active(item.route)}
      aria-current={active(item.route) ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" width="22" height="22"
        ><path
          d={item.icon}
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
      <span>{item.label}</span>
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
  }
  a.active {
    color: var(--accent);
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
