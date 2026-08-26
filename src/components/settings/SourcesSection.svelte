<script lang="ts">
  import { DATA_SOURCES, requiredAttributions } from '$lib/support/sources';

  const required = requiredAttributions();
</script>

<section class="card group" aria-labelledby="sources-title">
  <h2 id="sources-title">Sources des données</h2>
  <p class="lead">
    L'application n'a pas de serveur : elle interroge directement ces services depuis votre
    navigateur. Les trois premières mentions ci-dessous sont exigées par leurs conditions
    d'utilisation.
  </p>

  <ul class="notices">
    {#each required as source (source.id)}
      <li>
        <a href={source.url} target="_blank" rel="noreferrer noopener">{source.notice}</a>
      </li>
    {/each}
  </ul>

  <ul class="sources">
    {#each DATA_SOURCES as source (source.id)}
      <li>
        <a href={source.url} target="_blank" rel="noreferrer noopener">{source.label}</a>
        <span class="role">{source.role}</span>
        {#if source.duty === 'required'}
          <span class="duty">Mention exigée par ses conditions d'utilisation</span>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .group {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  .lead {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  /*
   * Les conditions de CoinGecko imposent une police lisible d'au moins 10 pt, soit 13,33 px :
   * `--fs-xs` (12 px) serait en dessous du plancher. D'où `--fs-sm` (14 px) et le poids appuyé,
   * qui répond aussi à l'exigence d'affichage « proéminent ».
   */
  .notices {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .notices a {
    color: var(--fg);
  }
  .sources {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: var(--space-3);
  }
  .sources li {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .sources a {
    font-size: var(--fs-sm);
    color: var(--fg);
  }
  .role {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .duty {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    font-style: italic;
  }
</style>
