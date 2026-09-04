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
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BLS_CHECKED_ON, BLS_SERIES, blsCoverageEnd } from '../src/lib/calendar/bls-schedule.ts';
import type { Calendar, MarketEvent, SourceStamp } from '../src/lib/calendar/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'src', 'lib', 'calendar', 'events.generated.ts');

export const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
export const BEA_URL = 'https://apps.bea.gov/API/signup/release_dates.json';
const TIMEOUT_MS = 30_000;

/**
 * Horizon minimal exigé de la table BLS avant de crier au secours — mais seulement si la relecture
 * a vieilli (voir `BLS_CHECK_STALE_DAYS`). Une couverture courte ne prouve rien à elle seule : le
 * BLS ne publie l'année suivante qu'à l'automne, et le reste du temps la table est courte **parce
 * qu'elle est à jour**.
 */
const BLS_MIN_MONTHS_AHEAD = 3;

/** En dessous de cet horizon, on prévient — sans bloquer. */
const BLS_WARN_MONTHS_AHEAD = 6;

/**
 * Au-delà de cet âge, l'affirmation portée par `BLS_CHECKED_ON` ne vaut plus : on ne sait plus si
 * la table est courte parce que le BLS s'arrête là, ou parce que personne n'a regardé. Le doute
 * redevient bloquant.
 */
const BLS_CHECK_STALE_DAYS = 45;

/** État de la table BLS au moment de la génération. */
export interface BlsState {
  /** Dernier jour couvert par la table, `AAAA-MM-JJ`. */
  coverageEnd: string;
  /** Jour de la dernière relecture des pages officielles, `AAAA-MM-JJ`. */
  checkedOn: string;
}

/** Planchers par source : en dessous, la source est cassée, pas calme. */
const MIN_EVENTS: Record<string, number> = { fomc: 4, bea: 12, bls: 24, ecb: 4, eurostat: 8 };

// ─── Temps ───────────────────────────────────────────────────────────────────

/**
 * Conversion « heure de New York » → instant UTC, par le fuseau IANA plutôt que par une règle
 * d'heure d'été écrite à la main. La règle américaine a déjà changé (2007) et sa suppression
 * revient régulièrement au Congrès : une mise à jour de Node doit suffire à garder l'app juste.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** Un formateur par fuseau, construit une fois : `Intl.DateTimeFormat` coûte cher à instancier. */
function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    FORMATTERS.set(zone, formatter);
  }
  return formatter;
}

/** Décalage d'un fuseau par rapport à UTC, en millisecondes, à un instant donné. */
function zoneOffsetMs(zone: string, instant: Date): number {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(zone).formatToParts(instant)) parts[part.type] = part.value;
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
export function zonedToUtc(zone: string, day: string, hhmm: string): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  const [hour = 0, minute = 0] = hhmm.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  let ts = wall;
  for (let pass = 0; pass < 2; pass += 1) ts = wall - zoneOffsetMs(zone, new Date(ts));
  return new Date(ts).toISOString().replace('.000Z', 'Z');
}

export const easternToUtc = (day: string, hhmm: string): string =>
  zonedToUtc('America/New_York', day, hhmm);

/**
 * Heure de Francfort → UTC (décision n° 93).
 *
 * La BCE écrit « CET » toute l'année sur ses calendriers, y compris pour des dates d'été. Ce n'est
 * pas UTC+1 littéral : la page couvre septembre et décembre 2026 sans jamais écrire « CEST », ce
 * qui ne se comprend que si « CET » y désigne l'heure LOCALE de Francfort. Une publication
 * récurrente a d'ailleurs une heure locale constante, pas une heure qui glisse d'une heure deux
 * fois par an. D'où la conversion par fuseau IANA, comme pour New York.
 */
export const frankfurtToUtc = (day: string, hhmm: string): string =>
  zonedToUtc('Europe/Berlin', day, hhmm);

/** Jour UTC d'un instant, `AAAA-MM-JJ`. */
const dayOf = (instant: string): string => instant.slice(0, 10);

/** `AAAA-MM-JJ` décalé de `months` mois, en UTC. */
export function addMonths(day: string, months: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, date)).toISOString().slice(0, 10);
}

