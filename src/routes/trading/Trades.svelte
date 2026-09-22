<script lang="ts">
  /**
   * Liste des trades (aller-retours reconstruits + trades manuels), du plus récent au plus
   * ancien : sens, taille, entrée → sortie, P&L net (coloré), R quand le plan le permet, badges
   * (ouvert, liquidation, incomplet, setup, à annoter). La saisie ne vit jamais ici (P21).
   *
   * P121 : recherche + facettes en puces (`domain/trading/filter.ts`, sous test de mutation —
   * rien n'est réimplémenté ici), synthèse du sous-ensemble filtré par la MÊME recette que
   * `TradeStats.svelte` (`summarizeFiltered` appelle `computeStats`). L'état du filtre vit dans
   * `ui.tradeFilter` (réglages de l'appareil), pas dans l'URL — décisions n° 156-157 et n° 182 —
   * ce qui le fait survivre à l'aller-retour vers la fiche d'un trade.
   *
   * P122 : bouton « Annoter » par ligne (jamais imbriqué dans le lien de la ligne), qui ouvre
   * `JournalSheet` — trois gestes depuis la liste (ouvrir, choisir un setup, enregistrer).
   */
  import type { Big } from '$lib/domain/money';
  import {
    activeFacetCount,
    applyFilter,
    facetOptions,
    isFilterActive,
    needsAnnotation,
    summarizeFiltered,
    type FacetValueCount,
    type FilterContext,
    type TradeFilter,
    type TradeOutcome,
    type TradeSide,
  } from '$lib/domain/trading/filter';
  import type { JournaledTrip } from '$lib/domain/trading/journal';
  import { downloadText } from '$lib/export/download';
  import { tradesToCsv } from '$lib/export/trades-csv';
  import { fmtDate, fmtPct, fmtPrice, fmtQty, fmtRatio } from '$lib/format/fr';
  import { nowMs } from '$lib/clock';
  import { resolveWindow, todayOf, type Period } from '$lib/history';
  import { router } from '$lib/router.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import Money from '../../components/shared/Money.svelte';
  import Sheet from '../../components/shared/Sheet.svelte';
  import JournalSheet from '../../components/trading/JournalSheet.svelte';
  import RangePicker from '../../components/charts/RangePicker.svelte';
  import TagManageSheet from '../../components/trading/TagManageSheet.svelte';
  import TradingTabs from '../../components/trading/TradingTabs.svelte';
  import { app } from '../../state/app.svelte';

  const trips = $derived(app.roundTrips);
  const closed = $derived(trips.filter((t) => t.trip.status === 'closed').length);
  const money = (t: JournaledTrip, value: Big): Big | null =>
    app.quoteToDisplay(t.trip.quote, value);
  const label = (id: string): string => app.accountLabels[id] ?? id;
  const rText = (r: Big): string => `${fmtRatio(r, 2, { sign: true })} R`;

  // --- Filtre (P121) ------------------------------------------------------------------------
  const PERIODS: Period[] = ['1w', '1m', '3m', '1y', 'all', 'custom'];
  const period = $derived<Period>(app.state.ui.period);
  const customRange = $derived(app.state.ui.customRange);
  const dayWindow = $derived(resolveWindow(period, customRange, todayOf(nowMs())));

  const ctx: FilterContext = { accountLabel: label };
  const filter = $derived(app.state.ui.tradeFilter);
  const facets = $derived(facetOptions(trips));
  const filtered = $derived(applyFilter(trips, filter, ctx));
  const summary = $derived(summarizeFiltered(filtered, dayWindow, money));
  const tagLabelOf = $derived(new Map(facets.tags.map((t) => [t.key, t.label])));
  /** `TagUsage` porte `key`/`label`, pas `value` : converti une fois pour la même forme que les
   * autres facettes, que `facetChips` consomme uniformément. */
  const tagOptions = $derived(facets.tags.map((t) => ({ value: t.key, count: t.count })));

  const SIDE_LABELS: Record<TradeSide, string> = { long: 'Long', short: 'Short' };
  const OUTCOME_LABELS: Record<TradeOutcome, string> = {
    win: 'Gagnant',
    loss: 'Perdant',
    open: 'Ouvert',
    unannotated: 'À annoter',
  };
  const OUTCOME_ORDER: TradeOutcome[] = ['win', 'loss', 'open', 'unannotated'];
  const presentOutcomes = $derived(
    OUTCOME_ORDER.map((o) => facets.outcomes.find((f) => f.value === o)).filter(
      (f): f is FacetValueCount<TradeOutcome> => f !== undefined,
    ),
  );
  /** Tags les plus fréquents seulement, dans la rangée rapide : le reste vit dans « Filtres ». */
  const QUICK_TAGS = 8;
  const quickTagOptions = $derived(tagOptions.slice(0, QUICK_TAGS));

  function setFilter(patch: Partial<TradeFilter>): void {
    app.setUi({ tradeFilter: { ...app.state.ui.tradeFilter, ...patch } });
  }
  function toggleValue<T>(list: readonly T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }
  const toggleSide = (v: TradeSide): void => setFilter({ sides: toggleValue(filter.sides, v) });
  const toggleOutcome = (v: TradeOutcome): void =>
    setFilter({ outcomes: toggleValue(filter.outcomes, v) });
  const toggleSetup = (v: string): void => setFilter({ setups: toggleValue(filter.setups, v) });
  const toggleMistake = (v: string): void =>
    setFilter({ mistakes: toggleValue(filter.mistakes, v) });
  const toggleTag = (v: string): void => setFilter({ tags: toggleValue(filter.tags, v) });
  const toggleAccount = (v: string): void =>
    setFilter({ accounts: toggleValue(filter.accounts, v) });

  // Recherche : anti-rebond ~200 ms avant d'écrire dans l'état (persisté, partagé avec la feuille
  // de filtres) — la frappe elle-même reste instantanée, portée par une variable locale.
  let queryInput = $state(app.state.ui.tradeFilter.query);
  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  function onQueryInput(value: string): void {
    queryInput = value;
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => setFilter({ query: value }), 200);
  }

  function clearFilters(): void {
    clearTimeout(debounceHandle);
    setFilter({
      query: '',
      sides: [],
      outcomes: [],
      setups: [],
      mistakes: [],
      tags: [],
      accounts: [],
    });
    queryInput = '';
  }

  interface ActiveChip {
    key: string;
    text: string;
    remove: () => void;
  }
  const activeChips = $derived.by((): ActiveChip[] => {
    const chips: ActiveChip[] = [];
    if (filter.query.trim() !== '') {
      chips.push({
        key: 'query',
        text: `Recherche : « ${filter.query.trim()} »`,
        remove: () => setFilter({ query: '' }),
      });
    }
    for (const v of filter.sides) {
      chips.push({
        key: `side:${v}`,
        text: `Sens : ${SIDE_LABELS[v]}`,
        remove: () => setFilter({ sides: filter.sides.filter((x) => x !== v) }),
      });
    }
    for (const v of filter.outcomes) {
      chips.push({
        key: `outcome:${v}`,
        text: `Issue : ${OUTCOME_LABELS[v]}`,
        remove: () => setFilter({ outcomes: filter.outcomes.filter((x) => x !== v) }),
      });
    }
    for (const v of filter.setups) {
      chips.push({
        key: `setup:${v}`,
        text: `Setup : ${v}`,
        remove: () => setFilter({ setups: filter.setups.filter((x) => x !== v) }),
      });
    }
    for (const v of filter.mistakes) {
      chips.push({
        key: `mistake:${v}`,
        text: `Erreur : ${v}`,
        remove: () => setFilter({ mistakes: filter.mistakes.filter((x) => x !== v) }),
      });
    }
    for (const v of filter.tags) {
      chips.push({
        key: `tag:${v}`,
        text: `Tag : ${tagLabelOf.get(v) ?? v}`,
        remove: () => setFilter({ tags: filter.tags.filter((x) => x !== v) }),
      });
    }
    for (const v of filter.accounts) {
      chips.push({
        key: `account:${v}`,
        text: `Compte : ${label(v)}`,
        remove: () => setFilter({ accounts: filter.accounts.filter((x) => x !== v) }),
      });
    }
    return chips;
  });

  let filtersOpen = $state(false);
  let tagManageOpen = $state(false);
  let annotatingId = $state<string | null>(null);

  function exportCsv(): void {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(
      `${app.state.ui.demoMode ? 'demo-' : ''}trades-${stamp}.csv`,
      tradesToCsv(trips, app.accountLabels),
      'text/csv',
    );
  }
