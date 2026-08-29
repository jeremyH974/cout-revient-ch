<script lang="ts">
  /**
   * Tableau de bord (décision n° 56). Il **compose** les rapports des espaces, ne recalcule rien,
   * et n'additionne que des soldes — jamais des résultats de nature différente.
   *
   * Trois règles de composition, dans cet ordre, tirées de l'ISO 24896:2026 (notation pour le
   * reporting d'entreprise) et de sa formule SUCCESS :
   *
   * 1. **Un seul chiffre domine** — le patrimoine — et un seul contexte de temps gouverne l'écran
   *    entier : la période choisie en haut pilote la variation, la courbe et la répartition. Deux
   *    fenêtres différentes sur un même écran, c'est deux réponses à la même question.
   * 2. **Aucun chiffre n'est écrit deux fois.** La version précédente affichait la valeur
   *    d'investissement à trois endroits et l'équité de trading à deux ; chaque répétition était
   *    une occasion de diverger, et aucune n'ajoutait d'information.
   * 3. **La couleur est réservée aux variances** (composant `Delta`). Un niveau reste neutre. Un
   *    écran où tout est coloré ne hiérarchise plus rien.
   *
   * Et une règle qui vient du projet, pas d'une norme : **rien ne s'affiche qui ne se réconcilie
   * pas**. La carte « D'où vient ce chiffre » pose l'identité `apports nets + résultat =
   * patrimoine`, la déplie espace par espace, et une auto-vérification échoue si la somme des
   * parts cesse de refaire le tout.
   */
  import { onMount } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { ZERO, type Big } from '$lib/domain/money';
  import { displayGap, fmtDate } from '$lib/format/fr';
  import { FEAR_GREED_ATTRIBUTION } from '$lib/pricing/fear-greed';
  import { insightsToText, renderInsights } from '$lib/format/insights';
  import { periodWindow, sliceSeries, todayOf, type Period } from '$lib/history';
  import { netWorthChange, netWorthPartChanges } from '$lib/history/net-worth';
  import { router } from '$lib/router.svelte';
  import NetWorthCard from '../components/charts/NetWorthCard.svelte';
  import PeriodToggle from '../components/charts/PeriodToggle.svelte';
  import ShareSheet from '../components/shared/ShareSheet.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import Delta from '../components/shared/Delta.svelte';
  import Info from '../components/shared/Info.svelte';
  import InsightList from '../components/shared/InsightList.svelte';
  import Money from '../components/shared/Money.svelte';
  import PriceFreshness from '../components/shared/PriceFreshness.svelte';
  import { app } from '../state/app.svelte';
  import { checks as selfChecks } from '../state/checks.svelte';
  import { history } from '../state/history.svelte';
  import { toasts } from '../state/ui.svelte';

  const t = $derived(app.report.totals);
  const openCount = $derived(app.report.positions.length + app.report.stablecoins.length);
  let sharing = $state(false);
  /**
   * Pas de « 1J » : la série de patrimoine est quotidienne, une fenêtre d'un jour n'y contient que
   * deux points et donnerait une variation qui n'en est pas une.
   */
  let period = $state<Period>('1m');
  const PERIOD_LABEL: Record<Period, string> = {
    '1d': 'sur 1 jour',
    '1w': 'sur 1 semaine',
    '1m': 'sur 1 mois',
    '3m': 'sur 3 mois',
    '1y': 'sur 1 an',
    all: 'depuis le début',
  };

  const trading = $derived(app.tradingReport);
  /** Équité de trading dans la devise d'affichage ; `null` tant qu'aucun taux USD n'est connu. */
  const tradingEquity = $derived(app.hasTrading ? app.usdcToDisplay(trading.equity) : null);
  /** Patrimoine = valeur des positions + équité de trading (des soldes, jamais des P&L). */
  const netWorth = $derived(
    tradingEquity === null ? t.value : (t.value?.plus(tradingEquity) ?? tradingEquity),
  );

  onMount(() => void history.ensure());
  // Le contexte n'est chargé que si l'opt-in réseau est coché ; l'appel est idempotent.
  $effect(() => {
    if (app.state.ui.marketContext && app.marketContext === null) void app.refreshMarketContext();
  });

  const today = $derived(todayOf(nowMs()));
  const window = $derived(periodWindow(period, today));
  const series = $derived(history.netWorth);
  const visible = $derived(
    sliceSeries(series, { from: window.from ?? series[0]?.day ?? today, to: window.to }),
  );
  /** « Tout » part de zéro la veille du premier jour : sinon les apports du premier jour manquent. */
  const fromInception = $derived(period === 'all');
  const change = $derived(netWorthChange(visible, { fromInception }));
  const partChanges = $derived(netWorthPartChanges(visible, { fromInception }));
  /** Photo du dernier jour : apports nets, patrimoine et l'écart entre les deux, par espace. */
  const reconciliation = $derived(selfChecks.reconciliation);
  /**
   * Résultat rapporté aux apports : le seul « ROI » qui ait un sens sur le périmètre entier, parce
   * que son dénominateur est l'argent réellement versé et non l'assiette de coût du moment. `null`
   * si rien n'a été apporté (division impossible, jamais un zéro de complaisance).
   */
  const gainRatio = $derived.by((): Big | null => {
    if (!reconciliation || !reconciliation.contributed.gt(ZERO)) return null;
    return reconciliation.gain.div(reconciliation.contributed);
  });

  const insights = $derived(
    renderInsights(app.insights, {
      discreet: app.state.ui.discreet,
      currency: app.currency,
    }),
  );
  /** Le constat de plus haute priorité est promu en message ; la liste reprend à partir du second. */
  const headline = $derived(insights[0] ?? null);
  const HEADLINE_MARK = { positive: '▲', negative: '▼', neutral: '•', attention: '!' } as const;
  const INSIGHTS_ON_OVERVIEW = 5;

  /** Libellés français des bandes publiées par la source (jamais traduits en conseil). */
  const FEAR_GREED_LABELS = {
    'extreme-fear': 'peur extrême',
    fear: 'peur',
    neutral: 'neutre',
    greed: 'avidité',
    'extreme-greed': 'avidité extrême',
    unknown: 'non classé',
  } as const;

  async function copyInsights(): Promise<void> {
    try {
      await navigator.clipboard.writeText(insightsToText(insights));
      toasts.push('Constats copiés : collez-les où vous voulez.', 'success');
    } catch {
      toasts.push('Copie impossible dans ce navigateur.', 'error');
    }
  }

  // Mêmes contrôles que les réglages, montés une seule fois (`state/checks.svelte.ts`).
  const checks = $derived(selfChecks.actionable);
  const blocking = $derived(selfChecks.blocking);

  /** Part d'un espace dans le patrimoine, en pourcentage affichable ; `null` si le total est nul. */
  function shareOf(value: Big): number | null {
    const total = reconciliation?.net ?? null;
    if (total === null || !total.gt(ZERO)) return null;
    return Number(value.div(total).times('100').toFixed(1));
  }
  function changeOf(id: string) {
    return partChanges.find((c) => c.id === id) ?? null;
  }
  const HREF_OF: Record<string, { name: 'portfolio' } | { name: 'trading' }> = {
    invest: { name: 'portfolio' },
  };
  const routeOf = (id: string) => router.href(HREF_OF[id] ?? { name: 'trading' });
