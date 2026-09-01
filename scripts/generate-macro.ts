/**
 * Engendre `src/lib/macro/snapshot.generated.ts` — les indicateurs macroéconomiques.
 *   node scripts/generate-macro.ts [--check]
 *
 * Même principe que le calendrier (décision n° 58) : un module TypeScript committé, compilé dans
 * le bundle, donc aucune requête à l'exécution. Et la même règle de fond — **la licence choisit le
 * mode de transport**. Ne sont récupérées ici que des sources qui autorisent explicitement le
 * stockage et la redistribution :
 *
 * - **Trésor américain** — œuvre du gouvernement fédéral (17 U.S.C. § 105).
 * - **Réserve fédérale** — « information on the Board's website is in the public domain and may be
 *   copied and distributed without permission. Please cite to the Board as the source ».
 * - **EIA** — « U.S. government publications are in the public domain », redistribution explicite.
 *
 * Sont **écartées** faute de droit, malgré leur intérêt : le VIX de Cboe, dont les conditions
 * interdisent de « store either in hard copy or in an electronic retrieval system » sans accord
 * écrit — et dont le serveur n'ouvre d'ailleurs pas le CORS, ce qui ferme aussi l'appel direct.
 *
 * Les calculs vivent dans `src/lib/macro/stats.ts`, module pur et testé : ici, on ne fait que
 * récupérer, sélectionner et assembler.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  asOf,
  msToDay,
  percentileRank,
  shiftDay,
  since,
  toCompact,
  transformSeries,
  type DayValue,
} from '../src/lib/macro/stats.ts';
import type {
  MacroIndicator,
  MacroSnapshot,
  MacroSourceStamp,
  Rank,
  Transform,
} from '../src/lib/macro/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'src', 'lib', 'macro', 'snapshot.generated.ts');
const TIMEOUT_MS = 60_000;

/** Première année récupérée : de quoi asseoir un percentile sur dix ans. */
const FIRST_YEAR = 2015;

export const TREASURY_PAGE =
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates';
export const FED_H41_PAGE = 'https://www.federalreserve.gov/releases/h41/';
export const EIA_PAGE = 'https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm';

const treasuryXmlUrl = (dataset: string, year: number): string =>
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml' +
  `?data=${dataset}&field_tdr_date_value=${year}`;

/**
 * Le jeu de séries H.4.1 du Data Download Program.
 *
 * L'identifiant `series=` est un **jeu de sélection** produit par l'interface de la Fed, pas un
 * nom de série : il n'est pas devinable, et c'est pourquoi il est figé ici avec ce commentaire.
 * Le fichier qu'il rend contient une ligne d'en-tête portant les identifiants courts et stables
 * (`RESH4R_N.WW`…) : c'est par eux que les colonnes sont choisies, jamais par leur libellé, qui
 * peut être réécrit. Une colonne manquante fait échouer la génération plutôt que de produire un
 * indicateur muet.
 */
const FED_H41_SELECTION = 'cc73dc54904678a485aa7d87a81c786f';

const fedH41Url = (): string =>
  'https://www.federalreserve.gov/datadownload/Output.aspx' +
  `?rel=H41&series=${FED_H41_SELECTION}&from=01/01/${FIRST_YEAR}&to=12/31/2035` +
  '&filetype=csv&label=include&layout=seriescolumn';

/** Réserves des banques auprès de la Fed, niveau du mercredi, en millions de dollars. */
export const FED_RESERVES_ID = 'RESH4R_N.WW';

// ─── Réseau ──────────────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent':
          'cout-revient-ch macro generator (+https://github.com/jeremyH974/cout-revient-ch)',
        accept: 'application/xml,text/csv,application/json',
      },
    });
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Trésor ──────────────────────────────────────────────────────────────────

/**
 * Lit un champ du flux OData du Trésor.
 *
 * Le flux est un Atom où chaque `<entry>` porte `<d:NEW_DATE>` et un champ par maturité
 * (`BC_10YEAR` pour le nominal, `TC_10YEAR` pour le réel). Une entrée sans le champ demandé — cela
 * arrive quand une maturité n'est pas cotée ce jour-là — est ignorée, jamais comblée.
 */