</script>

{#snippet facetChips(
  items: readonly { value: string; count: number }[],
  selected: readonly string[],
  labelOf: (v: string) => string,
  onToggle: (v: string) => void,
)}
  {#each items as f (f.value)}
    <button
      type="button"
      class="chip"
      aria-pressed={selected.includes(f.value)}
      onclick={() => onToggle(f.value)}
    >
      {labelOf(f.value)} ({f.count})
    </button>
  {/each}
{/snippet}

<AppBar title="Trades" back={{ name: 'trading' }} />
<TradingTabs active="trades" />

<div class="head">
  <p class="muted small count">
    {trips.length} trade{trips.length > 1 ? 's' : ''} · {closed} clos
  </p>
  <div class="actions">
    {#if trips.length > 0}
      <button class="secondary" type="button" onclick={exportCsv}>Exporter (CSV)</button>
    {/if}
    <a class="primary" href={router.href({ name: 'tradeAdd' })}>Ajouter un trade</a>
  </div>
</div>

{#if trips.length === 0}
  <section class="card">
    <p class="muted">
      Aucun trade pour l'instant : synchronisez un compte Hyperliquid (les aller-retours se
      reconstruisent tout seuls) ou saisissez un trade d'une autre plateforme.
    </p>
  </section>
{:else}
  <section class="card filters">
    <label class="field search">
      <span class="sr-only">Rechercher un trade</span>
      <input
        type="search"
        placeholder="Rechercher (symbole, compte, journal)…"
        value={queryInput}
        oninput={(e) => onQueryInput(e.currentTarget.value)}
      />
    </label>

    <div class="period-bar">
      <span class="muted small">Période (synthèse)</span>
      <RangePicker id="trades" available={PERIODS} />
    </div>

    {#if facets.sides.length > 0}
      <fieldset class="chips-group">
        <legend>Sens</legend>
        <div class="chips">
          {@render facetChips(
            facets.sides,
            filter.sides,
            (v) => SIDE_LABELS[v as TradeSide],
            (v) => toggleSide(v as TradeSide),
          )}
        </div>
      </fieldset>
    {/if}
    {#if presentOutcomes.length > 0}
      <fieldset class="chips-group">
        <legend>Issue</legend>
        <div class="chips">
          {@render facetChips(
            presentOutcomes,
            filter.outcomes,
            (v) => OUTCOME_LABELS[v as TradeOutcome],
            (v) => toggleOutcome(v as TradeOutcome),
          )}
        </div>
      </fieldset>
    {/if}
    {#if facets.setups.length > 0}
      <fieldset class="chips-group">
        <legend>Setup</legend>
        <div class="chips">
          {@render facetChips(
            facets.setups,
            filter.setups,
            (v) => v,
            (v) => toggleSetup(v),
          )}
        </div>
      </fieldset>
    {/if}
    {#if quickTagOptions.length > 0}
      <fieldset class="chips-group">
        <legend>Tag</legend>
        <div class="chips">
          {@render facetChips(
            quickTagOptions,
            filter.tags,
            (v) => tagLabelOf.get(v) ?? v,
            (v) => toggleTag(v),
          )}
        </div>
      </fieldset>
    {/if}

    <div class="sheet-trigger">
      <button class="secondary" type="button" onclick={() => (filtersOpen = true)}>
        Filtres{activeFacetCount(filter) > 0 ? ` (${activeFacetCount(filter)})` : ''}
      </button>
    </div>

    {#if activeChips.length > 0}
      <div class="chips active-chips" aria-label="Filtres actifs">
        {#each activeChips as c (c.key)}
          <span class="chip removable">
            {c.text}
            <button type="button" onclick={c.remove} aria-label="Retirer le filtre « {c.text} »"
              >×</button
            >
          </span>
        {/each}
        <button class="link" type="button" onclick={clearFilters}>Effacer les filtres</button>
      </div>
    {/if}
  </section>

  {#if filtered.length === 0}
    <section class="card">
      <p class="muted">Aucun trade ne correspond à ces filtres.</p>
      {#if activeChips.length > 0}
        <ul class="active-list">
          {#each activeChips as c (c.key)}
            <li class="muted small">{c.text}</li>
          {/each}
        </ul>
        <button class="secondary" type="button" onclick={clearFilters}>Effacer les filtres</button>
      {/if}
    </section>
  {:else}
    <section class="card summary" aria-label="Synthèse du filtre">
      <p class="muted small">
        Sur la période choisie{isFilterActive(filter)
          ? `, ${filtered.length} trade${filtered.length > 1 ? 's' : ''} filtré${filtered.length > 1 ? 's' : ''}`
          : ''} :
      </p>
      <dl class="stat-grid cols-3">
        <div>
          <dt>Trades clos</dt>
          <dd class="num">{summary.stats.closed}</dd>
        </div>
        <div>
          <dt>Résultat net</dt>
          <dd><Money value={summary.stats.netTotal} sign colored strong /></dd>
        </div>
        <div>
          <dt>Taux de réussite</dt>
          <dd class="num">
            {summary.stats.winRate === null ? '—' : fmtPct(summary.stats.winRate, { sign: false })}
          </dd>
        </div>
        <div>
          <dt>Espérance (R)</dt>
          <dd class="num">
            {summary.stats.expectancyR === null ? '—' : rText(summary.stats.expectancyR)}
          </dd>
        </div>
        <div>
          <dt>Profit factor</dt>
          <dd class="num">{fmtRatio(summary.stats.profitFactor, 2)}</dd>
        </div>
      </dl>
      <p class="muted small">
        {summary.open} ouvert{summary.open > 1 ? 's' : ''} · {summary.needsAnnotation} à annoter
      </p>
    </section>

    <ul class="trades" aria-label="Trades">
      {#each filtered as t (t.trip.id)}
        <li class="card row">
          <a class="link-area" href={router.href({ name: 'trade', id: t.trip.id })}>
            <div class="main">
              <p class="title">
                <span class="dir {t.trip.direction}"
                  >{t.trip.direction === 'long' ? 'Long' : 'Short'}</span
                >
                <strong>{t.trip.symbol}</strong>
                <span class="muted small">× {fmtQty(t.trip.qtyMax, { abbreviate: true })}</span>
                {#if t.trip.status === 'open'}<span class="badge open">ouvert</span>{/if}
                {#if t.trip.liquidated}<span class="badge liq">liquidation</span>{/if}
                {#if t.trip.incomplete}<span class="badge">historique partiel</span>{/if}
                {#if t.journal?.setup}<span class="badge setup">{t.journal.setup}</span>{/if}
                {#if needsAnnotation(t)}<span class="badge unannotated">à annoter</span>{/if}
              </p>
              <p class="muted small">
                {fmtDate(t.trip.openedAt)}{t.trip.closedAt ? ` → ${fmtDate(t.trip.closedAt)}` : ''}
                · {t.trip.avgEntry ? fmtPrice(t.trip.avgEntry, 'USD') : '?'}
                {#if t.trip.avgExit}→ {fmtPrice(t.trip.avgExit, 'USD')}{/if}
                {#if app.hlAccounts.length > 0}· {label(t.trip.accountId)}{/if}
              </p>
              {#if t.journal?.thesis}
                <p class="muted small thesis">{t.journal.thesis}</p>
              {/if}
              {#if t.journal && t.journal.tags.length > 0}
                <p class="chips tag-chips">
                  {#each t.journal.tags.slice(0, 2) as tag (tag)}
                    <span class="chip tag-chip">{tag}</span>
                  {/each}
                  {#if t.journal.tags.length > 2}
                    <span class="chip tag-chip">+{t.journal.tags.length - 2}</span>
                  {/if}
                </p>
              {/if}
            </div>
            <div class="side">
              {#if t.trip.status === 'closed'}
                <Money value={money(t, t.trip.netPnl)} sign colored strong />
                {#if t.r}
                  <span class="muted small num">{rText(t.r)}</span>
                {:else if t.entrySlippage}
                  <span class="muted small"
                    >écart entrée {fmtPct(t.entrySlippage, { sign: true })}</span
                  >
                {/if}
              {:else}
                <span class="muted small">en cours</span>
              {/if}
            </div>
          </a>
          <button
            class="secondary annotate"
            type="button"
            onclick={() => (annotatingId = t.trip.id)}
          >
            Annoter
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <Sheet bind:open={filtersOpen} title="Filtres">
    <div class="filters-sheet">
      {#if facets.sides.length > 0}
        <fieldset class="chips-group">
          <legend>Sens</legend>
          <div class="chips">
            {@render facetChips(
              facets.sides,
              filter.sides,
              (v) => SIDE_LABELS[v as TradeSide],
              (v) => toggleSide(v as TradeSide),
            )}
          </div>
        </fieldset>
      {/if}
      {#if presentOutcomes.length > 0}
        <fieldset class="chips-group">
          <legend>Issue</legend>
          <div class="chips">
            {@render facetChips(
              presentOutcomes,
              filter.outcomes,
              (v) => OUTCOME_LABELS[v as TradeOutcome],
              (v) => toggleOutcome(v as TradeOutcome),
            )}
          </div>
        </fieldset>
      {/if}
      {#if facets.setups.length > 0}
        <fieldset class="chips-group">
          <legend>Setup</legend>
          <div class="chips">
            {@render facetChips(
              facets.setups,
              filter.setups,
              (v) => v,
              (v) => toggleSetup(v),
            )}
          </div>
        </fieldset>
      {/if}
      {#if facets.mistakes.length > 0}
        <fieldset class="chips-group">
          <legend>Erreurs</legend>
          <div class="chips">
            {@render facetChips(
              facets.mistakes,
              filter.mistakes,
              (v) => v,
              (v) => toggleMistake(v),
            )}
          </div>
        </fieldset>
      {/if}
      {#if tagOptions.length > 0}
        <fieldset class="chips-group">
          <legend>Tag</legend>
          <div class="chips">
            {@render facetChips(
              tagOptions,
              filter.tags,
              (v) => tagLabelOf.get(v) ?? v,
              (v) => toggleTag(v),
            )}
          </div>
          <button class="link" type="button" onclick={() => (tagManageOpen = true)}
            >Gérer les tags</button
          >
        </fieldset>
      {/if}
      {#if facets.accounts.length > 0}
        <fieldset class="chips-group">
          <legend>Compte</legend>
          <div class="chips">
            {@render facetChips(
              facets.accounts,
              filter.accounts,
              (v) => label(v),
              (v) => toggleAccount(v),
            )}
          </div>
        </fieldset>
      {/if}
      <button class="secondary" type="button" onclick={clearFilters}>Effacer les filtres</button>
    </div>
  </Sheet>

  <TagManageSheet bind:open={tagManageOpen} />
{/if}

{#if annotatingId !== null}
  <JournalSheet tradeId={annotatingId} onClose={() => (annotatingId = null)} />
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .count {
    margin: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .filters {
    display: grid;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .filters-sheet {
    display: grid;
    gap: var(--space-3);
  }
  .search input {
    width: 100%;
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 8px);
    background: var(--bg-elev);
    color: var(--fg);
    font: inherit;
  }
  .period-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  legend {
    font-weight: 600;
    font-size: var(--fs-sm);
    padding: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-sm);
  }
  .chip[aria-pressed='true'] {
    background: var(--accent-trading);
    border-color: var(--accent-trading);
    color: var(--accent-fg);
    font-weight: 700;
  }
  .chip.removable {
    background: var(--bg-sunken);
  }
  .chip.removable button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: inherit;
    font-size: var(--fs-md);
    line-height: 1;
  }
  .chip.removable button::before {
    content: '';
    position: absolute;
    inset: -6px;
  }
  .tag-chip {
    min-height: 22px;
    padding: 0 var(--space-2);
    font-size: var(--fs-xs);
  }
  .sheet-trigger {
    display: flex;
  }
  .active-chips {
    align-items: center;
  }
  .active-list {
    margin: 0 0 var(--space-2);
    padding-left: 1.2em;
  }
  .link {
    justify-self: start;
    color: var(--accent-trading);
    text-decoration: underline;
    background: none;
    border: 0;
    padding: 0;
    font-size: var(--fs-sm);
  }
  .summary p {
    margin: 0 0 var(--space-2);
  }
  .summary p:last-child {
    margin: var(--space-2) 0 0;
  }
  .trades {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .link-area {
    display: flex;
    flex: 1;
    min-width: 0;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    color: inherit;
    text-decoration: none;
  }
  .row:hover .link-area {
    color: var(--accent);
  }
  .annotate {
    flex-shrink: 0;
  }
  .main {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .main p {
    margin: 0;
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .dir {
    font-size: var(--fs-xs);
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--gain);
    color: var(--accent-fg);
  }
  .dir.short {
    background: var(--loss);
  }
  .badge {
    font-size: var(--fs-xs);
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--fg-muted);
  }
  .badge.open {
    border-color: var(--info);
    color: var(--info);
  }
  .badge.liq {
    border-color: var(--warn);
    color: var(--warn);
  }
  .badge.setup {
    border-color: var(--accent-trading);
    color: var(--accent-trading);
  }
  .badge.unannotated {
    border-color: var(--warn);
    color: var(--warn);
  }
  .thesis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 48ch;
  }
  .side {
    display: grid;
    gap: 2px;
    justify-items: end;
    text-align: right;
    flex-shrink: 0;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
