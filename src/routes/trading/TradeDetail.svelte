<script lang="ts">
  /**
   * Détail d'un trade : les chiffres viennent du moteur (jamais recalculés ici), le journal
   * appartient à l'utilisateur — thèse avant, revue après, setup, erreurs, note, plan
   * entrée / stop / objectif → R. Enregistrement explicite, effacement en vidant les champs.
   */
  import { onMount } from 'svelte';
  import { D, ZERO, type Big } from '$lib/domain/money';
  import {
    DEFAULT_MISTAKES,
    DEFAULT_SETUPS,
    emptyJournalEntry,
    riskOf,
    type JournalEntry,
    type TradePlan,
  } from '$lib/domain/trading/journal';
  import { fmtDateTime, fmtPct, fmtPrice, fmtQty } from '$lib/format/fr';
  import { addDays } from '$lib/history';
  import { router } from '$lib/router.svelte';
  import EvolutionChart, {
    type ChartLevel,
    type ChartMarker,
    type ChartPoint,
  } from '../../components/charts/EvolutionChart.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import Money from '../../components/shared/Money.svelte';
  import Qty from '../../components/shared/Qty.svelte';
  import TradingTabs from '../../components/trading/TradingTabs.svelte';
  import { app } from '../../state/app.svelte';
  import { history } from '../../state/history.svelte';
  import { toasts } from '../../state/ui.svelte';

  let { id }: { id: string } = $props();
  const found = $derived(app.tripOf(id));
  const money = (value: Big): Big | null =>
    found ? app.quoteToDisplay(found.trip.quote, value) : null;

  // Brouillon local du journal, rechargé (via l'$effect) quand on change de trade.
  let draft = $state<JournalEntry>(emptyJournalEntry(''));
  let planEntry = $state('');
  let planStop = $state('');
  let planTarget = $state('');
  let planRisk = $state('');
  $effect(() => {
    // Variable locale (pas de relecture de `draft`, sinon l'effet dépendrait de ce qu'il écrit).
    const saved = structuredClone($state.snapshot(app.journalOf(id)));
    draft = saved;
    planEntry = saved.plan?.entry ?? '';
    planStop = saved.plan?.stop ?? '';
    planTarget = saved.plan?.target ?? '';
    planRisk = saved.plan?.risk ?? '';
  });

  const DECIMAL = /^\d+(\.\d+)?$/;
  const clean = (raw: string): string | null => {
    const text = raw.trim().replace(',', '.');
    return DECIMAL.test(text) ? text : null;
  };
  const planOf = (): TradePlan | null => {
    const plan: TradePlan = {
      entry: clean(planEntry),
      stop: clean(planStop),
      target: clean(planTarget),
      risk: clean(planRisk),
    };
    return plan.entry === null && plan.stop === null && plan.target === null && plan.risk === null
      ? null
      : plan;
  };
  const previewRisk = $derived(found ? riskOf(found.trip, planOf()) : null);
  const previewR = $derived(
    found && found.trip.status === 'closed' && previewRisk !== null && previewRisk.gt(ZERO)
      ? found.trip.netPnl.div(previewRisk)
      : null,
  );

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  function save(): void {
    app.saveJournal({ ...structuredClone($state.snapshot(draft)), tradeId: id, plan: planOf() });
    toasts.push('Journal enregistré.', 'success');
  }

  // --- Graphique : prix quotidien de l'actif autour du trade, marqueurs d'entrées/sorties -------
  onMount(() => void history.ensure());
  const chartWindow = $derived.by((): { from: string; to: string } | null => {
    if (!found) return null;
    const from = addDays(found.trip.openedAt.slice(0, 10), -7);
    const to = addDays((found.trip.closedAt ?? found.trip.openedAt).slice(0, 10), 7);
    return { from, to };
  });
  const chartPoints = $derived.by((): ChartPoint[] => {
    if (!found || !chartWindow) return [];
    const series = history.histories[found.trip.symbol.toLowerCase()]?.points ?? [];
    const points: ChartPoint[] = [];
    for (const point of series) {
      if (point.day < chartWindow.from || point.day > chartWindow.to) continue;
      const rate = app.currency === 'EUR' ? '1' : app.fxLookup.rate(point.day);
      if (rate === null || !D(rate).gt(ZERO)) continue;
      points.push({
        day: point.day,
        primary: Number(D(point.priceEur).times(rate).toFixed(8)),
        secondary: null,
      });
    }
    return points;
  });
  const chartMarkers = $derived.by((): ChartMarker[] => {
    if (!found) return [];
    const trip = found.trip;
    if (trip.source === 'manual') {
      const markers: ChartMarker[] = [
        { day: trip.openedAt.slice(0, 10), kind: trip.direction === 'long' ? 'buy' : 'sell' },
      ];
      if (trip.closedAt)
        markers.push({
          day: trip.closedAt.slice(0, 10),
          kind: trip.direction === 'long' ? 'sell' : 'buy',
        });
      return markers;
    }
    const ids = new Set(trip.executionIds);
    return app.tradingReport.accounts
      .flatMap((a) => a.executions)
      .filter((x) => ids.has(x.id))
      .map((x) => ({ day: x.at.slice(0, 10), kind: x.side }));
  });

  /**
   * Niveaux de référence du graphique, comme sur la plateforme : entrée moyenne, prix de
   * liquidation (position encore ouverte), et les niveaux du plan (stop, objectif) s'ils sont
   * renseignés. Convertis dans la devise d'affichage comme la courbe.
   */
  const chartLevels = $derived.by((): ChartLevel[] => {
    if (!found) return [];
    const out: ChartLevel[] = [];
    const add = (raw: Big | string | null, label: string, tone: ChartLevel['tone']): void => {
      if (raw === null) return;
      const converted = app.quoteToDisplay(
        found.trip.quote,
        typeof raw === 'string' ? D(raw) : raw,
      );
      if (converted !== null && converted.gt(ZERO))
        out.push({ value: Number(converted.toFixed(8)), label, tone });
    };
    add(found.trip.avgEntry, 'entrée', 'info');
    if (found.trip.status === 'open') {
      const position = app.tradingReport.accounts
        .find((a) => a.accountId === found.trip.accountId)
        ?.snapshot?.positions.find((pos) => pos.symbol === found.trip.symbol);
      add(position?.liquidationPrice ?? null, 'liquidation', 'loss');
    }
    const plan = app.journalOf(id).plan;
    add(plan?.stop ?? null, 'stop', 'neutral');
    add(plan?.target ?? null, 'objectif', 'gain');
    return out;
  });

  function removeManual(): void {
    if (!found || found.trip.source !== 'manual') return;
    app.removeManualTrade(found.trip.id.replace(/^man:/, ''));
    toasts.push('Trade supprimé.', 'success');
    router.navigate({ name: 'trades' });
  }