export function parseTreasuryXml(xml: string, field: string): DayValue[] {
  const out: DayValue[] = [];
  const dayPattern = /<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})/;
  const valuePattern = new RegExp(`<d:${field}[^>]*>([-\\d.]+)</d:${field}>`);
  for (const entry of xml.split('<entry')) {
    const day = dayPattern.exec(entry)?.[1];
    const raw = valuePattern.exec(entry)?.[1];
    if (!day || raw === undefined) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) out.push({ day, value });
  }
  out.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

// ─── Réserve fédérale ────────────────────────────────────────────────────────

/** Découpe une ligne CSV en respectant les guillemets : les libellés de la Fed contiennent des virgules. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) {
      out.push(field);
      field = '';
    } else field += character;
  }
  out.push(field);
  return out;
}

/**
 * Extrait une série du CSV du Data Download Program, **par identifiant stable**.
 *
 * Le fichier commence par cinq lignes de métadonnées (libellés, unité, multiplicateur, devise,
 * identifiant long), puis une ligne d'en-tête `"Time Period","RESH4R_N.WW",…`, puis les données.
 * Un identifiant absent lève : mieux vaut une génération qui échoue qu'un indicateur silencieux.
 */
export function parseFedCsv(csv: string, seriesId: string): DayValue[] {
  const lines = csv.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith('"Time Period"'));
  if (headerIndex < 0) throw new Error('H.4.1 : ligne d’en-tête « Time Period » introuvable');
  const header = splitCsvLine(lines[headerIndex] ?? '');
  const column = header.indexOf(seriesId);
  if (column < 0) throw new Error(`H.4.1 : série « ${seriesId} » absente du fichier`);

  const out: DayValue[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const day = cells[0]?.trim();
    const raw = cells[column]?.trim();
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !raw || raw === 'ND') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) out.push({ day, value });
  }
  out.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

// ─── EIA ─────────────────────────────────────────────────────────────────────

/** Prix spot quotidien du WTI. L'API rend `{ response: { data: [{ period, value }] } }`. */
export function parseEia(payload: unknown): DayValue[] {
  const rows = (payload as { response?: { data?: unknown } } | null)?.response?.data;
  if (!Array.isArray(rows)) throw new Error('EIA : réponse inattendue');
  const out: DayValue[] = [];
  for (const row of rows) {
    const record = row as { period?: unknown; value?: unknown };
    const day = typeof record.period === 'string' ? record.period : null;
    const value = Number(record.value);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(value)) continue;
    out.push({ day, value });
  }
  out.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

// ─── Assemblage ──────────────────────────────────────────────────────────────

/** Différence de deux séries, sur les seuls jours où les deux existent. */
export function spread(long: readonly DayValue[], short: readonly DayValue[]): DayValue[] {
  const byDay = new Map(short.map((point) => [point.day, point.value]));
  const out: DayValue[] = [];
  for (const point of long) {
    const other = byDay.get(point.day);
    if (other === undefined) continue;
    out.push({ day: point.day, value: point.value - other });
  }
  return out;
}

/** Fenêtres nommées, exprimées en jours ou par une date de départ fixe. */
export interface Window {
  label: string;
  days?: number;
  from?: string;
}

/**
 * Rangs de la valeur courante dans chaque fenêtre.
 *
 * Le percentile est calculé sur la série **transformée**, jamais sur un niveau qui dérive, et sur
 * la fenêtre glissante qui précède la dernière observation — donc sans jamais regarder au-delà.
 */
export function ranksOf(series: readonly DayValue[], windows: readonly Window[]): Rank[] {
  const last = series[series.length - 1];
  if (!last) return [];
  const ranks: Rank[] = [];
  for (const window of windows) {
    const from = window.from ?? shiftDay(last.day, -(window.days ?? 365));
    const values = since(series, from).map((point) => point.value);
    if (values.length < 20) continue; // un rang sur moins de vingt points ne veut rien dire
    ranks.push({
      window: window.label,
      percentile: Math.round(percentileRank(values, last.value) * 10) / 10,
      observations: values.length,
    });
  }
  return ranks;
}

export interface IndicatorSpec {
  id: string;
  label: string;
  detail: string;
  unit: MacroIndicator['unit'];
  transform: Transform;
  windows: readonly Window[];
  source: MacroIndicator['source'];
  url: string;
  staleAfterDays: number;
  caveat?: string;
  /** Facteur appliqué à la valeur brute (millions → milliards, par exemple). */
  scale?: number;
}

/** Deux ans de série embarqués : sparkline, et matière première des corrélations à venir. */
const SERIES_DAYS = 730;

