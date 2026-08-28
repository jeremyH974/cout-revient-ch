/**
 * Engendre `src/lib/calendar/events.generated.ts` — le calendrier macroéconomique américain.
 *   node scripts/generate-calendar.ts [--check]
 *
 * Trois sources, deux régimes :
 *
 * - **FOMC** (`federalreserve.gov`) et **BEA** (`apps.bea.gov`) sont relus à chaque exécution.
 * - **BLS** vient de `src/lib/calendar/bls-schedule.ts`, tenu à la main : son réseau de diffusion
 *   répond 403 à tout client non-navigateur, y compris sur le flux `.ics` qu'il publie pourtant
 *   pour les agendas. Voir l'en-tête de ce fichier-là.
 *
 * Deux propriétés comptent autant que les données :
 *
 * 1. **Sortie déterministe.** Tri stable, identifiants stables, et le fichier n'est réécrit que si
 *    les *événements* changent — l'horodatage de génération ne suffit pas. Sans cela le diff
 *    hebdomadaire serait bruyant, donc jamais relu, donc inutile.
 * 2. **Barrières bloquantes.** Le script refuse d'écrire un calendrier appauvri : chaque source
 *    doit rendre un minimum d'événements, et la couverture BLS doit rester devant nous. *Un
 *    calendrier vide est pire qu'un calendrier périmé — il affirme qu'il ne se passera rien.*
 *
 * `--check` n'écrit rien et sort en erreur si le fichier committé n'est pas à jour.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BLS_CHECKED_ON, BLS_SERIES, blsCoverageEnd } from '../src/lib/calendar/bls-schedule.ts';
import type { Calendar, MarketEvent, SourceStamp } from '../src/lib/calendar/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'src', 'lib', 'calendar', 'events.generated.ts');

export const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
export const BEA_URL = 'https://apps.bea.gov/API/signup/release_dates.json';
const TIMEOUT_MS = 30_000;

/** Horizon minimal exigé de la table BLS avant de crier au secours. */
const BLS_MIN_MONTHS_AHEAD = 3;

/** Planchers par source : en dessous, la source est cassée, pas calme. */
const MIN_EVENTS: Record<string, number> = { fomc: 4, bea: 12, bls: 24 };

// ─── Temps ───────────────────────────────────────────────────────────────────

/**
 * Conversion « heure de New York » → instant UTC, par le fuseau IANA plutôt que par une règle
 * d'heure d'été écrite à la main. La règle américaine a déjà changé (2007) et sa suppression
 * revient régulièrement au Congrès : une mise à jour de Node doit suffire à garder l'app juste.
 */
const NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Décalage de New York par rapport à UTC, en millisecondes, à un instant donné. */
function newYorkOffsetMs(instant: Date): number {
  const parts: Record<string, string> = {};
  for (const part of NEW_YORK.formatToParts(instant)) parts[part.type] = part.value;
  const asIfUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    // Certaines versions d'ICU rendent « 24 » pour minuit.
    Number(parts['hour']) % 24,
    Number(parts['minute']),
    Number(parts['second']),
  );
  return asIfUtc - instant.getTime();
}

/**
 * `2026-09-11` + `08:30` (heure de New York) → `2026-09-11T12:30:00Z`.
 *
 * Deux passes : la première trouve le décalage approximatif, la seconde le corrige si l'estimation
 * était tombée du mauvais côté d'un changement d'heure. Le décalage variant d'au plus une heure,
 * deux passes suffisent — et les publications ont lieu à 8 h 30, 10 h ou 14 h, jamais aux
 * alentours de 2 h du matin, où la bascule s'opère.
 */
export function easternToUtc(day: string, hhmm: string): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  const [hour = 0, minute = 0] = hhmm.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  let ts = wall;
  for (let pass = 0; pass < 2; pass += 1) ts = wall - newYorkOffsetMs(new Date(ts));
  return new Date(ts).toISOString().replace('.000Z', 'Z');
}

