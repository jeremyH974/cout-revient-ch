<script lang="ts">
  import type { PositionReport } from '$lib/domain/engine';
  import type { UnqualifiedEvent } from '$lib/domain/types';
  import { D, ZERO } from '$lib/domain/money';
  import { fmtDate, fmtRelative } from '$lib/format/fr';
  import { assetName } from '$lib/pricing/tickers';
  import { router } from '$lib/router.svelte';
  import { nowMs } from '$lib/clock';
  import AppBar from '../../components/layout/AppBar.svelte';
  import AssetRow from '../../components/portfolio/AssetRow.svelte';
  import QualifySheet from '../../components/portfolio/QualifySheet.svelte';
  import SummaryHeader from '../../components/portfolio/SummaryHeader.svelte';
  import EvolutionCard from '../../components/charts/EvolutionCard.svelte';
  import SelfChecks from '../../components/settings/SelfChecks.svelte';
  import Money from '../../components/shared/Money.svelte';
  import Qty from '../../components/shared/Qty.svelte';
  import { app } from '../../state/app.svelte';

  type SortKey = 'value' | 'total' | 'unrealizedPct' | 'realized' | 'asset';
  let query = $state('');
  let sort = $state<SortKey>('value');
  let qualifyOpen = $state(false);
  let qualifyEvent = $state<UnqualifiedEvent | null>(null);
  const openQualify = (e: UnqualifiedEvent): void => {
    qualifyEvent = e;
    qualifyOpen = true;
  };
  const rewards = $derived(app.events.filter((e) => e.kind === 'reward'));
  const QUALIFICATION_LABELS: Record<string, string> = {
    reward: 'récompense',
    deposit: 'dépôt',
    withdrawal: 'retrait',
    purchase: 'achat hors plateforme',
    sale: 'vente hors plateforme',
    trade: 'échange',
    ignore: 'ignorée',
  };

  const sorters: Record<SortKey, (a: PositionReport, b: PositionReport) => number> = {
    value: (a, b) => (b.value ?? ZERO).cmp(a.value ?? ZERO),
    total: (a, b) => (b.total ?? ZERO).cmp(a.total ?? ZERO),
    unrealizedPct: (a, b) => (b.unrealizedPct ?? ZERO).cmp(a.unrealizedPct ?? ZERO),
    realized: (a, b) => b.realized.cmp(a.realized),
    asset: (a, b) => a.asset.localeCompare(b.asset),
  };
  const matches = (p: PositionReport): boolean => {
    const q = query.trim().toLowerCase();
    return q === '' || p.asset.includes(q) || assetName(p.asset).toLowerCase().includes(q);
  };
  /** Filtre « par plateforme » : '' = vue consolidée (PRU global), sinon le rapport du compte seul. */
  let accountFilter = $state('');
  const filteredReport = $derived(
    accountFilter === '' ? app.report : (app.reportsByAccount.get(accountFilter) ?? app.report),
  );
  const filterLabel = $derived(app.accountLabels[accountFilter] ?? '');
  const positions = $derived([...filteredReport.positions].filter(matches).sort(sorters[sort]));
  const stablecoins = $derived(filteredReport.stablecoins.filter(matches));
  const closed = $derived(filteredReport.closed.filter(matches));
  // Une position « poussière » (résidu < 0,01 €) est clôturée, mais son latent résiduel compte
  // dans le P&L total : on l'affiche pour que la somme des sections retrouve l'en-tête.
  const closedTotal = $derived(closed.reduce((acc, p) => acc.plus(p.total ?? p.realized), ZERO));
  const residuals = $derived(closed.filter((p) => p.dust));
  const residualLatent = $derived(
    residuals.reduce((acc, p) => acc.plus(p.unrealized ?? ZERO), ZERO),
  );
  const lastImport = $derived(app.state.imports[app.state.imports.length - 1] ?? null);
</script>

<AppBar />
<SummaryHeader />
<EvolutionCard scope="portfolio" />