</script>

<AppBar title="Vue d'ensemble" />

{#snippet verify()}
  <section class="card verify" class:blocking aria-labelledby="verify-title">
    <h2 id="verify-title">À vérifier</h2>
    <ul class="checks">
      {#each checks as check (check.id)}
        <li class={check.level}>
          <span class="mark" aria-hidden="true">{check.level === 'fail' ? '!' : '·'}</span>
          <span>
            <strong>{check.label}</strong> — {check.detail}
            {#if check.action}<span class="muted">{check.action}</span>{/if}
          </span>
        </li>
      {/each}
    </ul>
    <p class="small">
      <a href={router.href({ name: 'reconciliation' })}>Voir la réconciliation complète</a>
    </p>
  </section>
{/snippet}

<!-- 1. Le chiffre, sa variation, et la période qui gouverne tout l'écran. -->
<section class="card hero" aria-labelledby="hero-title">
  <div class="hero-head">
    <h2 id="hero-title" class="label">
      <span>Patrimoine</span>
      <Info title="Patrimoine"
        >Valeur des positions d'investissement (dernier prix connu) + équité de trading (compte
        perps, USDC au taux BCE du jour). On additionne des soldes — jamais des résultats de nature
        différente.</Info
      >
    </h2>
    <PeriodToggle bind:value={period} available={['1w', '1m', '3m', '1y', 'all']} />
  </div>

  <p class="display" data-testid="net-worth-hero"><Money value={netWorth} strong /></p>

  {#if change}
    <p class="variance">
      <Delta value={change.gain} pct={change.pct} suffix={PERIOD_LABEL[period]} size="lg" />
      <span class="muted small">hors apports</span>
    </p>
  {:else if app.hasData}
    <p class="muted small">Variation en attente de l'historique des prix.</p>
  {/if}

  {#if headline}
    <!-- « Convey a message » : une phrase, tirée des données, avant les tableaux. -->
    <p class="headline {headline.tone}">
      <span class="mark" aria-hidden="true">{HEADLINE_MARK[headline.tone]}</span>
      <span><strong>{headline.title}</strong> — {headline.detail}</span>
    </p>
  {/if}

  <div class="hero-foot">
    <!-- Fraîcheur ET source : la barre d'application n'affiche que la première, or l'attribution
         du fournisseur de cours doit rester visible là où les montants le sont. Le bouton
         « Actualiser », lui, existe déjà dans la barre : il n'est pas repris ici. -->
    <PriceFreshness />
    <div class="actions">
      <button class="tool" type="button" onclick={() => (sharing = true)} disabled={!app.hasData}>
        Partager
      </button>
    </div>
  </div>
  {#if app.hasTrading && tradingEquity === null}
    <p class="muted small">
      Taux de change en cours de chargement : équité de trading non comptée.
    </p>
  {/if}
</section>

{#if blocking}{@render verify()}{/if}

<!-- 2. La réconciliation : trois lignes qui expliquent le chiffre du dessus. -->
{#if reconciliation}
  <section class="card recon" aria-labelledby="recon-title">
    <h2 id="recon-title">D'où vient ce chiffre</h2>
    <dl class="bridge">
      <div>
        <dt>Apports nets</dt>
        <dd><Money value={reconciliation.contributed} /></dd>
      </div>
      <div>
        <dt>Résultat total</dt>
        <!-- L'écart des montants AFFICHÉS : les trois lignes doivent s'additionner sous les yeux
             du lecteur, sinon la carte prouve l'inverse de ce qu'elle affirme. -->
        <dd>
          <Delta
            value={displayGap(reconciliation.net, reconciliation.contributed)}
            pct={gainRatio}
          />
        </dd>
      </div>
      <div class="sum">
        <dt>Patrimoine</dt>
        <dd><Money value={reconciliation.net} strong /></dd>
      </div>
    </dl>
    <p class="muted small">
      Vos apports nets sont l'argent <strong>entré dans le périmètre</strong> moins celui qui en est
      sorti — pas le coût de vos positions. L'écart avec le patrimoine est donc votre résultat
      complet, réalisé et latent confondus, au {fmtDate(reconciliation.day)}.
    </p>

    {#if reconciliation.lines.length > 1}
      <details>
        <summary>Détail par espace</summary>
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Espace</th>
                <th scope="col">Apports nets</th>
                <th scope="col">Valeur</th>
                <th scope="col">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {#each reconciliation.lines as line (line.id)}
                <tr>
                  <th scope="row">{line.label}</th>
                  <td><Money value={line.contributed} /></td>
                  <td>
                    <Money value={line.value} />
                    {#if line.unavailable}<span class="muted small">non valorisé</span>{/if}
                  </td>
                  <td><Delta value={displayGap(line.value, line.contributed)} /></td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td><Money value={reconciliation.contributed} /></td>
                <td><Money value={reconciliation.net} strong /></td>
                <td><Delta value={displayGap(reconciliation.net, reconciliation.contributed)} /></td
                >
              </tr>
            </tfoot>
          </table>
        </div>
        <p class="muted small">
          Le capital envoyé de l'Investissement au Trading sort d'un côté et entre de l'autre : il
          n'ajoute rien au total et ne compte donc jamais comme un gain.
        </p>
      </details>
    {/if}
  </section>
{/if}

<!-- 3. La courbe, sur la même période que le bandeau. -->
{#if app.hasData}
  <NetWorthCard {period} />
  <ShareSheet bind:open={sharing} {netWorth} total={t.total} />
{/if}

<!-- 4. La répartition : une ligne par espace, sa part, ce qu'il a produit sur la période. -->
{#if reconciliation && reconciliation.lines.length > 0}
  <section class="card spaces" aria-labelledby="spaces-title">
    <h2 id="spaces-title">Répartition</h2>
    {#if reconciliation.net.gt(ZERO)}
      <div
        class="bar"
        role="img"
        aria-label={'Répartition : ' +
          reconciliation.lines.map((l) => `${l.label} ${shareOf(l.value) ?? 0} %`).join(', ')}
      >
        {#each reconciliation.lines as line (line.id)}
          <span
            class={line.id === 'invest' ? 'invest' : 'trading'}
            style="width: {shareOf(line.value) ?? 0}%"
          ></span>
        {/each}
      </div>
    {/if}
    <ul class="rows">
      {#each reconciliation.lines as line (line.id)}
        {@const share = shareOf(line.value)}
        {@const moved = changeOf(line.id)}
        <li class={line.id === 'invest' ? 'invest' : 'trading'}>
          <a href={routeOf(line.id)}>
            <span class="name">{line.label}</span>
            <span class="amount"><Money value={line.value} /></span>
            <span class="share muted"
              >{share === null ? '—' : `${share.toLocaleString('fr-FR')} %`}</span
            >
            <span class="moved">
              {#if moved}<Delta value={moved.gain} suffix={PERIOD_LABEL[period]} size="sm" />{/if}
            </span>
            <span class="go" aria-hidden="true">→</span>
          </a>
          <p class="muted small sub">
            {#if line.id === 'invest'}
              {openCount} position{openCount > 1 ? 's' : ''} · PRU, plus-values, lots
            {:else}
              {trading.totals.fills} fill{trading.totals.fills > 1 ? 's' : ''} · journal, statistiques
            {/if}
            {#if moved && !moved.contributions.eq(ZERO)}
              · apports <Delta value={moved.contributions} size="sm" />
              {PERIOD_LABEL[period]}
            {/if}
          </p>
        </li>
      {/each}
    </ul>
    {#if reconciliation.lines.length > 1}
      <p class="muted small">
        Un virement d'un espace vers l'autre déplace les deux valeurs sans rien produire : il
        apparaît en apports, jamais en résultat.
      </p>
    {/if}
  </section>
{/if}

{#if !app.hasTrading}
  <a class="card discover" href={router.href({ name: 'trading' })}>
    <h2>Espace Trading</h2>
    <p class="muted small">
      Import Hyperliquid en lecture seule (adresse publique), saisie manuelle d'un trade, espérance
      en R, taux de réussite, drawdown.
    </p>
    <span class="go">Découvrir l'espace Trading →</span>
  </a>
{/if}

<!-- 5. Les constats restants (le premier est déjà en tête d'écran). -->
{#if insights.length > 1}
  <section class="card insights" aria-labelledby="insights-title">
    <div class="tools">
      <h2 id="insights-title">Constats</h2>
      <button class="tool" type="button" onclick={copyInsights}>Copier</button>
    </div>
    <InsightList insights={insights.slice(1, 1 + INSIGHTS_ON_OVERVIEW)} />
    <p class="muted small">
      Des observations chiffrées tirées de vos données — jamais un conseil d'achat ou de vente.
      {#if insights.length > 1 + INSIGHTS_ON_OVERVIEW}
        <a href={router.href({ name: 'report' })}>Voir les {insights.length} constats</a>
      {:else}
        <a href={router.href({ name: 'report' })}>Le détail est dans le rapport</a>
      {/if}
    </p>
  </section>
{/if}

{#if app.unreadAlertCount > 0}
  <section class="card price-alerts">
    <h2>Alertes de prix</h2>
    <p class="small">
      {app.unreadAlertCount} déclenchement{app.unreadAlertCount > 1 ? 's' : ''} depuis votre dernière
      visite.
      <a href={router.href({ name: 'alerts' })}>Ouvrir le centre d’alertes</a>
    </p>
  </section>
{/if}

{#if app.state.ui.marketContext && app.marketContext}
  {@const fg = app.marketContext}
  <section class="card context" aria-labelledby="context-title">
    <h2 id="context-title">Contexte de marché</h2>
    <div class="gauge">
      <div class="track" role="img" aria-label="Indice Fear & Greed : {fg.value} sur 100">
        <span class="fill" style="width: {fg.value}%"></span>
      </div>
      <p class="value"><strong>{fg.value}</strong> / 100 · {FEAR_GREED_LABELS[fg.band]}</p>
    </div>
    <p class="muted small">
      Indice de sentiment du marché crypto au {fmtDate(fg.day)}, source
      <strong>{FEAR_GREED_ATTRIBUTION}</strong>. Il décrit l'humeur du marché entier, pas votre
      portefeuille — et ne dit pas quoi en faire.
    </p>
  </section>
{/if}

{#if !blocking && checks.length > 0}{@render verify()}{/if}

<p class="links small">
  <a href={router.href({ name: 'report' })}>Rapport PDF</a> ·
  <a href={router.href({ name: 'alerts' })}>Alertes de prix</a> ·
  <a href={router.href({ name: 'import' })}>Importer un export</a> ·
  <a href={router.href({ name: 'add' })}>Ajouter une opération</a>
</p>

<style>
  /* Rythme commun : chaque bloc de premier niveau respire de la même façon. */
  section,
  .discover {
    padding: var(--space-4);
    margin-bottom: var(--space-3);
    display: grid;
    gap: var(--space-3);
    align-content: start;
    container-type: inline-size;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .small {
    font-size: var(--fs-sm);
  }
  .muted {
    color: var(--fg-muted);
  }

  /* 1. Héros ---------------------------------------------------------------- */
  .hero {
    gap: var(--space-2);
  }
  .hero-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }
  .label {
    font-size: var(--fs-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: 0;
  }
  .display {
    font-size: var(--fs-display);
    font-weight: 700;
    line-height: 1.05;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .variance {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
  }
  .headline {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    margin: var(--space-1) 0 0;
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: var(--bg-sunken);
    font-size: var(--fs-sm);
    text-wrap: pretty;
  }
  .headline.positive {
    border-left-color: var(--gain);
  }
  .headline.negative {
    border-left-color: var(--loss);
  }
  .headline.attention {
    border-left-color: var(--warn);
  }
  .headline .mark {
    font-size: var(--fs-xs);
    line-height: 1;
    color: var(--fg-muted);
  }
  .hero-foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin-top: var(--space-1);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .tool {
    min-height: 40px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .tool:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .tool:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  /* 2. Réconciliation ------------------------------------------------------- */
  .bridge {
    display: grid;
    gap: var(--space-2);
    margin: 0;
  }
  .bridge > div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--fs-sm);
  }
  .bridge dt {
    color: var(--fg-muted);
  }
  .bridge dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .bridge .sum {
    border-top: 1px solid var(--border);
    padding-top: var(--space-2);
    font-size: var(--fs-md);
  }
  .bridge .sum dt {
    color: var(--fg);
    font-weight: 600;
  }
  summary {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--accent);
    cursor: pointer;
    min-height: var(--tap);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    list-style: none;
  }
  /* Marqueur explicite : le triangle natif disparaît dès qu'on met `display: flex` sur summary. */
  summary::-webkit-details-marker {
    display: none;
  }
  summary::before {
    content: '▸';
    font-size: var(--fs-xs);
    line-height: 1;
  }
  details[open] > summary::before {
    content: '▾';
  }
  details > :global(*:not(summary)) {
    margin-top: var(--space-2);
  }
  /* Un tableau ne doit jamais élargir la page : il défile dans sa propre boîte. */
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  th,
  td {
    text-align: right;
    padding: var(--space-2) var(--space-2);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  thead th,
  tbody th,
  tfoot th {
    text-align: left;
  }
  thead th {
    font-weight: 600;
    color: var(--fg-muted);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  tbody tr + tr th,
  tbody tr + tr td,
  tfoot th,
  tfoot td {
    border-top: 1px solid var(--border);
  }
  tfoot th {
    font-weight: 600;
  }

  /* 4. Répartition ---------------------------------------------------------- */
  .bar {
    display: flex;
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-sunken);
  }
  .bar .invest {
    background: var(--accent-invest);
  }
  .bar .trading {
    background: var(--accent-trading);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .rows > li {
    border-left: 3px solid var(--accent-invest);
    padding-left: var(--space-3);
  }
  .rows > li.trading {
    border-left-color: var(--accent-trading);
  }
  /*
   * Deux dispositions, décidées sur la largeur de la CARTE et non de la fenêtre (container query,
   * « Baseline widely available » depuis 2025) : sur une carte étroite, le nom et le montant se
   * lisent d'abord, la part et la variation dessous ; dès qu'il y a de la place, tout tient sur
   * une ligne. Les zones nommées évitent qu'un élément — la flèche, en l'occurrence — se retrouve
   * seul sur une troisième ligne quand la grille reflue.
   */
  .rows a {
    display: grid;
    grid-template-columns: 1fr auto auto;
    grid-template-areas:
      'name  amount amount'
      'moved share  go';
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    color: inherit;
    text-decoration: none;
    min-height: var(--tap);
    align-content: center;
  }
  .rows a:hover .name {
    text-decoration: underline;
  }
  .name {
    grid-area: name;
    font-weight: 600;
  }
  .amount {
    grid-area: amount;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .share {
    grid-area: share;
    text-align: right;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }
  .moved {
    grid-area: moved;
  }
  .go {
    grid-area: go;
  }
  @container (min-width: 34rem) {
    .rows a {
      grid-template-columns: 1fr auto 4rem auto auto;
      grid-template-areas: 'name amount share moved go';
    }
  }
  .rows .go,
  .discover .go {
    color: var(--accent);
    font-weight: 600;
  }
  .sub {
    margin: 0 0 var(--space-1);
  }
  .discover {
    color: inherit;
    text-decoration: none;
    border-left: 4px solid var(--accent-trading);
  }

  /* 5. Constats, alertes, contexte ------------------------------------------ */
  .tools {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }
  .price-alerts {
    border-left: 4px solid var(--accent-invest);
  }
  .gauge {
    display: grid;
    gap: var(--space-1);
  }
  .track {
    height: 10px;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--loss), var(--warn), var(--gain));
    position: relative;
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-right: 3px solid var(--fg);
  }
  .context .value {
    font-size: var(--fs-sm);
    margin: 0;
  }

  /* 6. À vérifier ------------------------------------------------------------ */
  .verify.blocking {
    border-left: 4px solid var(--loss);
  }
  .checks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
    font-size: var(--fs-sm);
  }
  .checks > li {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    text-wrap: pretty;
  }
  .checks .mark {
    font-weight: 700;
    line-height: 1;
    color: var(--warn);
  }
  .checks li.fail .mark {
    color: var(--loss);
  }
  .links {
    text-align: center;
    color: var(--fg-muted);
  }
</style>