/** Jour UTC d'un instant, `AAAA-MM-JJ`. */
const dayOf = (instant: string): string => instant.slice(0, 10);

/** `AAAA-MM-JJ` décalé de `months` mois, en UTC. */
export function addMonths(day: string, months: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, date)).toISOString().slice(0, 10);
}

// ─── Réseau ──────────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Identification honnête, comme le demandent plusieurs agences fédérales.
        'user-agent':
          'cout-revient-ch calendar generator (+https://github.com/jeremyH974/cout-revient-ch)',
        accept: 'text/html,application/json',
      },
    });
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

// ─── FOMC ────────────────────────────────────────────────────────────────────

/**
 * Mois indexés par leurs **trois premières lettres**, et non par leur nom entier.
 *
 * La Fed écrit « January » pour une réunion ordinaire mais « Jan/Feb » pour une réunion à cheval
 * sur deux mois. Une table de noms entiers laissait donc tomber, sans un mot, les réunions des
 * 1ᵉʳ février et 1ᵉʳ novembre 2023 — pendant que « Apr/May » passait, « may » étant à la fois le
 * nom et l'abréviation. Les douze abréviations sont deux à deux distinctes.
 */
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export interface FomcMeeting {
  /** Jour de la **décision**, `AAAA-MM-JJ`. */
  day: string;
  /** La réunion s'accompagne-t-elle de projections économiques (« dot plot ») ? */
  projections: boolean;
  /**
   * Réunion convoquée hors calendrier (mars 2020, par exemple). L'heure du communiqué n'est alors
   * pas la routine de 14 h, d'où un affichage sans heure.
   */
  unscheduled: boolean;
}

/**
 * Extrait les réunions du calendrier officiel.
 *
 * La page liste les réunions par année (`<a id="…">2026 FOMC Meetings</a>`), chacune dans un bloc
 * `row fomc-meeting` portant son mois et sa plage de jours. Une réunion dure deux jours et **la
 * décision tombe le dernier** ; un astérisque marque les réunions accompagnées de projections.
 *
 * Le libellé de mois peut en couvrir deux (« April/May ») quand la réunion est à cheval : c'est
 * alors le second qui porte la décision.
 */
export function parseFomc(html: string): FomcMeeting[] {
  const flat = html.replace(/\s+/g, ' ');
  const meetings: FomcMeeting[] = [];
  const yearBlocks = [...flat.matchAll(/(\d{4}) FOMC Meetings/g)];

  for (const [index, match] of yearBlocks.entries()) {
    const year = Number(match[1]);
    const start = match.index;
    const end = yearBlocks[index + 1]?.index ?? flat.length;
    const section = flat.slice(start, end);

    const rows = section.matchAll(
      /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>.*?fomc-meeting__date[^>]*>([^<]+)</g,
    );
    for (const row of rows) {
      const monthLabel = (row[1] ?? '').trim().toLowerCase();
      const dateLabel = (row[2] ?? '').trim();

      /**
       * Un « notation vote » est un vote écrit, pas une réunion : ni décision de taux, ni
       * conférence de presse. Celui du 22 août 2025 portait sur le cadre de politique monétaire.
       * Le compter comme une décision serait annoncer un rendez-vous qui n'existe pas.
       */
      if (/notation/i.test(dateLabel)) continue;

      // « Jan/Feb » : quand la réunion est à cheval, la décision tombe le second mois.
      const month = MONTHS[(monthLabel.split('/').pop()?.trim() ?? '').slice(0, 3)];
      const days = dateLabel.match(/\d+/g);
      const decisionDay = days?.[days.length - 1];
      if (!month || !decisionDay) continue;
      meetings.push({
        day: `${year}-${String(month).padStart(2, '0')}-${decisionDay.padStart(2, '0')}`,
        projections: dateLabel.includes('*'),
        unscheduled: /unscheduled/i.test(dateLabel),
      });
    }
  }
  return meetings;
}