/**
 * Arrondi à six **chiffres significatifs**, et non à un nombre fixe de décimales.
 *
 * Un arrondi à trois décimales convient à un taux (4,73) et à des milliards (−150,201), mais
 * réduirait à zéro tout indicateur de faible magnitude qu'on ajouterait ensuite — un ratio, une
 * part de marché. Les chiffres significatifs ne dépendent pas de l'unité choisie ; six suffisent
 * largement à une donnée macro, dont la sixième décimale n'a aucun sens économique.
 */
const round = (value: number): number => Number(value.toPrecision(6));

export function buildIndicator(
  spec: IndicatorSpec,
  raw: readonly DayValue[],
): MacroIndicator | null {
  const scaled =
    spec.scale === undefined ? [...raw] : raw.map((p) => ({ ...p, value: p.value * spec.scale! }));
  const transformed =
    spec.transform === 'volatility' ? scaled : transformSeries(scaled, spec.transform);
  const last = transformed[transformed.length - 1];
  if (!last) return null;
  return {
    id: spec.id,
    label: spec.label,
    detail: spec.detail,
    unit: spec.unit,
    transform: spec.transform,
    value: round(last.value),
    asOf: last.day,
    staleAfterDays: spec.staleAfterDays,
    ranks: ranksOf(transformed, spec.windows),
    series: toCompact(
      since(transformed, shiftDay(last.day, -SERIES_DAYS)).map((p) => ({
        ...p,
        value: round(p.value),
      })),
    ),
    source: spec.source,
    url: spec.url,
    ...(spec.caveat === undefined ? {} : { caveat: spec.caveat }),
  };
}

const YEAR = 365;
const WINDOWS_1_5 = [
  { label: '1y', days: YEAR },
  { label: '5y', days: 5 * YEAR },
] as const;
const WINDOWS_1_10 = [
  { label: '1y', days: YEAR },
  { label: '10y', days: 10 * YEAR },
] as const;

export const SPECS: Record<string, IndicatorSpec> = {
  realTenYear: {
    id: 'real-10y',
    label: 'Taux réel à 10 ans',
    detail: 'Rendement des obligations américaines indexées sur l’inflation (TIPS).',
    unit: 'percent',
    transform: 'level',
    windows: WINDOWS_1_10,
    source: 'treasury',
    url: TREASURY_PAGE,
    staleAfterDays: 5,
  },
  spread: {
    id: 'spread-2s10s',
    label: 'Pente de la courbe (10 ans − 2 ans)',
    detail: 'Écart entre le taux à dix ans et celui à deux ans, en points de pourcentage.',
    unit: 'percentPoints',
    transform: 'level',
    windows: WINDOWS_1_10,
    source: 'treasury',
    url: TREASURY_PAGE,
    staleAfterDays: 5,
  },
  tenYear: {
    id: 'nominal-10y',
    label: 'Taux à 10 ans',
    detail: 'Rendement des obligations d’État américaines à dix ans.',
    unit: 'percent',
    transform: 'level',
    windows: WINDOWS_1_5,
    source: 'treasury',
    url: TREASURY_PAGE,
    staleAfterDays: 5,
  },
  reserves: {
    id: 'bank-reserves',
    label: 'Réserves bancaires à la Fed',
    detail: 'Variation sur trois mois des réserves détenues par les banques auprès de la Fed.',
    unit: 'usdBillions',
    transform: 'change3m',
    windows: [
      { label: '1y', days: YEAR },
      { label: 'depuis 2021', from: '2021-01-01' },
    ],
    source: 'fed',
    url: FED_H41_PAGE,
    staleAfterDays: 12,
    scale: 1 / 1000, // millions → milliards
    caveat:
      'Chiffre publié par la Fed. Proche de la « liquidité nette » que suivent beaucoup d’observateurs, qui la reconstituent à la main — mais celle-ci n’est pas une statistique officielle, et son lien avec les marchés est réel sans être mécanique.',
  },
  oil: {
    id: 'wti',
    label: 'Pétrole (WTI)',
    detail: 'Variation sur douze mois du prix du baril, en pourcentage.',
    unit: 'percent',
    transform: 'yoy',
    windows: WINDOWS_1_5,
    source: 'eia',
    url: EIA_PAGE,
    staleAfterDays: 7,
  },
};

// ─── Barrières ───────────────────────────────────────────────────────────────

