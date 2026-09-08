<script lang="ts">
  import { assetSymbol } from '$lib/domain/assets';
  import type { PositionReport } from '$lib/domain/engine';
  import { ZERO } from '$lib/domain/money';
  import { router } from '$lib/router.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import AssetRow from '../../components/portfolio/AssetRow.svelte';
  import Money from '../../components/shared/Money.svelte';
  import { app } from '../../state/app.svelte';

  type SortKey = 'value' | 'total' | 'asset';
  let query = $state('');
  let sort = $state<SortKey>('value');

  const sorters: Record<SortKey, (a: PositionReport, b: PositionReport) => number> = {
    value: (a, b) => (b.value ?? ZERO).cmp(a.value ?? ZERO),
    total: (a, b) => (b.total ?? ZERO).cmp(a.total ?? ZERO),
    asset: (a, b) => assetSymbol(a.asset).localeCompare(assetSymbol(b.asset)),
  };
  /** La recherche porte sur le symbole nu : personne ne tape « eq: » devant un ticker. */
  const matches = (p: PositionReport): boolean => {
    const q = query.trim().toLowerCase();
    return q === '' || assetSymbol(p.asset).includes(q);
  };

  const held = $derived([...app.report.equities].filter(matches).sort(sorters[sort]));
  const closed = $derived(
    app.report.closed.filter((p) => p.assetClass === 'equity').filter(matches),
  );
  const value = $derived(held.reduce((acc, p) => acc.plus(p.value ?? ZERO), ZERO));
  const total = $derived(
    [...held, ...closed].reduce((acc, p) => acc.plus(p.total ?? p.realized), ZERO),
  );
  const unpriced = $derived(held.filter((p) => p.value === null).length);
  /** Sans clé, aucun cours de titre ne peut arriver : le message ne dit pas la même chose. */
  const hasMarketKey = $derived((app.state.ui.twelveDataApiKey ?? '') !== '');
</script>

<AppBar />

<section class="card summary">
  <h1>Titres</h1>
  <p class="muted small">Actions et fonds indiciels, hors actifs numériques.</p>
  <div class="figures">
    <div><span class="label">Valeur</span><Money {value} strong /></div>
    <div><span class="label">Résultat</span><Money value={total} sign colored strong /></div>
  </div>
</section>

{#if unpriced > 0}
  <p class="small muted note">
    {unpriced}
    {unpriced > 1 ? 'titres sont' : 'titre est'} sans cours : la valeur affichée les exclut.
    {#if !hasMarketKey}
      Aucune clé de données de marché n’est renseignée — sans elle, aucun cours de titre ne peut
      arriver. Collez-en une dans les
      <a href={router.href({ name: 'settings' })}>réglages</a> (gratuite sur twelvedata.com).
    {:else}
      Votre clé est bien renseignée : le fournisseur ne reconnaît pas leur symbole. Saisissez un
      prix depuis la fiche de l’actif, ou vérifiez le symbole auprès de votre courtier.
    {/if}
  </p>
{/if}

<div class="controls">
  <input
    type="search"
    placeholder="Rechercher un titre"
    aria-label="Rechercher un titre"
    bind:value={query}
  />
  <label class="sort"
    >Trier par
    <select bind:value={sort}>
      <option value="value">Valeur</option>
      <option value="total">Résultat</option>
      <option value="asset">Nom</option>
    </select>
  </label>
</div>

<section class="list">
  <div class="head" aria-hidden="true">
    <span>Actif</span><span>Quantité · PRU</span><span>Prix</span><span>Valeur</span><span
      >Latent</span
    ><span>Réalisé</span><span>Total</span>
  </div>
  {#if held.length > 0}
    <ul class="rows" aria-label="Titres détenus">
      {#each held as p (p.asset)}
        <AssetRow position={p} />
      {/each}
    </ul>
  {:else if app.report.equities.length > 0}
    <p class="empty muted">Aucun titre pour cette recherche.</p>
  {:else}
    <div class="card empty-state">
      <h2>Aucun titre pour l’instant</h2>
      <p class="muted">
        Importez le relevé de votre courtier : le classeur eToro est reconnu tel quel, sans rien
        saisir à la main.
      </p>
      <p><a href={router.href({ name: 'import' })}>Importer un relevé</a></p>
    </div>
  {/if}
</section>

{#if closed.length > 0}
  <section class="list">
    <h2 class="section" id="closed-titles">
      Titres cédés <span class="muted small">— plus-values réalisées</span>
    </h2>
    <ul class="rows" aria-labelledby="closed-titles">
      {#each closed as p (p.asset)}
        <AssetRow position={p} />
      {/each}
    </ul>
  </section>
{/if}

<style>
  .summary {
    display: grid;
    gap: var(--space-2);
  }
  .summary h1 {
    margin: 0;
    font-size: 1.25rem;
  }
  .figures {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-5);
    margin-top: var(--space-2);
  }
  .label {
    display: block;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .note {
    margin: var(--space-2) 0;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    margin: var(--space-3) 0;
  }
  .controls input[type='search'] {
    flex: 1 1 12rem;
    min-height: var(--tap);
  }
  .sort {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.9rem;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* L’en-tête ne sert qu’en grille large : sur mobile, chaque ligne porte ses libellés. */
  .head {
    display: none;
  }
  @media (min-width: 768px) {
    .head {
      display: grid;
      grid-template-columns: 2fr 1.4fr 1fr 1fr 1.2fr 1fr 1fr;
      padding: var(--space-2) var(--space-4);
      font-size: var(--fs-xs);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--fg-muted);
      border-bottom: 1px solid var(--border);
    }
    .head span:not(:first-child) {
      text-align: right;
    }
  }
  .empty,
  .empty-state {
    padding: var(--space-4);
  }
  .empty-state h2 {
    margin-top: 0;
    font-size: 1.05rem;
  }
  .section {
    font-size: 1rem;
    margin: var(--space-4) 0 var(--space-2);
  }
</style>