/** Réunions → événements. Le communiqué tombe à 14 h à New York, la conférence de presse suit. */
export function fomcEvents(meetings: readonly FomcMeeting[]): MarketEvent[] {
  return meetings.map((meeting) => ({
    id: `fomc-decision-${meeting.day}`,
    kind: 'fomc-decision',
    // Une réunion hors calendrier ne suit pas la routine de 14 h : midi UTC sert alors d'ancre au
    // tri, et `precision: 'day'` empêche l'écran d'afficher une heure qu'on ne connaît pas.
    at: meeting.unscheduled ? `${meeting.day}T12:00:00Z` : easternToUtc(meeting.day, '14:00'),
    precision: meeting.unscheduled ? 'day' : 'exact',
    title: 'Décision de la Fed (FOMC)',
    detail: meeting.unscheduled
      ? 'Réunion convoquée hors calendrier'
      : meeting.projections
        ? 'Communiqué, conférence de presse et projections économiques'
        : 'Communiqué et conférence de presse',
    tier: 'major',
    source: 'fomc',
    url: FOMC_URL,
  }));
}

// ─── BEA ─────────────────────────────────────────────────────────────────────

/**
 * Le BEA publie ses dates **déjà en UTC**, décalage inclus (`2026-09-30T12:30:00+00:00`). Aucune
 * conversion de fuseau n'est faite ici — ce qui en fait l'oracle indépendant du convertisseur
 * ci-dessus, exploité par les tests.
 */
const BEA_RELEASES = [
  {
    key: 'Personal Income and Outlays',
    kind: 'pce',
    title: 'Inflation PCE et revenus des ménages',
    detail: 'La mesure d’inflation que la Fed regarde en priorité',
    url: 'https://www.bea.gov/data/income-saving/personal-income',
  },
  {
    key: 'Gross Domestic Product',
    kind: 'gdp',
    title: 'PIB américain',
    detail: null,
    url: 'https://www.bea.gov/data/gdp/gross-domestic-product',
  },
] as const;

/** Valide la réponse du BEA et la convertit. Toute série absente est une erreur, pas un vide. */
export function beaEvents(payload: unknown): MarketEvent[] {
  const root = payload as Record<string, { release_dates?: unknown }> | null;
  const events: MarketEvent[] = [];
  for (const release of BEA_RELEASES) {
    const dates = root?.[release.key]?.release_dates;
    if (!Array.isArray(dates)) throw new Error(`BEA : série « ${release.key} » absente`);
    // Le BEA republie parfois deux fois la même date ; l'unicité est faite sur l'identifiant.
    for (const raw of new Set(dates)) {
      const parsed = Date.parse(String(raw));
      if (Number.isNaN(parsed)) throw new Error(`BEA : date illisible « ${String(raw)} »`);
      const at = new Date(parsed).toISOString().replace('.000Z', 'Z');
      events.push({
        id: `bea-${release.kind}-${dayOf(at)}`,
        kind: release.kind,
        at,
        precision: 'exact',
        title: release.title,
        ...(release.detail === null ? {} : { detail: release.detail }),
        tier: 'major',
        source: 'bea',
        url: release.url,
      });
    }
  }
  return events;
}

// ─── BLS ─────────────────────────────────────────────────────────────────────

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

/**
 * « 2026-07 » → « Données de juillet 2026 », « 2026-08 » → « Données d’août 2026 ».
 *
 * L'élision devant avril, août et octobre n'est pas une coquetterie : c'est un libellé affiché à
 * chaque ligne du calendrier, et « de août » saute aux yeux.
 */
export function referenceLabel(reference: string): string {
  const [year = 0, month = 1] = reference.split('-').map(Number);
  const name = MONTH_NAMES[month - 1] ?? '?';
  const elides = /^[aeiouâàéèêîôû]/i.test(name);
  return `Données ${elides ? 'd’' : 'de '}${name} ${year}`;
}

