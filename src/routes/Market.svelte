<script lang="ts">
  import { onMount } from 'svelte';
  import { CALENDAR, daysUntilIncomplete, groupByDay, localDay, splitAround } from '$lib/calendar';
  import type { MarketEvent } from '$lib/calendar';
  import { nowIso, nowMs } from '$lib/clock';
  import AppBar from '../components/layout/AppBar.svelte';
  import LensSection from '../components/market/LensSection.svelte';
  import MacroSection from '../components/market/MacroSection.svelte';
  import { app } from '../state/app.svelte';

  /**
   * Le calendrier macroéconomique américain, embarqué dans l'application.
   *
   * Aucune requête n'est faite ici : les dates sont compilées dans le bundle, donc l'écran
   * fonctionne hors ligne et aucun tiers n'apprend ce que vous consultez.
   *
   * Le formatage des heures ne passe pas par `$lib/format/fr` : celui-ci traite les dates
   * *naïves* de Coinhouse, qu'il ne faut jamais convertir. Ici, c'est l'inverse — ce sont des
   * instants réels, qu'il faut au contraire rendre dans le fuseau du lecteur.
   */

  let tick = $state(nowMs());
  onMount(() => {
    const id = setInterval(() => (tick = nowMs()), 60_000);
    return () => clearInterval(id);
  });

  let onlyMajor = $state(false);
  let showPast = $state(false);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  /** Une heure est un **instant** : elle se rend dans le fuseau du lecteur. */
  const timeFormat = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  const zoneFormat = new Intl.DateTimeFormat('fr-FR', { timeZoneName: 'short', timeZone });

  /**
   * Un jour (« 2026-09-11 ») est une **date de calendrier**, déjà exprimée dans le fuseau du
   * lecteur par `groupByDay`. Il se rend donc en UTC : le repasser dans le fuseau local le
   * décalerait une seconde fois, et afficherait le lendemain au-delà d'UTC+12.
   */
  const asUtcDay = (day: string): Date => new Date(`${day}T12:00:00Z`);
  const longDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });
  const weekdayDate = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const weekdayDateYear = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  /**
   * « mardi 1ᵉʳ septembre », avec l'année seulement lorsqu'elle n'est pas l'année courante — le
   * calendrier va au-delà de douze mois, sans quoi deux « 15 mars » se ressembleraient trop.
   * `Intl` rend « 1 » là où le français écrit « 1ᵉʳ », et ne capitalise pas le jour de la semaine.
   */
  function dayLabel(day: string): string {
    const thisYear = new Date(tick).getFullYear() === Number(day.slice(0, 4));
    const raw = (thisYear ? weekdayDate : weekdayDateYear).format(asUtcDay(day));
    const withOrdinal = raw.replace(/(\s)1(\s)/, '$1' + '1ᵉʳ' + '$2');
    return withOrdinal.charAt(0).toUpperCase() + withOrdinal.slice(1);
  }

  /** Jour local du lecteur : c'est lui qui décide si une donnée est « d'hier ». */
  const localToday = $derived(localDay(nowIso(tick), timeZone));

  const zoneLabel = $derived(
    zoneFormat.formatToParts(new Date(tick)).find((p) => p.type === 'timeZoneName')?.value ?? '',
  );

  const split = $derived(splitAround(nowIso(tick)));
  const keep = (events: readonly MarketEvent[]): MarketEvent[] =>
    onlyMajor ? events.filter((event) => event.tier === 'major') : [...events];

  const upcomingDays = $derived(groupByDay(keep(split.upcoming), timeZone));
  const pastDays = $derived(groupByDay(keep(split.past), timeZone));
  const next = $derived(split.upcoming[0]);
  const remaining = $derived(daysUntilIncomplete(nowIso(tick)));

  /** « dans 3 jours », « demain », « aujourd'hui ». Le compte se fait en jours *locaux*. */
  function whenLabel(at: string): string {
    const startOfDay = (ms: number): number => {
      const d = new Date(ms);
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    };
    const days = Math.round((startOfDay(Date.parse(at)) - startOfDay(tick)) / 86_400_000);
    if (days <= 0) return "aujourd'hui";
    if (days === 1) return 'demain';
    if (days < 7) return `dans ${days} jours`;
    if (days < 14) return 'dans une semaine';
    return `dans ${Math.round(days / 7)} semaines`;
  }
</script>

<AppBar title="Contexte de marché" back={app.hasData} />

