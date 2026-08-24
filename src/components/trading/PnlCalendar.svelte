<script lang="ts">
  /**
   * Calendrier de P&L (P22) : grille mensuelle du P&L réalisé net par jour, façon TradeZella —
   * cases teintées gain/perte, totaux hebdomadaires, navigation par mois, jour cliquable pour voir
   * les trades concernés. Chaque montant est rattaché au jour où la plateforme l'a réalisé (fill,
   * frais, funding), pas au jour de clôture de l'aller-retour : c'est la règle de l'exchange et
   * celle du tableau de bord. Tout le calcul vient du moteur pur (`$lib/domain/trading/calendar`) ;
   * ce composant affiche et gère la sélection, rien de plus.
   */
  import { nowIso } from '$lib/clock';
  import { ZERO, type Big } from '$lib/domain/money';
  import {
    activeMonths,
    calendarMonth,
    type CalendarDay,
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
  const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const monthName = (m: string): string => MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? '?';

  const today = nowIso().slice(0, 7);
  const months = $derived(activeMonths(events));
  // Initialisation unique (volontairement pas un `$derived`) : on ne veut pas ramener
  // l'utilisateur au dernier mois actif à chaque nouvelle synchronisation pendant qu'il navigue.
  // svelte-ignore state_referenced_locally
  let month = $state(months.at(-1) ?? today);
  const minMonth = $derived(months[0] ?? today);
  const canPrev = $derived(month > minMonth);
  const canNext = $derived(month < today);

  function shiftMonth(value: string, delta: number): string {
    const [y, m] = value.split('-').map(Number) as [number, number];
    const total = y * 12 + (m - 1) + delta;
    const year = Math.floor(total / 12);
    const monthNum = total - year * 12 + 1;
    return `${year}-${String(monthNum).padStart(2, '0')}`;
  }
  function prevMonth(): void {
    if (!canPrev) return;
    month = shiftMonth(month, -1);
    selectedDay = null;
  }
  function nextMonth(): void {
    if (!canNext) return;
    month = shiftMonth(month, 1);
    selectedDay = null;
  }

  const calendar = $derived(calendarMonth(events, month, toDisplay));
  const monthLabel = $derived(`${monthName(month)} ${month.slice(0, 4)}`);

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
</script>

<p class="muted small note">
  P&L réalisé net au jour où il l'a été (frais et funding compris, y compris ceux d'une position
  encore ouverte) ; le latent n'y figure pas.
  {#if calendar.excluded > 0}
    {calendar.excluded} trade{calendar.excluded > 1 ? 's' : ''} en devise non convertie exclu{calendar.excluded >
    1
      ? 's'
      : ''}.
  {/if}
</p>

<div class="head">
  <p class="month"><strong>{monthLabel}</strong></p>
  <div class="nav">
    <button
      type="button"
      class="nav-btn"
      aria-label="Mois précédent"
      disabled={!canPrev}
      onclick={prevMonth}>‹</button
    >
    <button
      type="button"
      class="nav-btn"
      aria-label="Mois suivant"
      disabled={!canNext}
      onclick={nextMonth}>›</button
    >
  </div>
</div>

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
