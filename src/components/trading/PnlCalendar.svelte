<script lang="ts">
  /**
   * Calendrier de P&L (P22) : grille du P&L réalisé net, façon TradeZella — cases teintées
   * gain/perte, navigation, case cliquable. Trois mailles au choix (décision n° 95) : **jour**
   * (un mois de jours, totaux hebdomadaires, jour cliquable pour voir les trades concernés),
   * **mois** (les 12 mois d'une année) et **année** (une case par année). Les deux mailles larges
   * redescendent d'un cran au clic — l'année ouvre ses mois, le mois ouvre ses jours.
   *
   * Chaque montant est rattaché au jour où la plateforme l'a réalisé (fill, frais, funding), pas
   * au jour de clôture de l'aller-retour : c'est la règle de l'exchange et celle du tableau de
   * bord. Tout le calcul vient du moteur pur (`$lib/domain/trading/calendar`), qui additionne les
   * trois mailles au même endroit ; ce composant affiche et gère la sélection, rien de plus.
   */
  import { nowIso } from '$lib/clock';
  import { ZERO, type Big } from '$lib/domain/money';
  import {
    activeMonths,
    activeYears,
    calendarMonth,
    calendarMonths,
    calendarYears,
    type CalendarBucket,
    type CalendarDay,
    type CalendarGrain,
    type RealizedEvent,
  } from '$lib/domain/trading/calendar';
  import type { JournaledTrip } from '$lib/domain/trading/journal';
  import { fmtDate, fmtMasked, fmtMoney, roundsToZero } from '$lib/format/fr';
  import { router } from '$lib/router.svelte';
  import { app } from '../../state/app.svelte';
  import Money from '../shared/Money.svelte';

  let { trips, events }: { trips: JournaledTrip[]; events: RealizedEvent[] } = $props();

  const toDisplay = (quote: string, value: Big): Big | null => app.quoteToDisplay(quote, value);

  const MONTH_NAMES = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ];
  /** Abréviations d'usage en français ; le nom entier reste dans l'`aria-label` de la case. */
  const MONTH_SHORT = [
    'janv.',
    'févr.',
    'mars',
    'avril',
    'mai',
    'juin',
    'juil.',
    'août',
    'sept.',
    'oct.',
    'nov.',
    'déc.',
  ];
  const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const monthName = (m: string): string => MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? '?';
  const monthShort = (m: string): string => MONTH_SHORT[Number(m.slice(5, 7)) - 1] ?? '?';

  const GRAINS: { id: CalendarGrain; label: string }[] = [
    { id: 'day', label: 'Jour' },
    { id: 'month', label: 'Mois' },
    { id: 'year', label: 'Année' },
  ];
  let grain = $state<CalendarGrain>('day');

  const today = nowIso().slice(0, 7);
  const thisYear = today.slice(0, 4);
  const months = $derived(activeMonths(events));
  const years = $derived(activeYears(events));
  // Initialisation unique (volontairement pas un `$derived`) : on ne veut pas ramener
  // l'utilisateur au dernier mois actif à chaque nouvelle synchronisation pendant qu'il navigue.
  // svelte-ignore state_referenced_locally
  let month = $state(months.at(-1) ?? today);
  // svelte-ignore state_referenced_locally
  let year = $state(years.at(-1) ?? thisYear);
  const minMonth = $derived(months[0] ?? today);
  const minYear = $derived(years[0] ?? thisYear);
  const canPrev = $derived(grain === 'day' ? month > minMonth : year > minYear);
  const canNext = $derived(grain === 'day' ? month < today : year < thisYear);

  function shiftMonth(value: string, delta: number): string {
    const [y, m] = value.split('-').map(Number) as [number, number];
    const total = y * 12 + (m - 1) + delta;
    const shifted = Math.floor(total / 12);
    const monthNum = total - shifted * 12 + 1;
    return `${shifted}-${String(monthNum).padStart(2, '0')}`;
  }
  /** Recule ou avance d'un cran dans la maille affichée : un mois en maille jour, un an sinon. */
  function shift(delta: number): void {
    if (delta < 0 ? !canPrev : !canNext) return;
    if (grain === 'day') month = shiftMonth(month, delta);
    else year = String(Number(year) + delta);
    selectedDay = null;
  }
  function setGrain(next: CalendarGrain): void {
    grain = next;
    selectedDay = null;
  }
  /** Descente d'un cran : une année ouvre ses mois, un mois ouvre ses jours. */
  function drillInto(bucket: CalendarBucket): void {
    if (bucket.count === 0) return;
    if (grain === 'year') year = bucket.key;
    else month = bucket.key;
    setGrain(grain === 'year' ? 'month' : 'day');
  }

  const calendar = $derived(calendarMonth(events, month, toDisplay));
  const monthGrid = $derived(calendarMonths(events, year, toDisplay));
  const yearGrid = $derived(calendarYears(events, toDisplay));
  /** Grille affichée aux mailles larges ; `$derived` paresseux, l'autre n'est jamais calculée. */
  const grid = $derived(grain === 'year' ? yearGrid : monthGrid);
  const monthLabel = $derived(`${monthName(month)} ${month.slice(0, 4)}`);
  /** Ce que la navigation gouverne : un mois, une année, ou rien (la maille année tient tout). */
  const periodLabel = $derived.by((): string => {
    if (grain === 'day') return monthLabel;
    if (grain === 'month') return year;
    const first = years[0];
    const last = years.at(-1);
    if (first === undefined || last === undefined) return 'Aucun trade';
    return first === last ? first : `${first} – ${last}`;
  });
  const bucketLabel = (bucket: CalendarBucket): string =>
    grain === 'year' ? bucket.key : `${monthName(bucket.key)} ${bucket.key.slice(0, 4)}`;
  const bucketShort = (bucket: CalendarBucket): string =>
    grain === 'year' ? bucket.key : monthShort(bucket.key);
  /** Trades non convertibles signalés sous le titre, dans la maille effectivement affichée. */
  const excludedCount = $derived(grain === 'day' ? calendar.excluded : grid.excluded);

  let selectedDay = $state<string | null>(null);
  function selectDay(day: CalendarDay): void {
    if (day.count === 0) return;
    selectedDay = selectedDay === day.day ? null : day.day;
  }
  /**
   * Trades concernés par le jour sélectionné, avec ce que CHACUN a réalisé ce jour-là (et non son
   * résultat depuis l'ouverture) : c'est la seule décomposition dont la somme redonne la case.
   */
  const selectedTrades = $derived.by((): { trip: JournaledTrip; amount: Big | null }[] => {
    if (selectedDay === null) return [];
    // Des Record, pas des Map : la règle `svelte/prefer-svelte-reactivity` interdit une Map mutée
    // dans du code réactif (elle ne redéclencherait pas le rendu).
    const byId: Record<string, JournaledTrip> = {};
    for (const t of trips) byId[t.trip.id] = t;
    const order: string[] = [];
    const amounts: Record<string, Big | null> = {};
    for (const e of events) {
      if (e.day !== selectedDay || e.tripId === null) continue;
      if (!(e.tripId in amounts)) {
        order.push(e.tripId);
        amounts[e.tripId] = ZERO;
      }
      const converted = toDisplay(e.quote, e.amount);
      const previous = amounts[e.tripId] ?? null;
      amounts[e.tripId] = converted === null || previous === null ? null : previous.plus(converted);
    }
    return order
      .map((id) => ({ trip: byId[id], amount: amounts[id] ?? null }))
      .filter((row): row is { trip: JournaledTrip; amount: Big | null } => row.trip !== undefined);
  });

  const discreet = $derived(app.state.ui.discreet);
  /** Même logique que `Money` (masquage discret), en texte pour l'aria-label du jour. */
  const amountText = (value: Big): string =>
    discreet ? fmtMasked(app.currency) : fmtMoney(value, app.currency, { sign: true });
  // Couleur décidée sur la valeur arrondie, comme `Money` : « 0,00 € » n'est ni un gain ni une perte.
  const toneOf = (pnl: Big): 'gain' | 'loss' | '' =>
    roundsToZero(pnl) ? '' : pnl.lt('0') ? 'loss' : 'gain';

  function dayNumber(day: string): string {
    return String(Number(day.slice(8, 10)));
  }
  // Appelé uniquement pour un jour à trades (day.count > 0, cf. le bouton dans le gabarit).
  function dayAriaLabel(day: CalendarDay): string {
    const label = `${dayNumber(day.day)} ${monthName(month)}`;
    return `${label} : ${amountText(day.pnl)}, ${day.count} trade${day.count > 1 ? 's' : ''}`;
  }
  // Idem pour une case large : le clic descend d'un cran, l'étiquette le dit.
  function bucketAriaLabel(bucket: CalendarBucket): string {
    const trades = `${bucket.count} trade${bucket.count > 1 ? 's' : ''}`;
    const action = grain === 'year' ? 'voir les mois' : 'voir les jours';
    return `${bucketLabel(bucket)} : ${amountText(bucket.pnl)}, ${trades} — ${action}`;
  }
