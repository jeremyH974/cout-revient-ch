<script lang="ts">
  /** Écrans secondaires, accessibles depuis la quatrième destination « Plus ». */
  import { router, type Route } from '$lib/router.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import { app } from '../state/app.svelte';

  const entries: { route: Route; label: string; detail: string; needsData?: boolean }[] = [
    {
      route: { name: 'import' },
      label: 'Importer un export Coinhouse',
      detail: 'CSV « export avancé »',
    },
    {
      route: { name: 'add' },
      label: 'Ajouter une opération',
      detail: 'Achat, vente, récompense, dépôt…',
    },
    {
      route: { name: 'report' },
      label: 'Rapport PDF',
      detail: 'Synthèse imprimable',
      needsData: true,
    },
    {
      route: { name: 'settings' },
      label: 'Réglages',
      detail: 'Prix, devise, sauvegarde, auto-vérifications',
    },
    { route: { name: 'help' }, label: 'Aide', detail: 'Obtenir et importer son export' },
    { route: { name: 'news' }, label: 'Nouveautés', detail: `Version ${__APP_VERSION__}` },
    {
      route: { name: 'privacy' },
      label: 'Confidentialité',
      detail: 'Rien ne quitte votre navigateur',
    },
  ];
  const visible = $derived(entries.filter((e) => !e.needsData || app.hasData));
</script>

<AppBar title="Plus" />

<nav class="card" aria-label="Écrans secondaires">
  <ul class="menu">
    {#each visible as entry (entry.route.name)}
      <li>
        <a href={router.href(entry.route)}>
          <span class="title">{entry.label}</span>
          <span class="muted small">{entry.detail}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .menu {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .menu li + li {
    border-top: 1px solid var(--border);
  }
  .menu a {
    display: grid;
    gap: 2px;
    min-height: var(--tap);
    padding: var(--space-3) var(--space-2);
    color: inherit;
    text-decoration: none;
  }
  .menu a:hover .title {
    color: var(--accent);
  }
  .title {
    font-weight: 600;
  }
</style>