/** `AAAA-MM-JJ` décalé de `days` jours, en UTC. */
export function addDays(day: string, days: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

// ─── Réseau ──────────────────────────────────────────────────────────────────

const HEADERS = {
  // Identification honnête, comme le demandent plusieurs agences fédérales.
  'user-agent':
    'cout-revient-ch calendar generator (+https://github.com/jeremyH974/cout-revient-ch)',
  accept: 'text/html,application/json',
};

/**
 * Une réponse **vide** n'est pas une source qui a changé : c'est une source qui n'a rien rendu
 * (décision n° 98). Le Data Download Program de la Fed répond `200 text/html` de zéro octet aussi
 * bien pour une sélection retirée que pour un hoquet passager — indistinguables sur une requête.
 * On réessaie donc, une fois, avant de conclure, et le message nomme le symptôme au lieu
 * d'accuser la source d'avoir retiré ce qu'elle sert encore. Le générateur, lui, refuse toujours
 * d'écrire : mieux vaut une génération qui échoue qu'un indicateur muet.
 */
const FETCH_RETRIES = 1;
const FETCH_PAUSE_MS = 2_000;

async function fetchOnce(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: HEADERS,
    });
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    const text = await response.text();
    if (text.trim() === '') throw new Error(`${url} → réponse vide (0 octet), rien à lire`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string): Promise<string> {
  let last: unknown = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, FETCH_PAUSE_MS));
    try {
      return await fetchOnce(url);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
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

// ─── BCE et Eurostat ─────────────────────────────────────────────────────────

const ECB_GC_URL = 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html';
const ECB_HICP_URL = 'https://www.ecb.europa.eu/press/calendars/statscal/ges/html/sthicp.en.html';

export interface EcbEntry {
  /** Jour civil, `AAAA-MM-JJ`. */
  day: string;
  /** `HH:MM` quand la page l'annonce, `null` sinon. */
  time: string | null;
  text: string;
}

/**
 * Les calendriers de la BCE partagent un balisage `<dt>date</dt><dd>libellé</dd>`, plus régulier
 * que celui du FOMC : la date y est complète (`10/09/2026`), sans mois à désambiguïser, et l'heure
 * y figure quand elle est connue. Un seul parseur sert donc les deux pages.
 */
export function parseEcbEntries(html: string): EcbEntry[] {
  const flat = html.replace(/\s+/g, ' ');
  const entries: EcbEntry[] = [];
  for (const match of flat.matchAll(
    /<dt>\s*(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?[^<]*<\/dt>\s*<dd>([^<]*)/g,
  )) {
    const [, dd = '', mm = '', yyyy = '', time, text = ''] = match;
    entries.push({
      day: `${yyyy}-${mm}-${dd}`,
      time: time ?? null,
      text: text.replace(/\s+/g, ' ').trim(),
    });
  }
  return entries;
}

/**
 * Décisions du Conseil des gouverneurs — trois pièges, tous écartés par le même marqueur.
 *
 * 1. « **non**-monetary policy meeting » contient la sous-chaîne « monetary policy meeting » : un
 *    filtre naïf annoncerait une décision de taux là où aucun taux n'est décidé.
 * 2. Le « General Council » est un autre organe, qui réunit aussi les pays hors zone euro.
 * 3. La conférence de presse a sa **propre ligne** (« Press conference following… ») : la compter
 *    doublerait chaque réunion.
 *
 * Le marqueur « followed by press conference » les tranche tous les trois d'un coup — il ne figure
 * que sur le second jour d'une réunion de politique monétaire, celui où la décision tombe.
 */
export function ecbDecisionEvents(entries: readonly EcbEntry[]): MarketEvent[] {
  return entries
    .filter(
      (entry) =>
        /monetary policy meeting/i.test(entry.text) &&
        !/non-monetary/i.test(entry.text) &&
        !/general council/i.test(entry.text) &&
        /followed by press conference/i.test(entry.text),
    )
    .map((entry) => ({
      id: `ecb-decision-${entry.day}`,
      kind: 'ecb-decision' as const,
      // 14 h 15 à Francfort pour le communiqué, 14 h 45 pour la conférence de presse. La page ne
      // porte pas l'heure des réunions : c'est une convention connue, d'où `precision: 'day'`,
      // qui empêche l'écran d'afficher une heure que la source n'annonce pas.
      at: frankfurtToUtc(entry.day, '14:15'),
      precision: 'day' as const,
      title: 'Décision de la BCE (Conseil des gouverneurs)',
      detail: 'Communiqué puis conférence de presse',
      tier: 'major' as const,
      source: 'ecb' as const,
      url: ECB_GC_URL,
    }));
}

/**
 * Inflation de la zone euro. L'estimation **rapide** sort en fin de mois de référence, le chiffre
 * **définitif** deux à trois semaines plus tard. Seule la première surprend les marchés : la
 * seconde confirme presque toujours, d'où deux rangs différents.
 *
 * La page annonce l'heure, contrairement au calendrier des réunions — d'où `precision: 'exact'`.
 */
export function hicpEvents(entries: readonly EcbEntry[]): MarketEvent[] {
  return entries
    .filter((entry) => /\bHICP\b/.test(entry.text) && entry.time !== null)
    .map((entry) => {
      const flash = /flash estimate/i.test(entry.text);
      return {
        id: `eurostat-hicp-${flash ? 'flash' : 'final'}-${entry.day}`,
        kind: 'hicp' as const,
        at: frankfurtToUtc(entry.day, entry.time as string),
        precision: 'exact' as const,
        title: flash
          ? 'Inflation zone euro (estimation rapide)'
          : 'Inflation zone euro (définitif)',
        detail: flash ? 'IPCH, première estimation' : 'IPCH, chiffre révisé',
        tier: flash ? ('major' as const) : ('secondary' as const),
        source: 'eurostat' as const,
        url: ECB_HICP_URL,
      };
    });
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
  bls: BlsState,
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

  /**
   * Le doute, pas la brièveté. Une table courte est normale entre deux publications annuelles du
   * BLS ; ce qui n'est pas normal, c'est qu'elle soit courte sans que personne ne l'ait regardée
   * depuis longtemps — là, on ne sait plus si elle est complète, et on refuse d'écrire.
   */
  const tooShort = bls.coverageEnd < addMonths(today, BLS_MIN_MONTHS_AHEAD);
  const checkIsStale = bls.checkedOn < addDays(today, -BLS_CHECK_STALE_DAYS);
  if (tooShort && checkIsStale) {
    problems.push(
      `BLS : la table s'arrête au ${bls.coverageEnd}, soit moins de ${BLS_MIN_MONTHS_AHEAD} mois ` +
        `devant nous, et sa dernière relecture date du ${bls.checkedOn}. Rouvrez les quatre pages ` +
        'officielles dans un navigateur (leurs URL sont dans src/lib/calendar/bls-schedule.ts), ' +
        'reportez les dates, et mettez BLS_CHECKED_ON à jour même si rien n’a changé.',
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

/**
 * Rend la liste des avertissements : des choses à surveiller, **jamais** des raisons de ne pas
 * écrire. Vide = rien à signaler.
 *
 * Le seul cas aujourd'hui est la table du BLS qui se vide sans que ce soit la faute de personne.
 * L'avertissement sert à ce qu'on revienne voir, pas à punir.
 */
export function gateWarnings(today: string, bls: BlsState): string[] {
  if (bls.coverageEnd >= addMonths(today, BLS_WARN_MONTHS_AHEAD)) return [];
  return [
    `La table du BLS s'arrête au ${bls.coverageEnd} et a été relue le ${bls.checkedOn} : elle est ` +
      'donc complète, mais courte. Le BLS ne publie son calendrier de l’année suivante qu’à ' +
      'l’automne — vérifiez s’il est paru, et mettez BLS_CHECKED_ON à jour dans tous les cas.',
  ];
}

/**
 * Restitue les avertissements à GitHub Actions : une annotation visible sur le run, et deux sorties
 * d'étape dont le workflow fait un rappel. Hors Actions, seule l'annotation part sur la sortie
 * standard, où elle se lit comme une ligne ordinaire.
 */
function reportWarnings(warnings: readonly string[], bls: BlsState): void {
  for (const warning of warnings) {
    console.warn(`Avertissement — ${warning}`);
    console.log(`::warning file=src/lib/calendar/bls-schedule.ts::${warning}`);
  }
  const outputFile = process.env['GITHUB_OUTPUT'];
  if (!outputFile) return;
  const lines = [
    `bls_warning=${warnings.length > 0 ? 'true' : 'false'}`,
    `bls_coverage_end=${bls.coverageEnd}`,
    `bls_checked_on=${bls.checkedOn}`,
  ];
  appendFileSync(outputFile, `${lines.join('\n')}\n`, 'utf8');
}

// ─── Rendu ───────────────────────────────────────────────────────────────────

const literal = (value: string): string => JSON.stringify(value);

/**
 * Passe le rendu par Prettier, avec la configuration du dépôt.
 *
 * Sans cela, `literal` engendre des guillemets doubles que `prettier --check` refuse : le fichier
 * engendré différait donc **toujours** de sa version committée, le générateur le réécrivait à
 * chaque fois, et `npm run check` échouait dans le cron — qui n'a ainsi jamais réussi à publier
 * (constaté le 01/09/2026 : run 33398994222 en échec, issue #39). Formater ici plutôt que dans le
 * workflow garde la comparaison « rien n'a changé sauf l'horodatage » vraie.
 */
async function prettify(source: string, filepath: string): Promise<string> {
  const options = await resolveConfig(filepath);
  return format(source, { ...options, filepath });
}

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
  const [fomcHtml, beaJson, ecbGcHtml, ecbHicpHtml] = await Promise.all([
    fetchText(FOMC_URL),
    fetchText(BEA_URL),
    fetchText(ECB_GC_URL),
    fetchText(ECB_HICP_URL),
  ]);
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
  const allEcb = ecbDecisionEvents(parseEcbEntries(ecbGcHtml));
  const allEurostat = hicpEvents(parseEcbEntries(ecbHicpHtml));

  const fomc = inWindow(allFomc);
  const bea = inWindow(allBea);
  const bls = inWindow(allBls);
  const ecb = inWindow(allEcb);
  const eurostat = inWindow(allEurostat);

  const events = [...fomc, ...bea, ...bls, ...ecb, ...eurostat].sort((a, b) =>
    a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at),
  );

  const blsState = { coverageEnd: blsCoverageEnd(), checkedOn: BLS_CHECKED_ON };

  const problems = gateProblems(events, { fomc, bea, bls, ecb, eurostat }, today, blsState);
  if (problems.length > 0) {
    console.error('Calendrier NON écrit — barrières non franchies :');
    for (const problem of problems) console.error(`  • ${problem}`);
    return 1;
  }

  // Les barrières sont franchies : ce qui suit se signale, mais n'empêche jamais d'écrire.
  reportWarnings(gateWarnings(today, blsState), blsState);

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
    {
      source: 'ecb',
      checkedOn: today,
      count: ecb.length,
      coversTo: lastDayOf(allEcb),
      upkeep: 'auto',
    },
    {
      source: 'eurostat',
      checkedOn: today,
      count: eurostat.length,
      coversTo: lastDayOf(allEurostat),
      upkeep: 'auto',
    },
  ];

  // Le calendrier n'est complet que jusqu'au plus court des horizons : c'est ce que l'écran annonce.
  const completeTo = sources.reduce(
    (soonest, source) => (source.coversTo < soonest ? source.coversTo : soonest),
    sources[0]?.coversTo ?? today,
  );

  const next = await prettify(
    render({
      generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      coversFrom: dayOf(first.at),
      coversTo: dayOf(last.at),
      completeTo,
      sources,
      events,
    }),
    OUTPUT,
  );

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
      `(FOMC ${fomc.length}, BEA ${bea.length}, BLS ${bls.length}, BCE ${ecb.length}, Eurostat ${eurostat.length}).`,
  );
  return 0;
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
if (isMain) process.exitCode = await main(process.argv.includes('--check'));
