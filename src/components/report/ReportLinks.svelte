<script lang="ts">
  /**
   * Les liens entre rapports (décision n° 178).
   *
   * **Les mêmes liens, dans le même ordre, sur chacun des quatre rapports** : WCAG 2.2 § 3.2.3
   * (« Consistent Navigation ») le demande d'un mécanisme répété d'une page à l'autre, et § 2.4.5
   * (« Multiple Ways ») veut plus d'un chemin vers chaque page — celui-ci s'ajoute au lien que porte
   * chaque espace. L'ordre vient du registre, qui suit la barre de navigation.
   *
   * Le rapport courant reste dans la liste, marqué `aria-current="page"` plutôt que retiré : une
   * liste qui change de longueur selon la page n'est plus un repère.
   */
  import { REPORTS, type ReportId } from '$lib/reports';
  import { router } from '$lib/router.svelte';

  let { current }: { current: ReportId } = $props();
</script>

<nav class="report-links" aria-label="Rapports">
  <ul>
    {#each REPORTS as report (report.id)}
      <li>
        <a
          href={router.href(report.route)}
          aria-current={report.id === current ? 'page' : undefined}>{report.label}</a
        >
      </li>
    {/each}
  </ul>
</nav>

<style>
  .report-links {
    max-width: 960px;
    margin: 0 auto var(--space-2);
    padding: 0 var(--space-3);
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  a {
    display: inline-block;
    min-height: 24px;
    padding: var(--space-1) 0;
    color: var(--fg-muted);
    font-weight: 600;
  }
  a[aria-current='page'] {
    color: var(--fg);
    text-decoration: none;
    border-bottom: 2px solid currentColor;
  }
  @media print {
    /* Un lien ne se clique pas sur le papier : il n'a rien à y faire. */
    .report-links {
      display: none !important;
    }
  }
</style>
