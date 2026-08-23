<script lang="ts">
  import changelog from '../../CHANGELOG.md?raw';
  import { inlineSegments, parseChangelog, releaseTitle } from '$lib/support/changelog';
  import { REPO_URL } from '$lib/support/links';
  import AppBar from '../components/layout/AppBar.svelte';
  import { app } from '../state/app.svelte';

  const releases = parseChangelog(changelog);
</script>

<AppBar title="Nouveautés" back={app.hasData} />
<article class="doc">
  <p class="muted">
    Version installée : {__APP_VERSION__} (build {__BUILD_SHA__}). Le site se met à jour tout seul ;
    quand une nouvelle version est prête, un bandeau vous propose de recharger.
  </p>
  {#each releases as release (release.version)}
    <section>
      <h2>{releaseTitle(release)}</h2>
      {#each release.sections as section (section.title)}
        <h3>{section.title}</h3>
        <ul>
          {#each section.items as item, i (i)}
            <li>
              {#each inlineSegments(item) as segment, j (j)}
                {#if segment.kind === 'code'}<code>{segment.value}</code>{:else}{segment.value}{/if}
              {/each}
            </li>
          {/each}
        </ul>
      {/each}
    </section>
  {/each}
  <p class="muted small">
    Historique complet et code source : <a href={REPO_URL} target="_blank" rel="noopener noreferrer"
      >dépôt GitHub</a
    >.
  </p>
</article>

<style>
  .doc {
    padding: var(--space-4);
    max-width: 640px;
    margin: 0 auto;
    font-size: var(--fs-sm);
    line-height: 1.55;
    display: grid;
    gap: var(--space-4);
  }
  h2 {
    font-size: var(--fs-md);
    margin-bottom: var(--space-2);
  }
  h3 {
    font-size: var(--fs-sm);
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: var(--space-3) 0 var(--space-1);
  }
  ul {
    margin: 0;
    padding-left: var(--space-4);
  }
  li + li {
    margin-top: var(--space-1);
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.92em;
  }
  .small {
    font-size: var(--fs-xs);
  }
</style>