/** Rend les raisons de NE PAS écrire. Vide = tout va bien. */
export function gateProblems(indicators: readonly MacroIndicator[], today: string): string[] {
  const problems: string[] = [];
  const required = ['real-10y', 'spread-2s10s', 'nominal-10y', 'bank-reserves'];
  for (const id of required) {
    if (!indicators.some((indicator) => indicator.id === id)) {
      problems.push(`indicateur obligatoire absent : ${id}`);
    }
  }
  for (const indicator of indicators) {
    const age = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${indicator.asOf}T00:00:00Z`)) / 86_400_000,
    );
    if (age > indicator.staleAfterDays * 3) {
      problems.push(
        `${indicator.id} : dernière observation il y a ${age} jours (${indicator.asOf})`,
      );
    }
    if (indicator.ranks.length === 0) {
      problems.push(`${indicator.id} : aucun rang calculable, l’historique est-il arrivé ?`);
    }
    if (indicator.series.values.length < 200) {
      problems.push(
        `${indicator.id} : série de ${indicator.series.values.length} jours, trop courte`,
      );
    }
  }
  return problems;
}

// ─── Rendu ───────────────────────────────────────────────────────────────────

const literal = (value: unknown): string => JSON.stringify(value);

/**
 * Passe le rendu par Prettier, avec la configuration du dépôt. Même raison que dans
 * `generate-calendar.ts` : `literal` engendre des guillemets doubles que `prettier --check`
 * refuse, ce qui faisait échouer `npm run check` dans le cron et empêchait toute publication.
 */
async function prettify(source: string, filepath: string): Promise<string> {
  const options = await resolveConfig(filepath);
  return format(source, { ...options, filepath });
}

export function render(snapshot: MacroSnapshot): string {
  const lines = [
    '// @generated par `node scripts/generate-macro.ts` — NE PAS MODIFIER À LA MAIN.',
    '//',
    '// Sources autorisant explicitement le stockage et la redistribution : Trésor américain,',
    '// Réserve fédérale, EIA. Voir `types.ts` pour ce que chaque champ engage.',
    '',
    "import type { MacroSnapshot } from './types';",
    '',
    'export const MACRO: MacroSnapshot = {',
    `  generatedAt: ${literal(snapshot.generatedAt)},`,
    '  sources: [',
    ...snapshot.sources.map(
      (s) =>
        `    { source: ${literal(s.source)}, checkedOn: ${literal(s.checkedOn)}, count: ${s.count}` +
        `${s.missing === undefined ? '' : `, missing: ${literal(s.missing)}`} },`,
    ),
    '  ],',
    '  indicators: [',
  ];
  for (const indicator of snapshot.indicators) {
    lines.push(
      '    {',
      `      id: ${literal(indicator.id)},`,
      `      label: ${literal(indicator.label)},`,
      `      detail: ${literal(indicator.detail)},`,
      `      unit: ${literal(indicator.unit)},`,
      `      transform: ${literal(indicator.transform)},`,
      `      value: ${indicator.value},`,
      `      asOf: ${literal(indicator.asOf)},`,
      `      staleAfterDays: ${indicator.staleAfterDays},`,
      `      ranks: [${indicator.ranks
        .map(
          (r) =>
            `{ window: ${literal(r.window)}, percentile: ${r.percentile}, observations: ${r.observations} }`,
        )
        .join(', ')}],`,
      ...(indicator.caveat === undefined ? [] : [`      caveat: ${literal(indicator.caveat)},`]),
      `      source: ${literal(indicator.source)},`,
      `      url: ${literal(indicator.url)},`,
      // `join` rendrait `null` par une chaîne vide, donc `[2.4,,2.42]` : un tableau **à trou**,
      // dont l'élément absent vaut `undefined` et non `null`. Chaque valeur est écrite en clair.
      `      series: { from: ${literal(indicator.series.from)}, values: [${indicator.series.values
        .map((value) => (value === null ? 'null' : String(value)))
        .join(',')}] },`,
      '    },',
    );
  }
  lines.push('  ],', '};', '');
  return lines.join('\n');
}

/** Deux rendus sont « les mêmes » si seul leur horodatage de génération diffère. */
export const withoutStamp = (text: string): string =>
  text.replace(/^ {2}generatedAt: .*$/m, '  generatedAt: —');

// ─── Exécution ───────────────────────────────────────────────────────────────

export async function main(checkOnly: boolean): Promise<number> {
  const today = msToDay(Date.now());
  const currentYear = Number(today.slice(0, 4));
  const years = Array.from({ length: currentYear - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

  const [nominalPages, realPages, fedCsv] = await Promise.all([
    Promise.all(years.map((year) => fetchText(treasuryXmlUrl('daily_treasury_yield_curve', year)))),
    Promise.all(
      years.map((year) => fetchText(treasuryXmlUrl('daily_treasury_real_yield_curve', year))),
    ),
    fetchText(fedH41Url()),
  ]);

  const tenYear = nominalPages.flatMap((xml) => parseTreasuryXml(xml, 'BC_10YEAR'));
  const twoYear = nominalPages.flatMap((xml) => parseTreasuryXml(xml, 'BC_2YEAR'));
  const realTenYear = realPages.flatMap((xml) => parseTreasuryXml(xml, 'TC_10YEAR'));
  const reserves = parseFedCsv(fedCsv, FED_RESERVES_ID);
  for (const series of [tenYear, twoYear, realTenYear]) {
    series.sort((a, b) => a.day.localeCompare(b.day));
  }

  const indicators: MacroIndicator[] = [];
  const push = (spec: IndicatorSpec, series: readonly DayValue[]): void => {
    const built = buildIndicator(spec, series);
    if (built) indicators.push(built);
  };
  push(SPECS['realTenYear']!, realTenYear);
  push(SPECS['spread']!, spread(tenYear, twoYear));
  push(SPECS['tenYear']!, tenYear);
  push(SPECS['reserves']!, reserves);

  // Le pétrole est facultatif : sans clé, l'indicateur est absent et la raison est enregistrée,
  // plutôt que de faire échouer une génération que rien n'empêche par ailleurs.
  const eiaKey = process.env['EIA_API_KEY'];
  let oilMissing: string | undefined = 'clé EIA_API_KEY absente';
  if (eiaKey) {
    try {
      const payload: unknown = JSON.parse(
        await fetchText(
          'https://api.eia.gov/v2/petroleum/pri/spt/data/' +
            `?api_key=${encodeURIComponent(eiaKey)}&frequency=daily&data[0]=value` +
            '&facets[series][]=RWTC&sort[0][column]=period&sort[0][direction]=desc&length=5000',
        ),
      );
      push(SPECS['oil']!, parseEia(payload));
      oilMissing = undefined;
    } catch (error) {
      oilMissing = `EIA injoignable : ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const problems = gateProblems(indicators, today);
  if (problems.length > 0) {
    console.error('Instantané macro NON écrit — barrières non franchies :');
    for (const problem of problems) console.error(`  • ${problem}`);
    return 1;
  }

  const countOf = (source: string): number =>
    indicators.filter((indicator) => indicator.source === source).length;
  const sources: MacroSourceStamp[] = [
    { source: 'treasury', checkedOn: today, count: countOf('treasury') },
    { source: 'fed', checkedOn: today, count: countOf('fed') },
    {
      source: 'eia',
      checkedOn: today,
      count: countOf('eia'),
      ...(oilMissing === undefined ? {} : { missing: oilMissing }),
    },
  ];

  const next = await prettify(
    render({
      generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      sources,
      indicators,
    }),
    OUTPUT,
  );

  let previous = '';
  try {
    previous = readFileSync(OUTPUT, 'utf8');
  } catch {
    // Première génération : rien à comparer.
  }
  if (withoutStamp(previous) === withoutStamp(next)) {
    console.log(`Instantané macro inchangé (${indicators.length} indicateurs).`);
    return 0;
  }
  if (checkOnly) {
    console.error('L’instantané macro n’est pas à jour. Lancez `npm run macro`.');
    return 1;
  }

  writeFileSync(OUTPUT, next, 'utf8');
  const freshest = indicators.reduce((latest, i) => (i.asOf > latest ? i.asOf : latest), '');
  console.log(
    `Instantané macro écrit : ${indicators.length} indicateurs, dernière observation ${freshest}` +
      `${oilMissing === undefined ? '' : ` (pétrole absent : ${oilMissing})`}.`,
  );
  return 0;
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
if (isMain) process.exitCode = await main(process.argv.includes('--check'));

// `asOf` est réexporté pour les tests : le générateur s'en sert indirectement via `stats.ts`.
export { asOf };