</script>

<p class="muted small note">
  P&L réalisé net au jour où il l'a été (frais et funding compris, y compris ceux d'une position
  encore ouverte) ; le latent n'y figure pas.
  {#if excludedCount > 0}
    {excludedCount} trade{excludedCount > 1 ? 's' : ''} en devise non convertie exclu{excludedCount >
    1
      ? 's'
      : ''}.
  {/if}
</p>

<div class="head">
  <p class="month"><strong>{periodLabel}</strong></p>
  <div class="controls">
    <div class="grains" role="radiogroup" aria-label="Maille du calendrier">
      {#each GRAINS as g (g.id)}
        <button
          type="button"
          role="radio"
          aria-checked={grain === g.id}
          class:active={grain === g.id}
          onclick={() => setGrain(g.id)}>{g.label}</button
        >
      {/each}
    </div>
    {#if grain !== 'year'}
      <div class="nav">
        <button
          type="button"
          class="nav-btn"
          aria-label={grain === 'day' ? 'Mois précédent' : 'Année précédente'}
          disabled={!canPrev}
          onclick={() => shift(-1)}>‹</button
        >
        <button
          type="button"
          class="nav-btn"
          aria-label={grain === 'day' ? 'Mois suivant' : 'Année suivante'}
          disabled={!canNext}
          onclick={() => shift(1)}>›</button
        >
      </div>
    {/if}
  </div>
</div>

{#if grain !== 'day'}
  <ul class="tiles" aria-label={grain === 'month' ? `Mois de ${year}` : 'Années'}>
    {#each grid.buckets as bucket (bucket.key)}
      <li>
        {#if bucket.count === 0}
          <span class="tile empty">
            <span class="tile-name muted">{bucketShort(bucket)}</span>
            <span class="muted small" aria-hidden="true">—</span>
          </span>
        {:else}
          {@const tone = toneOf(bucket.pnl)}
          <button
            type="button"
            class="tile"
            class:tone-gain={tone === 'gain'}
            class:tone-loss={tone === 'loss'}
            aria-label={bucketAriaLabel(bucket)}
            onclick={() => drillInto(bucket)}
          >
            <span class="tile-name">{bucketShort(bucket)}</span>
            <Money value={bucket.pnl} sign colored compact />
            <span class="count" aria-hidden="true"
              >{bucket.count} trade{bucket.count > 1 ? 's' : ''}</span
            >
          </button>
        {/if}
      </li>
    {/each}
  </ul>
  {#if grid.buckets.length === 0}
    <p class="muted small">Aucun montant réalisé pour l'instant.</p>
  {:else}
    <p class="grid-total">
      <span class="muted small">{grain === 'month' ? `Total ${year}` : 'Total'}</span>
      <Money value={grid.total} sign colored strong />
    </p>
  {/if}
{:else}
  <!-- Un tableau qui défile horizontalement doit rester accessible au clavier (WCAG 2.1.1). -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="scroll" tabindex="0" role="region" aria-label="Calendrier de P&L — tableau défilant">
    <table>
      <caption class="sr-only">Calendrier de P&L réalisé net par jour, {monthLabel}</caption>
      <thead>
        <tr>
          {#each WEEKDAY_LABELS as w (w)}
            <th scope="col">{w}</th>
          {/each}
          <th scope="col">Sem.</th>
        </tr>
      </thead>
      <tbody>
        {#each calendar.weeks as week, wi (wi)}
          <tr>
            {#each week.days as day, di (di)}
              <td class="cell">
                {#if day === null}
                  <!-- jour hors mois : case vide -->
                {:else if day.count === 0}
                  <span class="day-num muted">{dayNumber(day.day)}</span>
                {:else}
                  {@const tone = toneOf(day.pnl)}
                  <button
                    type="button"
                    class="day"
                    class:tone-gain={tone === 'gain'}
                    class:tone-loss={tone === 'loss'}
                    aria-pressed={selectedDay === day.day}
                    aria-label={dayAriaLabel(day)}
                    onclick={() => selectDay(day)}
                  >
                    <span class="day-num">{dayNumber(day.day)}</span>
                    <Money value={day.pnl} sign colored compact />
                    <span class="count" aria-hidden="true">{day.count}</span>
                  </button>
                {/if}
              </td>
            {/each}
            <td class="week-total">
              <Money value={week.total} sign colored compact />
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if selectedDay !== null}
  <div class="day-trades">
    <h3>Réalisé le {fmtDate(`${selectedDay}T00:00:00`)}, par trade</h3>
    <ul class="day-list">
      {#each selectedTrades as row (row.trip.trip.id)}
        <li>
          <a class="trade-link" href={router.href({ name: 'trade', id: row.trip.trip.id })}>
            <span class="dir {row.trip.trip.direction}"
              >{row.trip.trip.direction === 'long' ? 'Long' : 'Short'}</span
            >
            <strong class="sym">{row.trip.trip.symbol}</strong>
            <Money value={row.amount} sign colored strong />
          </a>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .note {
    margin: 0 0 var(--space-3);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }
  .month {
    margin: 0;
    font-size: var(--fs-md);
  }
  .nav {
    display: flex;
    gap: var(--space-1);
  }
  .nav-btn {
    min-width: var(--tap);
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    font-size: var(--fs-lg);
    line-height: 1;
  }
  .nav-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  /* Même langage visuel que le sélecteur de période de la Vue d'ensemble. */
  .grains {
    display: flex;
    gap: 6px;
  }
  .grains button {
    min-width: 44px;
    min-height: 36px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .grains button.active {
    background: var(--fg);
    color: var(--bg);
    border-color: var(--fg);
  }
  .tiles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    /* Trois colonnes sur mobile, quatre au-delà : douze mois se lisent en carré, comme une année
       de calendrier — pas en une bande de douze cases. */
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
  @media (min-width: 640px) {
    .tiles {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .tile {
    width: 100%;
    min-height: 64px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: var(--space-2) 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg);
  }
  .tile-name {
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .tile.empty {
    border-style: dashed;
  }
  .tile .count {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .tile.tone-gain {
    background: color-mix(in srgb, var(--gain) 18%, transparent);
  }
  .tile.tone-loss {
    background: color-mix(in srgb, var(--loss) 18%, transparent);
  }
  /* Comme pour les jours : sur fond teinté, le montant reprend la couleur du texte (WCAG 2.2 AA). */
  .tile.tone-gain :global(.num),
  .tile.tone-loss :global(.num) {
    color: var(--fg);
  }
  .tile:hover:not(.empty) {
    border-color: var(--accent-trading);
  }
  .grid-total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
    margin: var(--space-3) 0 0;
  }
  .scroll {
    overflow-x: auto;
  }
  .scroll:focus-visible {
    outline: 2px solid var(--accent-trading);
    outline-offset: 2px;
  }
  table {
    width: 100%;
    min-width: 480px;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th,
  td {
    border: 1px solid var(--border);
    text-align: center;
    padding: 2px;
  }
  thead th {
    padding: var(--space-2) 2px;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  th:last-child,
  td.week-total {
    text-align: right;
    padding-right: var(--space-2);
  }
  .day-num {
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .day {
    width: 100%;
    min-height: var(--tap);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg);
    padding: 4px 2px;
  }
  .day.tone-gain {
    background: color-mix(in srgb, var(--gain) 18%, transparent);
  }
  .day.tone-loss {
    background: color-mix(in srgb, var(--loss) 18%, transparent);
  }
  /* Dans une case teintée, le montant reprend la couleur du texte courant : vert sur vert clair
     (ou rouge sur rouge clair) tombe sous 4,5:1 (axe WCAG 2.2 AA). La teinte de la case et le
     signe du montant portent déjà l'information — la couleur n'est jamais le seul signal. */
  .day.tone-gain :global(.num),
  .day.tone-loss :global(.num) {
    color: var(--fg);
  }
  .day[aria-pressed='true'] {
    box-shadow: inset 0 0 0 2px var(--accent-trading);
  }
  .day .count {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .week-total {
    font-size: var(--fs-sm);
  }
  .day-trades {
    margin-top: var(--space-3);
  }
  .day-trades h3 {
    font-size: var(--fs-sm);
    margin: 0 0 var(--space-2);
  }
  .day-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .trade-link {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: inherit;
    text-decoration: none;
  }
  .trade-link:hover {
    border-color: var(--accent-trading);
  }
  .sym {
    margin-right: auto;
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
  @media (max-width: 480px) {
    .day-num {
      font-size: var(--fs-xs);
    }
    .day .count {
      display: none;
    }
    .day {
      padding: 2px 1px;
      gap: 0;
    }
  }
</style>