export function blsEvents(): MarketEvent[] {
  const events: MarketEvent[] = [];
  for (const series of BLS_SERIES) {
    for (const release of series.releases) {
      events.push({
        id: `bls-${series.kind}-${release.day}`,
        kind: series.kind,
        at: easternToUtc(release.day, series.easternTime),
        precision: 'exact',
        title: series.title,
        detail: referenceLabel(release.reference),
        tier: series.tier,
        source: 'bls',
        url: series.url,
      });
    }
  }
  return events;
}

// ─── Barrières ───────────────────────────────────────────────────────────────

/** Rend la liste des raisons de NE PAS écrire. Vide = tout va bien. */
export function gateProblems(
  events: readonly MarketEvent[],
  bySource: Record<string, readonly MarketEvent[]>,
  today: string,
  blsEnd: string,
): string[] {
  const problems: string[] = [];

  for (const [source, minimum] of Object.entries(MIN_EVENTS)) {
    const count = bySource[source]?.length ?? 0;
    if (count < minimum) problems.push(`${source} : ${count} événement(s), minimum ${minimum}`);
  }

  const upcomingFomc = (bySource['fomc'] ?? []).filter((event) => dayOf(event.at) >= today);
  if (upcomingFomc.length < 3) {
    problems.push(
      `FOMC : ${upcomingFomc.length} réunion(s) à venir, minimum 3 — la page a-t-elle changé de forme ?`,
    );
  }

  const horizon = addMonths(today, BLS_MIN_MONTHS_AHEAD);
  if (blsEnd < horizon) {
    problems.push(
      `BLS : la table s'arrête au ${blsEnd}, soit moins de ${BLS_MIN_MONTHS_AHEAD} mois devant nous. ` +
        'Relisez les pages officielles dans un navigateur et mettez à jour src/lib/calendar/bls-schedule.ts.',
    );
  }

  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) problems.push(`identifiant en double : ${event.id}`);
    seen.add(event.id);
    if (Number.isNaN(Date.parse(event.at))) {
      problems.push(`instant illisible : ${event.id} → ${event.at}`);
    }
  }

  return problems;
}

// ─── Rendu ───────────────────────────────────────────────────────────────────

const literal = (value: string): string => JSON.stringify(value);

export function render(calendar: Calendar): string {
  return [
    '// @generated par `node scripts/generate-calendar.ts` — NE PAS MODIFIER À LA MAIN.',
    '//',
    '// Les dates du BLS viennent de `bls-schedule.ts`, tenu à la main ; celles du FOMC et du BEA',
    '// sont relues automatiquement. Voir `types.ts` pour ce que chaque champ engage.',
    '',
    "import type { Calendar } from './types';",
    '',
    'export const CALENDAR: Calendar = {',
    `  generatedAt: ${literal(calendar.generatedAt)},`,
    `  coversFrom: ${literal(calendar.coversFrom)},`,
    `  coversTo: ${literal(calendar.coversTo)},`,
    `  completeTo: ${literal(calendar.completeTo)},`,
    '  sources: [',
    ...calendar.sources.map(
      (s) =>
        `    { source: ${literal(s.source)}, checkedOn: ${literal(s.checkedOn)}, ` +
        `count: ${s.count}, coversTo: ${literal(s.coversTo)}, upkeep: ${literal(s.upkeep)} },`,
    ),
    '  ],',
    '  events: [',
    ...calendar.events.map((event) => {
      const fields = [
        `id: ${literal(event.id)}`,
        `kind: ${literal(event.kind)}`,
        `at: ${literal(event.at)}`,
        `precision: ${literal(event.precision)}`,
        `title: ${literal(event.title)}`,
        ...(event.detail === undefined ? [] : [`detail: ${literal(event.detail)}`]),
        `tier: ${literal(event.tier)}`,
        `source: ${literal(event.source)}`,
        `url: ${literal(event.url)}`,
      ];
      return `    { ${fields.join(', ')} },`;
    }),
    '  ],',
    '};',
    '',
  ].join('\n');
}

/** Deux rendus sont « les mêmes » si seuls leurs horodatages de génération diffèrent. */
export const withoutStamp = (text: string): string =>
  text.replace(/^ {2}generatedAt: .*$/m, '  generatedAt: —');

