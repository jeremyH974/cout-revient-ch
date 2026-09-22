<script lang="ts">
  import { DATA_SOURCES, requiredAttributions } from '$lib/support/sources';

  const required = requiredAttributions();
</script>

<details class="card group" id="sources" aria-labelledby="sources-title">
  <summary><h2 id="sources-title">Sources des données</h2></summary>
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
</details>

<style>
  .group {
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
  /*
   * Cible ≥ 24 px de zone (WCAG 2.2 SC 2.5.8, P124) : un texte seul à `--fs-sm` tient sur une
   * ligne d'environ 20 px, sous le plancher. Trouvé par les tests de Réglages dépliés
   * (`tests/e2e/a11y.spec.ts`), qui sont les seuls à rendre ces liens visibles pour axe — repliés
   * par défaut, ils n'atteignaient jamais l'arbre d'accessibilité vérifié.
   */
  .notices a {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
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
    display: inline-flex;
    align-items: center;
    min-height: 24px;
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
