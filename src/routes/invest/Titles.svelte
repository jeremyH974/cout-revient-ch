<script lang="ts">
  import { assetSymbol } from '$lib/domain/assets';
  import { EQUITY_TAX_BOXES } from '$lib/domain/equity-tax-fr';
  import { allocationOf, type PositionReport } from '$lib/domain/engine';
  import { ZERO } from '$lib/domain/money';
  import { router } from '$lib/router.svelte';
  import AllocationDonut from '../../components/charts/AllocationDonut.svelte';
  import EvolutionCard from '../../components/charts/EvolutionCard.svelte';
  import InvestTabs from '../../components/invest/InvestTabs.svelte';
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
  /**
   * Investi, latent et realise des SEULS titres.
   *
   * `report.totals` ne convient pas : il agrege toutes les classes depuis la decision n 119, et
   * l'afficher sous un titre « Titres » donnerait le total crypto+titres. Meme raison pour
   * `SummaryHeader`, qui le lit.
   */
  const invested = $derived(held.reduce((acc, p) => acc.plus(p.costBasis), ZERO));
  const unrealized = $derived(held.reduce((acc, p) => acc.plus(p.unrealized ?? ZERO), ZERO));
  const realized = $derived([...held, ...closed].reduce((acc, p) => acc.plus(p.realized), ZERO));
  /** Répartition des seuls titres : `report.allocation` mélange les classes (décision n° 119). */
  const allocation = $derived(allocationOf(held));
  const unpriced = $derived(held.filter((p) => p.value === null).length);
  /** Sans clé, aucun cours de titre ne peut arriver : le message ne dit pas la même chose. */
  const hasMarketKey = $derived((app.state.ui.twelveDataApiKey ?? '') !== '');
  /** Les places européennes ont leur propre source : leur absence se dit à part (décision n° 113). */
  const hasEuropeKey = $derived((app.state.ui.alphaVantageApiKey ?? '') !== '');
  const tax = $derived(app.equityTax);
</script>

<AppBar />
<InvestTabs active="titles" />

<section class="card summary">
  <h1>Titres</h1>
  <p class="muted small">Actions et fonds indiciels, hors actifs numériques.</p>
  <div class="figures">
    <div><span class="label">Valeur</span><Money {value} strong /></div>
    <div><span class="label">Investi</span><Money value={invested} /></div>
    <div><span class="label">Latent</span><Money value={unrealized} sign colored /></div>
    <div><span class="label">Réalisé</span><Money value={realized} sign colored /></div>
    <div><span class="label">Résultat</span><Money value={total} sign colored strong /></div>
  </div>
</section>

<EvolutionCard scope="equities" title="Évolution des titres" />

{#if allocation.length > 1}
  <section class="card">
    <h2 class="section">Répartition</h2>
    <AllocationDonut entries={allocation} />
  </section>
{/if}

{#if unpriced > 0}
  <p class="small muted note">
    {unpriced}
    {unpriced > 1 ? 'titres sont' : 'titre est'} sans cours : la valeur affichée les exclut.
    {#if !hasMarketKey}
      Aucune clé de données de marché n’est renseignée — sans elle, aucun cours de titre ne peut
      arriver. Collez-en une dans les
      <a href={router.href({ name: 'settings' })}>réglages</a>, section « Prix », champ « Clé Twelve
      Data » (gratuite sur twelvedata.com).
    {:else}
      Votre clé est bien renseignée. Le palier gratuit ne délivre que <strong
        >huit cours par minute</strong
      >
      : relancez le rafraîchissement pour compléter la liste, un lot à la fois.
      {#if !hasEuropeKey}
        Il ne cote par ailleurs que les places américaines : pour Paris et Francfort, ajoutez une
        clé Alpha Vantage dans les
        <a href={router.href({ name: 'settings' })}>réglages</a> (gratuite sur alphavantage.co).
      {:else}
        Ce qui résiste aux deux sources se renseigne par un prix depuis la fiche de l’actif.
      {/if}
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

{#if tax.years.length > 0}
  <details class="card">
    <summary>Déclaration de revenus — estimation</summary>
    <p class="muted small">
      Estimation calculée à partir de vos seules opérations importées. Ce n'est ni une déclaration,
      ni un conseil fiscal. Le prix de revient retenu est le <strong>prix moyen pondéré</strong> par ligne,
      méthode que l'article 150-0 D impose ; une vente ne le recalcule pas.
    </p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Année</th>
            <th scope="col" class="right">Cessions</th>
            <th scope="col" class="right">Plus-value — {EQUITY_TAX_BOXES.gain.box}</th>
            <th scope="col" class="right">Moins-value — {EQUITY_TAX_BOXES.loss.box}</th>
            <th scope="col" class="right">Reports imputés</th>
            <th scope="col" class="right">Imposable</th>
            <th scope="col" class="right">Impôt estimé</th>
          </tr>
        </thead>
        <tbody>
          {#each tax.years as y (y.year)}
            <tr>
              <th scope="row">{y.year}<span class="muted small block">{y.rate.label}</span></th>
              <td class="right">{y.cessions.length}</td>
              <td class="right"><Money value={app.displayFromEur(y.gainsEur)} /></td>
              <td class="right"><Money value={app.displayFromEur(y.lossOfYearEur)} /></td>
              <td class="right"><Money value={app.displayFromEur(y.carryImputedEur)} /></td>
              <td class="right"><Money value={app.displayFromEur(y.taxableEur)} /></td>
              <td class="right"><Money value={app.displayFromEur(y.taxEur)} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="muted small">
      Ces deux cases sont sur la <strong>{EQUITY_TAX_BOXES.gain.form}</strong>, la déclaration
      complémentaire — pas sur la 2042. Un courtier établi hors de France impose en outre de passer
      par la <strong>{EQUITY_TAX_BOXES.foreign.box}</strong> (cadre 3) et, en principe, par la
      <strong>{EQUITY_TAX_BOXES.detail.box}</strong> : la dispense suppose des plus-values calculées
      par l'établissement financier lui-même. La case
      <strong>{EQUITY_TAX_BOXES.loss.box}</strong> ne porte que la moins-value de l'année, jamais le cumul
      des reports.
    </p>
    <p class="warn">
      L'application tranche par convention les points que le texte laisse ouverts, et ignore ce
      qu'elle n'a pas importé :
    </p>
    <ul class="muted small">
      {#each tax.assumptions as note (note)}<li>{note}</li>{/each}
    </ul>
    <p class="muted small">Faites vérifier par un professionnel avant de déclarer.</p>
  </details>
{/if}

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
  /* Tableau fiscal : même présentation que le millésime des prêts, pour que l'œil ne réapprenne rien. */
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th,
  td {
    text-align: left;
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
    vertical-align: top;
  }
  th[scope='row'] {
    font-weight: 500;
  }
  .right {
    text-align: right;
  }
  .block {
    display: block;
  }
  .warn {
    color: var(--warn);
  }
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