// ─── Exécution ───────────────────────────────────────────────────────────────

/** Dernier jour annoncé par une source. Chaîne vide si elle n'a rien rendu. */
const lastDayOf = (events: readonly MarketEvent[]): string =>
  events.reduce((latest, event) => (dayOf(event.at) > latest ? dayOf(event.at) : latest), '');

export async function main(checkOnly: boolean): Promise<number> {
  const [fomcHtml, beaJson] = await Promise.all([fetchText(FOMC_URL), fetchText(BEA_URL)]);
  const today = new Date().toISOString().slice(0, 10);

  /**
   * Le passé n'est gardé que sur quelques mois. Le calendrier du FOMC remonte à 2021 : embarquer
   * cinq ans de réunions closes alourdirait le bundle pour une section « passé » que personne ne
   * déroule aussi loin. Les horizons des sources sont mesurés **avant** cette coupe, sinon la
   * fenêtre glissante ferait croire à une couverture qui rétrécit.
   */
  const keptFrom = addMonths(today, -3);
  const inWindow = (events: readonly MarketEvent[]): MarketEvent[] =>
    events.filter((event) => dayOf(event.at) >= keptFrom);

  const allFomc = fomcEvents(parseFomc(fomcHtml));
  const allBea = beaEvents(JSON.parse(beaJson));
  const allBls = blsEvents();

  const fomc = inWindow(allFomc);
  const bea = inWindow(allBea);
  const bls = inWindow(allBls);

  const events = [...fomc, ...bea, ...bls].sort((a, b) =>
    a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at),
  );

  const problems = gateProblems(events, { fomc, bea, bls }, today, blsCoverageEnd());
  if (problems.length > 0) {
    console.error('Calendrier NON écrit — barrières non franchies :');
    for (const problem of problems) console.error(`  • ${problem}`);
    return 1;
  }

  const first = events[0];
  const last = events[events.length - 1];
  if (!first || !last) {
    console.error('Calendrier NON écrit — aucun événement.');
    return 1;
  }

  const sources: SourceStamp[] = [
    {
      source: 'fomc',
      checkedOn: today,
      count: fomc.length,
      coversTo: lastDayOf(allFomc),
      upkeep: 'auto',
    },
    {
      source: 'bea',
      checkedOn: today,
      count: bea.length,
      coversTo: lastDayOf(allBea),
      upkeep: 'auto',
    },
    {
      source: 'bls',
      checkedOn: BLS_CHECKED_ON,
      count: bls.length,
      coversTo: lastDayOf(allBls),
      upkeep: 'manual',
    },
  ];

  // Le calendrier n'est complet que jusqu'au plus court des horizons : c'est ce que l'écran annonce.
  const completeTo = sources.reduce(
    (soonest, source) => (source.coversTo < soonest ? source.coversTo : soonest),
    sources[0]?.coversTo ?? today,
  );

  const next = render({
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    coversFrom: dayOf(first.at),
    coversTo: dayOf(last.at),
    completeTo,
    sources,
    events,
  });

  let previous = '';
  try {
    previous = readFileSync(OUTPUT, 'utf8');
  } catch {
    // Première génération : il n'y a rien à comparer, la chaîne vide fera l'affaire.
  }

  if (withoutStamp(previous) === withoutStamp(next)) {
    console.log(`Calendrier inchangé : ${events.length} événements jusqu'au ${dayOf(last.at)}.`);
    return 0;
  }

  if (checkOnly) {
    console.error(
      'Le calendrier engendré n’est pas à jour. Lancez `node scripts/generate-calendar.ts`.',
    );
    return 1;
  }

  writeFileSync(OUTPUT, next, 'utf8');
  console.log(
    `Calendrier écrit : ${events.length} événements du ${dayOf(first.at)} au ${dayOf(last.at)} ` +
      `(FOMC ${fomc.length}, BEA ${bea.length}, BLS ${bls.length}).`,
  );
  return 0;
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
if (isMain) process.exitCode = await main(process.argv.includes('--check'));