<div class="page">
  <section class="card intro">
    <h2>Calendrier macroéconomique américain</h2>
    <p class="muted">
      Les dates de publication qui font bouger les marchés, à titre de <strong>contexte</strong>.
      Cet écran ne dit jamais quoi faire, ne commente aucun chiffre et ne connaît pas votre
      portefeuille. Il fonctionne hors ligne : rien n'est demandé au réseau.
    </p>
    {#if next}
      <p class="next">
        Prochaine publication : <strong>{next.title}</strong>, {whenLabel(next.at)}
        {#if next.precision === 'exact'}
          à {timeFormat.format(new Date(next.at))}
        {/if}
      </p>
    {/if}
  </section>

  <MacroSection today={localToday} />

  <LensSection />

  <h2 class="section-title">Calendrier des publications</h2>

  <div class="controls">
    <label class="toggle">
      <input type="checkbox" bind:checked={onlyMajor} />
      Ne montrer que les publications majeures
    </label>
  </div>

  <section aria-labelledby="upcoming-heading">
    <h2 id="upcoming-heading">À venir</h2>
    {#if upcomingDays.length === 0}
      <p class="muted empty">
        Aucune publication à venir dans ce calendrier. Il est arrêté au {longDate.format(
          asUtcDay(CALENDAR.completeTo),
        )} : au-delà, les organismes n'ont pas encore annoncé leurs dates.
      </p>
    {:else}
      {#each upcomingDays as group (group.day)}
        <article class="card day">
          <h3>{dayLabel(group.day)}</h3>
          <ul>
            {#each group.events as event (event.id)}
              <li>
                <div class="when">
                  {#if event.precision === 'exact'}
                    <time datetime={event.at}>{timeFormat.format(new Date(event.at))}</time>
                  {:else}
                    <span class="muted">heure non annoncée</span>
                  {/if}
                </div>
                <div class="what">
                  <p class="title">
                    {event.title}
                    {#if event.tier === 'major'}<span class="tier">majeure</span>{/if}
                  </p>
                  {#if event.detail}<p class="muted detail">{event.detail}</p>{/if}
                  <a href={event.url} target="_blank" rel="noopener noreferrer">
                    Publication officielle
                  </a>
                </div>
              </li>
            {/each}
          </ul>
        </article>
      {/each}
    {/if}
  </section>

  <section aria-labelledby="past-heading">
    <h2 id="past-heading">Déjà publié</h2>
    <button
      class="secondary"
      type="button"
      aria-expanded={showPast}
      onclick={() => (showPast = !showPast)}
    >
      {showPast ? 'Masquer' : 'Afficher'} les {pastDays.length} derniers jours de publications
    </button>
    {#if showPast}
      {#each pastDays as group (group.day)}
        <article class="card day">
          <h3>{dayLabel(group.day)}</h3>
          <ul>
            {#each group.events as event (event.id)}
              <li>
                <div class="when">
                  {#if event.precision === 'exact'}
                    <time datetime={event.at}>{timeFormat.format(new Date(event.at))}</time>
                  {/if}
                </div>
                <div class="what">
                  <p class="title">{event.title}</p>
                  {#if event.detail}<p class="muted detail">{event.detail}</p>{/if}
                </div>
              </li>
            {/each}
          </ul>
        </article>
      {/each}
    {/if}
  </section>

  <section class="card notes" aria-labelledby="notes-heading">
    <h2 id="notes-heading">Ce que ce calendrier sait, et ce qu'il ignore</h2>
    <ul>
      <li>
        Heures affichées dans votre fuseau{zoneLabel ? ` (${zoneLabel})` : ''}. Les organismes
        américains publient en heure de New York ; la conversion tient compte de leur heure d'été.
      </li>
      <li>
        <strong>« Majeure » est un choix de rédaction</strong>, pas une mesure : aucune volatilité
        n'a été calculée pour l'établir.
      </li>
      <li>
        Complet jusqu'au {longDate.format(asUtcDay(CALENDAR.completeTo))}
        {#if remaining < 45}
          — soit {remaining} jour{remaining > 1 ? 's' : ''}. Au-delà, seules les réunions de la Fed
          sont connues.
        {:else}
          . Au-delà, seules les réunions de la Fed sont connues, les autres organismes n'ayant pas
          publié leurs dates.
        {/if}
      </li>
      <li>
        Ni prévision de marché (« consensus »), ni valeur publiée : ces chiffres appartiennent à des
        fournisseurs commerciaux. Seules les <em>dates</em>, qui sont des faits publics, sont
        reprises.
      </li>
      <li>
        Sources : Réserve fédérale, Bureau of Labor Statistics et Bureau of Economic Analysis —
        œuvres du gouvernement fédéral américain, libres de droits. Relevé le
        {longDate.format(asUtcDay(CALENDAR.sources[0]?.checkedOn ?? CALENDAR.completeTo))}.
      </li>
    </ul>
  </section>
</div>

<style>
  .page {
    padding: var(--space-4);
    max-width: 640px;
    margin: 0 auto;
    display: grid;
    gap: var(--space-4);
  }
  h2 {
    font-size: var(--fs-md);
    margin-bottom: var(--space-2);
  }
  .section-title {
    margin-top: var(--space-2);
  }
  h3 {
    font-size: var(--fs-sm);
    color: var(--fg-muted);
    margin-bottom: var(--space-2);
  }
  .intro,
  .notes,
  .day {
    padding: var(--space-4);
  }
  .intro h2 {
    margin-bottom: var(--space-2);
  }
  .next {
    margin-top: var(--space-3);
    font-size: var(--fs-sm);
  }
  .muted {
    color: var(--fg-muted);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .controls {
    display: flex;
    justify-content: flex-end;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--fs-sm);
    min-height: var(--tap);
  }
  section {
    display: grid;
    gap: var(--space-3);
  }
  .day ul {
    list-style: none;
    display: grid;
    gap: var(--space-3);
  }
  .day li {
    display: grid;
    grid-template-columns: 4.5rem 1fr;
    gap: var(--space-3);
    align-items: baseline;
  }
  .when {
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .title {
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .tier {
    margin-left: var(--space-2);
    font-size: var(--fs-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
    white-space: nowrap;
  }
  .detail {
    margin-top: 2px;
  }
  .what a {
    display: inline-block;
    margin-top: var(--space-1);
    font-size: var(--fs-xs);
  }
  .empty {
    padding: var(--space-4);
  }
  .notes ul {
    display: grid;
    gap: var(--space-2);
    padding-left: var(--space-4);
  }
  .notes li {
    font-size: var(--fs-sm);
    color: var(--fg-muted);
    line-height: 1.5;
  }
  @media (max-width: 380px) {
    .day li {
      grid-template-columns: 1fr;
      gap: var(--space-1);
    }
  }
</style>