<div class="toolbar">
  <input
    type="search"
    placeholder="Rechercher un actif…"
    bind:value={query}
    aria-label="Rechercher un actif"
  />
  <label class="sort">
    <span class="sr-only">Trier par</span>
    <select bind:value={sort}>
      <option value="value">Valeur</option>
      <option value="total">P&L total</option>
      <option value="unrealizedPct">Latent %</option>
      <option value="realized">Réalisé</option>
      <option value="asset">Nom</option>
    </select>
  </label>
  {#if app.investAccounts.length > 1}
    <label class="sort">
      <span class="sr-only">Plateforme</span>
      <select bind:value={accountFilter} aria-label="Plateforme">
        <option value="">Toutes plateformes</option>
        {#each app.investAccounts as a (a.id)}
          <option value={a.id}>{a.label}</option>
        {/each}
      </select>
    </label>
  {/if}
</div>
{#if accountFilter !== ''}
  <p class="small muted scope-note">
    Positions de <strong>{filterLabel}</strong> seule : PRU et réalisé de cette plateforme. La synthèse
    ci-dessus reste consolidée (PRU global, toutes plateformes).
  </p>
{/if}

<section class="list">
  <div class="head" aria-hidden="true">
    <span>Actif</span><span>Quantité · PRU</span><span>Prix</span><span>Valeur</span><span
      >Latent</span
    ><span>Réalisé</span><span>Total</span>
  </div>
  {#if positions.length > 0}
    <ul class="rows" aria-label="Positions">
      {#each positions as p (p.asset)}
        <AssetRow position={p} />
      {/each}
    </ul>
  {:else}
    <p class="empty muted">Aucune position ouverte{query ? ' pour cette recherche' : ''}.</p>
  {/if}
</section>

{#if stablecoins.length > 0}
  <section class="list">
    <h2 class="section" id="stablecoins-title">
      Stablecoins <span class="muted small">— cash en attente, valorisé au cours de l'euro</span>
    </h2>
    <ul class="rows" aria-labelledby="stablecoins-title">
      {#each stablecoins as p (p.asset)}
        <AssetRow position={p} />
      {/each}
    </ul>
  </section>
{/if}

{#if app.report.blocked.length > 0}
  <section class="list alert">
    <h2 class="section">Historique d'achat manquant</h2>
    {#each app.report.blocked as p (p.asset)}
      <a class="line" href={router.href({ name: 'asset', asset: p.asset })}
        ><strong>{p.asset.toUpperCase()}</strong> <span class="small">{p.warnings[0]}</span></a
      >
    {/each}
  </section>
{/if}

{#if app.report.unqualified.length > 0}
  <section class="list alert">
    <h2 class="section">À qualifier ({app.report.unqualified.length})</h2>
    <p class="small muted">
      Coinhouse a exporté des lignes que l'outil ne sait pas interpréter seul. Dites ce qu'elles
      représentent : les chiffres se recalculent aussitôt, et vous pouvez annuler à tout moment.
    </p>
    {#each app.report.unqualified as e (e.id)}
      <div class="line small unqualified">
        <span>
          {fmtDate(e.at)} · {e.rawType} ·
          {#each e.legs as l, i (l.asset + i)}{#if i > 0}&nbsp;/
            {/if}<Qty value={D(l.signedQty)} asset={l.asset} sign />{/each}
          {#if app.lineNumbersOf(e.rowKeys).length > 0}<span class="muted">
              · ligne {app.lineNumbersOf(e.rowKeys).join(', ')}</span
            >{/if}
          <span class="muted">— {e.reason}</span>
        </span>
        <button class="secondary small-btn" type="button" onclick={() => openQualify(e)}
          >Qualifier</button
        >
      </div>
    {/each}
  </section>
{/if}

{#if app.qualified.length > 0}
  <section class="list">
    <h2 class="section">Qualifications enregistrées ({app.qualified.length})</h2>
    {#each app.qualified as q (q.eventId)}
      <div class="line small unqualified">
        <span>
          {q.at ? fmtDate(q.at) : '—'} · {q.rawType ?? q.eventId} → {QUALIFICATION_LABELS[
            q.qualification.kind
          ] ?? q.qualification.kind}
          {#if q.lineNumbers.length > 0}<span class="muted">
              · ligne {q.lineNumbers.join(', ')}</span
            >{/if}
        </span>
        <button
          class="link"
          type="button"
          onclick={() => app.qualify(q.eventId, null)}
          aria-label="Annuler la qualification de l'opération du {q.at ? fmtDate(q.at) : '?'}"
          >Annuler</button
        >
      </div>
    {/each}
  </section>
{/if}

{#if rewards.length > 0}
  <section class="list">
    <h2 class="section">Revenus (récompenses) ({rewards.length})</h2>
    <p class="small muted">
      {app.state.engineSettings.rewardValuation === 'fair-value'
        ? 'Comptées à leur valeur du jour (réglage « Récompenses »), donc dans le P&L.'
        : 'Comptées à 0 € de coût (réglage « Récompenses ») : leur valeur apparaît quand vous les vendez.'}
    </p>
    {#each rewards as r (r.id)}
      {#if r.kind === 'reward'}
        <p class="line small">
          {fmtDate(r.at)} · <Qty value={D(r.in.qty)} asset={r.in.asset} sign />
          {#if r.fairValueEur}<span class="muted">· valeur <Money value={D(r.fairValueEur)} /></span
            >{/if}
        </p>
      {/if}
    {/each}
  </section>
{/if}

<QualifySheet bind:open={qualifyOpen} event={qualifyEvent} />

{#if closed.length > 0 && !app.state.ui.hideClosed}
  <details class="list">
    <summary class="section"
      >Positions clôturées ({closed.length}) <Money
        value={closedTotal}
        sign
        colored
      />{#if residuals.length > 0}
        <span class="small">dont résidus <Money value={residualLatent} sign colored /></span
        >{/if}</summary
    >
    {#each closed as p (p.asset)}
      <a class="line" href={router.href({ name: 'asset', asset: p.asset })}>
        <strong>{p.asset.toUpperCase()}</strong>
        <span class="muted small">{assetName(p.asset)}</span>
        <span class="grow"></span>
        {#if p.dust}
          <span class="muted small"
            >réalisé <Money value={p.realized} sign /> · résidu <Qty
              value={p.qty}
              asset={p.asset}
              abbreviate
            /> latent <Money value={p.unrealized} sign colored /> ·</span
          >
        {/if}
        <Money value={p.total ?? p.realized} sign colored />
      </a>
    {/each}
  </details>
{/if}

<footer class="foot muted small">
  {#if lastImport}Dernier import : {fmtRelative(lastImport.at, nowMs())} ({lastImport.fileName}) ·
  {/if}
  Sauvegarde : {app.state.ui.lastBackupAt
    ? fmtRelative(app.state.ui.lastBackupAt, nowMs())
    : 'jamais ⚠'} ·
  <a href={router.href({ name: 'import' })}>Ré-importer</a> ·
  <a href={router.href({ name: 'report' })}>Rapport PDF</a> ·
  <a href={router.href({ name: 'settings' })} class="checks-link"><SelfChecks compact /></a>
</footer>

<style>
  .toolbar {
    display: flex;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-2);
  }
  input[type='search'],
  select {
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    padding: 0 var(--space-3);
  }
  input[type='search'] {
    flex: 1;
    min-width: 0;
  }
  .list {
    margin: 0 0 var(--space-3);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .head {
    display: none;
  }
  .section {
    font-size: var(--fs-sm);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    padding: var(--space-3) var(--space-4) var(--space-1);
    cursor: pointer;
  }
  .small {
    font-size: var(--fs-xs);
    text-transform: none;
    letter-spacing: 0;
  }
  .empty {
    padding: var(--space-5) var(--space-4);
    text-align: center;
  }
  .line {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-2) var(--space-4);
    color: inherit;
    text-decoration: none;
    min-height: var(--tap);
    border-bottom: 1px solid var(--border);
  }
  .grow {
    flex: 1;
  }
  .scope-note {
    margin: 0 0 var(--space-2);
  }
  .unqualified {
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .unqualified > span:first-child {
    flex: 1 1 240px;
  }
  .small-btn {
    min-height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    color: var(--accent);
    font-weight: 600;
    white-space: nowrap;
  }
  .alert .section {
    color: var(--warn);
  }
  .foot {
    padding: var(--space-4);
    text-align: center;
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
</style>