</script>

<AppBar title="Trade" back={{ name: 'trades' }} />
<TradingTabs active="trades" />

{#if !found}
  <section class="card">
    <p class="muted">
      Trade introuvable — l'historique a pu changer depuis la dernière synchronisation.
    </p>
    <a href={router.href({ name: 'trades' })}>Retour aux trades</a>
  </section>
{:else}
  {@const t = found.trip}
  <section class="card top">
    <p class="title">
      <span class="dir {t.direction}">{t.direction === 'long' ? 'Long' : 'Short'}</span>
      <strong>{t.symbol}</strong>
      <span class="muted">× {fmtQty(t.qtyMax, { abbreviate: true })}</span>
      {#if t.status === 'open'}<span class="badge open">ouvert</span>{/if}
      {#if t.liquidated}<span class="badge liq">liquidation</span>{/if}
      {#if t.incomplete}<span class="badge">historique partiel</span>{/if}
    </p>
    <dl class="kpis">
      <div>
        <dt>P&L net</dt>
        <dd><Money value={money(t.netPnl)} sign colored strong /></dd>
      </div>
      <div>
        <dt>Brut</dt>
        <dd><Money value={money(t.grossPnl)} sign colored /></dd>
      </div>
      <div>
        <dt>Frais</dt>
        <dd><Money value={money(t.fees.neg())} sign colored /></dd>
      </div>
      <div>
        <dt>Funding</dt>
        <dd><Money value={money(t.funding)} sign colored /></dd>
      </div>
      {#if found.r}
        <div>
          <dt>R</dt>
          <dd class="num">{found.r.toFixed(2).replace('.', ',')}</dd>
        </div>
      {/if}
      {#if found.entrySlippage}
        <div>
          <dt>Écart d'entrée</dt>
          <dd class="num">{fmtPct(found.entrySlippage, { sign: true })}</dd>
        </div>
      {/if}
    </dl>
    <p class="muted small">
      {t.avgEntry
        ? `Entrée moyenne ${fmtPrice(t.avgEntry, 'USD')}`
        : 'Entrée inconnue (historique partiel)'}
      {#if t.avgExit}· sortie moyenne {fmtPrice(t.avgExit, 'USD')}{/if}
      · <Qty value={t.qtyClosed} /> clôturé{t.qtyClosed.eq(D('1')) ? '' : 's'} /
      <Qty value={t.qtyOpened} />
      · ouvert le {fmtDateTime(t.openedAt)}{t.closedAt
        ? `, clos le ${fmtDateTime(t.closedAt)}`
        : ''}
    </p>
    {#if t.source === 'manual'}
      <button class="link" type="button" onclick={removeManual}>Supprimer ce trade manuel</button>
    {/if}
  </section>

  {#if chartPoints.length >= 2}
    <section class="card chart">
      <h2>Prix de {t.symbol} autour du trade</h2>
      <EvolutionChart
        points={chartPoints}
        format="price"
        currency={app.currency}
        markers={chartMarkers}
        levels={chartLevels}
        colorMode="trend"
        labels={{ primary: 'Prix', secondary: null }}
        discreet={false}
      />
      <p class="muted small">
        Prix quotidien ({app.currency === 'EUR' ? 'EUR, taux BCE' : 'USD'}) sur la fenêtre du trade
        (± 7 jours) ; entrées et sorties en marqueurs, niveaux en pointillés (entrée moyenne,
        liquidation, stop et objectif du plan). Les prix d'exécution exacts sont dans l'onglet
        Fills.
      </p>
    </section>
  {/if}

  <form
    class="card journal"
    onsubmit={(e) => {
      e.preventDefault();
      save();
    }}
  >
    <h2>Journal</h2>
    <label class="field"
      >Pourquoi j'ai pris ce trade
      <textarea
        rows="3"
        bind:value={draft.thesis}
        placeholder="Thèse, contexte, signal… (écrit avant, relu après)"></textarea>
    </label>
    <fieldset>
      <legend>Setup</legend>
      <div class="chips">
        {#each DEFAULT_SETUPS as setup (setup)}
          <button
            type="button"
            class="chip"
            aria-pressed={draft.setup === setup}
            onclick={() => (draft.setup = draft.setup === setup ? null : setup)}>{setup}</button
          >
        {/each}
      </div>
    </fieldset>
    <fieldset class="plan">
      <legend>Plan (facultatif) — pour obtenir un résultat en R</legend>
      <div class="grid">
        <label class="field"
          >Entrée prévue
          <input type="text" inputmode="decimal" bind:value={planEntry} placeholder="ex. 105" />
        </label>
        <label class="field"
          >Stop
          <input type="text" inputmode="decimal" bind:value={planStop} placeholder="ex. 100" />
        </label>
        <label class="field"
          >Objectif
          <input type="text" inputmode="decimal" bind:value={planTarget} placeholder="ex. 120" />
        </label>
        <label class="field"
          >Risque ({t.quote})
          <input
            type="text"
            inputmode="decimal"
            bind:value={planRisk}
            placeholder="sinon |entrée − stop| × taille"
          />
        </label>
      </div>
      {#if previewRisk}
        <p class="muted small">
          Risque retenu : <Money value={money(previewRisk)} />{#if previewR}
            → <strong class="num">{previewR.toFixed(2).replace('.', ',')} R</strong>{/if}
        </p>
      {/if}
    </fieldset>
    <label class="field"
      >Revue (après)
      <textarea
        rows="3"
        bind:value={draft.review}
        placeholder="Ce qui a marché, ce qui n'a pas marché, ce que j'en retire"></textarea>
    </label>
    <fieldset>
      <legend>Erreurs relevées</legend>
      <div class="chips">
        {#each DEFAULT_MISTAKES as mistake (mistake)}
          <button
            type="button"
            class="chip"
            aria-pressed={draft.mistakes.includes(mistake)}
            onclick={() => (draft.mistakes = toggle(draft.mistakes, mistake))}>{mistake}</button
          >
        {/each}
      </div>
    </fieldset>
    <fieldset>
      <legend>Note d'exécution</legend>
      <div class="chips" role="radiogroup" aria-label="Note d'exécution sur 5">
        {#each [1, 2, 3, 4, 5] as n (n)}
          <button
            type="button"
            class="chip"
            role="radio"
            aria-checked={draft.rating === n}
            aria-label="{n} sur 5"
            onclick={() => (draft.rating = draft.rating === n ? null : (n as 1 | 2 | 3 | 4 | 5))}
            >{'★'.repeat(n)}</button
          >
        {/each}
      </div>
    </fieldset>
    <button class="primary" type="submit">Enregistrer le journal</button>
  </form>
{/if}

<style>
  .top,
  .chart {
    display: grid;
    gap: var(--space-3);
  }
  .chart h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--fs-lg);
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
  .kpis {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2) var(--space-3);
    margin: 0;
  }
  .kpis div {
    display: grid;
    gap: 2px;
  }
  .kpis dt {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .kpis dd {
    margin: 0;
    font-size: var(--fs-md);
  }
  .journal {
    display: grid;
    gap: var(--space-3);
  }
  .journal h2 {
    margin: 0;
  }
  .field {
    display: grid;
    gap: var(--space-1);
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  textarea,
  input {
    font: inherit;
    font-weight: 400;
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
    min-height: 36px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-sm);
  }
  .chip[aria-pressed='true'],
  .chip[aria-checked='true'] {
    background: var(--accent-trading);
    border-color: var(--accent-trading);
    color: var(--accent-fg);
    font-weight: 700;
  }
  .plan .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2) var(--space-3);
  }
  .primary {
    justify-self: start;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 700;
  }
  .link {
    justify-self: start;
    color: var(--loss);
    text-decoration: underline;
    background: none;
    border: 0;
    padding: 0;
    font-size: var(--fs-sm);
  }
  @media (min-width: 768px) {
    .kpis,
    .plan .grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
</style>
