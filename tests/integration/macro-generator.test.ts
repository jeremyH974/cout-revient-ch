/**
 * Les analyseurs de l'instantané macro, éprouvés hors ligne sur des extraits réels des sources.
 *
 * Le point vérifié avec le plus d'insistance : **les colonnes de la Fed sont choisies par leur
 * identifiant stable, jamais par leur libellé**. Le fichier H.4.1 compte cent cinquante-sept
 * colonnes dont les descriptions contiennent des virgules et peuvent être réécrites ; sélectionner
 * par position ou par texte reviendrait à afficher un jour la mauvaise série sans s'en apercevoir.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ECB_DFR_ID,
  FED_RESERVES_ID,
  buildIndicator,
  fetchText,
  gateProblems,
  parseEia,
  parseEcbSdmxCsv,
  parseFedCsv,
  parseTreasuryXml,
  ranksOf,
  render,
  splitCsvLine,
  spread,
  withoutStamp,
  type IndicatorSpec,
} from '../../scripts/generate-macro.ts';
import { shiftDay, type DayValue } from '../../src/lib/macro/stats';
import type { MacroIndicator } from '../../src/lib/macro/types';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'macro');
const NOMINAL = readFileSync(join(FIXTURES, 'treasury-yield-curve.xml'), 'utf8');
const REAL = readFileSync(join(FIXTURES, 'treasury-real-yield-curve.xml'), 'utf8');
const FED = readFileSync(join(FIXTURES, 'fed-h41.csv'), 'utf8');

describe('flux du Trésor', () => {
  it('lit le taux à dix ans, daté et trié', () => {
    const series = parseTreasuryXml(NOMINAL, 'BC_10YEAR');
    expect(series.length).toBeGreaterThan(4);
    expect(series.map((p) => p.day)).toEqual([...series.map((p) => p.day)].sort());
    for (const point of series) {
      expect(point.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(point.value).toBeGreaterThan(0);
      expect(point.value).toBeLessThan(25);
    }
  });

  it('distingue les maturités', () => {
    const ten = parseTreasuryXml(NOMINAL, 'BC_10YEAR');
    const two = parseTreasuryXml(NOMINAL, 'BC_2YEAR');
    expect(ten).toHaveLength(two.length);
    expect(ten.map((p) => p.value)).not.toEqual(two.map((p) => p.value));
  });

  it('lit le taux réel, dont le champ porte un autre préfixe', () => {
    const real = parseTreasuryXml(REAL, 'TC_10YEAR');
    expect(real.length).toBeGreaterThan(3);
    // Le taux réel est nettement inférieur au nominal : c'est la compensation d'inflation.
    const nominal = parseTreasuryXml(NOMINAL, 'BC_10YEAR');
    expect(real[0]!.value).toBeLessThan(nominal[0]!.value);
  });

  it('ignore une maturité absente plutôt que de la combler', () => {
    expect(parseTreasuryXml(NOMINAL, 'BC_42YEAR')).toEqual([]);
    expect(parseTreasuryXml('<feed></feed>', 'BC_10YEAR')).toEqual([]);
  });
});

describe('CSV de la Réserve fédérale', () => {
  it('découpe une ligne en respectant les guillemets', () => {
    expect(splitCsvLine('"a,b","c",d')).toEqual(['a,b', 'c', 'd']);
    expect(splitCsvLine('')).toEqual(['']);
  });

  it('sélectionne les réserves bancaires par identifiant stable', () => {
    const series = parseFedCsv(FED, FED_RESERVES_ID);
    expect(series.length).toBeGreaterThan(8);
    for (const point of series) {
      // Millions de dollars : les réserves se comptent en milliers de milliards.
      expect(point.value).toBeGreaterThan(1_000_000);
      expect(point.value).toBeLessThan(20_000_000);
    }
  });

  it('rend une série hebdomadaire, un point par mercredi', () => {
    const series = parseFedCsv(FED, FED_RESERVES_ID);
    for (let i = 1; i < series.length; i += 1) {
      expect(shiftDay(series[i - 1]!.day, 7)).toBe(series[i]!.day);
    }
  });

  it('échoue bruyamment sur une série absente plutôt que de rendre du vide', () => {
    expect(() => parseFedCsv(FED, 'SERIE_QUI_N_EXISTE_PAS')).toThrow(/absente/);
  });

  it('échoue si la ligne d’en-tête a disparu', () => {
    expect(() => parseFedCsv('rien du tout', FED_RESERVES_ID)).toThrow(/en-tête/);
  });

  it('ne choisit pas la colonne par son libellé, qui contient des virgules', () => {
    // Le fichier compte plus de colonnes que de libellés naïvement découpés à la virgule : c'est
    // exactement le piège que l'identifiant évite.
    const first = FED.split(/\r?\n/)[0] ?? '';
    expect(first.split(',').length).toBeGreaterThan(splitCsvLine(first).length);
  });
});

describe('EIA', () => {
  it('lit les prix quotidiens', () => {
    const series = parseEia({
      response: {
        data: [
          { period: '2026-08-28', value: 71.2 },
          { period: '2026-08-27', value: 70.4 },
        ],
      },
    });
    expect(series).toEqual([
      { day: '2026-08-27', value: 70.4 },
      { day: '2026-08-28', value: 71.2 },
    ]);
  });

  it('refuse une réponse d’une autre forme', () => {
    expect(() => parseEia({})).toThrow(/inattendue/);
    expect(() => parseEia(null)).toThrow();
  });

  it('ignore une ligne inexploitable sans faire tomber le reste', () => {
    const series = parseEia({
      response: {
        data: [
          { period: 'bientôt', value: 1 },
          { period: '2026-01-02', value: 'x' },
          { period: '2026-01-03', value: 5 },
        ],
      },
    });
    expect(series).toEqual([{ day: '2026-01-03', value: 5 }]);
  });
});

describe('écart de deux séries', () => {
  it('ne retient que les jours communs', () => {
    const long: DayValue[] = [
      { day: '2026-01-01', value: 4.5 },
      { day: '2026-01-02', value: 4.6 },
      { day: '2026-01-03', value: 4.7 },
    ];
    const short: DayValue[] = [
      { day: '2026-01-02', value: 4.2 },
      { day: '2026-01-03', value: 4.4 },
    ];
    expect(spread(long, short)).toEqual([
      { day: '2026-01-02', value: expect.closeTo(0.4, 10) },
      { day: '2026-01-03', value: expect.closeTo(0.3, 10) },
    ]);
  });
});

describe('rangs', () => {
  const series: DayValue[] = Array.from({ length: 400 }, (_, i) => ({
    day: shiftDay('2025-01-01', i),
    value: i,
  }));

  it('classe la dernière valeur dans chaque fenêtre demandée', () => {
    const ranks = ranksOf(series, [{ label: '1y', days: 365 }]);
    expect(ranks).toHaveLength(1);
    // La dernière valeur est la plus haute de sa fenêtre : rang moyen juste sous 100.
    expect(ranks[0]!.percentile).toBeGreaterThan(99);
    expect(ranks[0]!.observations).toBe(366);
  });

  it('refuse un rang sur trop peu d’observations', () => {
    expect(ranksOf(series.slice(-10), [{ label: '1y', days: 365 }])).toEqual([]);
  });

  it('accepte une fenêtre à date de départ fixe', () => {
    const ranks = ranksOf(series, [{ label: 'depuis 2025', from: '2025-06-01' }]);
    expect(ranks[0]?.window).toBe('depuis 2025');
  });

  it('rend une liste vide sur une série vide', () => {
    expect(ranksOf([], [{ label: '1y', days: 365 }])).toEqual([]);
  });
});

describe('construction d’un indicateur', () => {
  const spec: IndicatorSpec = {
    id: 'test',
    label: 'Test',
    detail: 'Série de test.',
    unit: 'percent',
    transform: 'level',
    windows: [{ label: '1y', days: 365 }],
    source: 'treasury',
    url: 'https://example.invalid',
    staleAfterDays: 5,
  };
  const series: DayValue[] = Array.from({ length: 900 }, (_, i) => ({
    day: shiftDay('2024-01-01', i),
    value: 1 + i / 1000,
  }));

  it('n’embarque que deux ans de série, pas tout l’historique', () => {
    const indicator = buildIndicator(spec, series)!;
    expect(indicator.series.values.length).toBeLessThanOrEqual(731);
    expect(indicator.asOf).toBe(shiftDay('2024-01-01', 899));
  });

  it('applique l’échelle avant tout calcul', () => {
    const scaled = buildIndicator({ ...spec, scale: 1 / 1000 }, series)!;
    const plain = buildIndicator(spec, series)!;
    expect(scaled.value).toBeCloseTo(plain.value / 1000, 6);
  });

  it('rend null sur une série vide', () => {
    expect(buildIndicator(spec, [])).toBeNull();
  });

  it('n’ajoute une réserve que si la spécification en porte une', () => {
    expect(buildIndicator(spec, series)!.caveat).toBeUndefined();
    expect(buildIndicator({ ...spec, caveat: 'Attention.' }, series)!.caveat).toBe('Attention.');
  });
});

describe('barrières', () => {
  const indicator = (id: string, asOf: string): MacroIndicator => ({
    id,
    label: id,
    detail: '',
    unit: 'percent',
    transform: 'level',
    value: 1,
    asOf,
    staleAfterDays: 5,
    ranks: [{ window: '1y', percentile: 50, observations: 250 }],
    series: { from: '2025-01-01', values: Array.from({ length: 400 }, () => 1) },
    source: 'treasury',
    url: 'https://example.invalid',
  });
  const healthy = (): MacroIndicator[] =>
    ['real-10y', 'spread-2s10s', 'nominal-10y', 'bank-reserves'].map((id) =>
      indicator(id, '2026-08-28'),
    );

  it('laisse passer un instantané complet et frais', () => {
    expect(gateProblems(healthy(), '2026-08-29')).toEqual([]);
  });

  it('refuse un indicateur obligatoire manquant', () => {
    const problems = gateProblems(healthy().slice(1), '2026-08-29');
    expect(problems.join(' ')).toMatch(/real-10y/);
  });

  it('refuse une observation trop vieille pour sa propre tolérance', () => {
    const stale = [...healthy().slice(1), indicator('real-10y', '2026-06-01')];
    expect(gateProblems(stale, '2026-08-29').join(' ')).toMatch(/dernière observation/);
  });

  it('refuse un indicateur sans rang — le symptôme d’un historique qui n’est pas arrivé', () => {
    const noRank = healthy().map((i) => (i.id === 'nominal-10y' ? { ...i, ranks: [] } : i));
    expect(gateProblems(noRank, '2026-08-29').join(' ')).toMatch(/aucun rang/);
  });

  it('refuse une série trop courte pour tracer quoi que ce soit', () => {
    const short = healthy().map((i) =>
      i.id === 'spread-2s10s' ? { ...i, series: { from: '2026-01-01', values: [1, 2, 3] } } : i,
    );
    expect(gateProblems(short, '2026-08-29').join(' ')).toMatch(/trop courte/);
  });
});

describe('écriture', () => {
  const snapshot = {
    generatedAt: '2026-08-29T08:00:00Z',
    sources: [
      { source: 'treasury' as const, checkedOn: '2026-08-29', count: 3 },
      { source: 'eia' as const, checkedOn: '2026-08-29', count: 0, missing: 'clé absente' },
    ],
    indicators: [
      {
        id: 'real-10y',
        label: 'Taux réel à 10 ans',
        detail: 'Test.',
        unit: 'percent' as const,
        transform: 'level' as const,
        value: 2.42,
        asOf: '2026-08-28',
        staleAfterDays: 5,
        ranks: [{ window: '10y', percentile: 99.1, observations: 2499 }],
        series: { from: '2026-08-27', values: [2.4, null, 2.42] },
        source: 'treasury' as const,
        url: 'https://example.invalid',
      },
    ],
  };

  it('produit un module TypeScript relisible', () => {
    const text = render(snapshot);
    expect(text).toContain("import type { MacroSnapshot } from './types';");
    expect(text).toContain('export const MACRO: MacroSnapshot = {');
    expect(text).toContain('missing: "clé absente"');
    expect(text).toContain('values: [2.4,null,2.42]');
  });

  it('ignore le seul horodatage quand il compare deux versions', () => {
    const a = render(snapshot);
    const b = render({ ...snapshot, generatedAt: '2027-01-01T00:00:00Z' });
    expect(a).not.toBe(b);
    expect(withoutStamp(a)).toBe(withoutStamp(b));
  });
});

/**
 * Le taux directeur de la BCE, au format SDMX-CSV du portail de données (décision n° 93).
 *
 * Le fichier porte un en-tête NOMMÉ (`TIME_PERIOD`, `OBS_VALUE`), donc les colonnes se choisissent
 * par leur nom — encore plus solide que la sélection par identifiant du CSV de la Fed, qui doit
 * chercher `RESH4R_N.WW` parmi des dizaines de colonnes anonymes.
 */
describe('série SDMX de la BCE', () => {
  const ECB_CSV = readFileSync(join(FIXTURES, 'ecb-deposit-rate.csv'), 'utf8');

  it('lit la série demandée, triée, sans point aberrant', () => {
    const series = parseEcbSdmxCsv(ECB_CSV, ECB_DFR_ID);
    expect(series.length).toBeGreaterThan(20);
    for (const point of series) {
      expect(point.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(point.value)).toBe(true);
      // Un taux directeur de la zone euro tient largement dans ces bornes depuis 1999.
      expect(point.value).toBeGreaterThan(-2);
      expect(point.value).toBeLessThan(10);
    }
    const days = series.map((p) => p.day);
    expect([...days].sort()).toEqual(days);
  });

  it('une clé de série qui a changé rend une série VIDE, jamais des chiffres d’une autre série', () => {
    // C'est le point du contrôle sur la colonne `KEY` : si la BCE renomme sa clé, mieux vaut zéro
    // point — que la barrière du générateur attrapera — qu'un taux pris dans une série voisine.
    expect(parseEcbSdmxCsv(ECB_CSV, 'FM.D.U2.EUR.4F.KR.CLE.INVENTEE')).toEqual([]);
  });

  it('un en-tête sans les colonnes attendues ne devine rien', () => {
    expect(parseEcbSdmxCsv('A,B,C\n1,2,3\n', ECB_DFR_ID)).toEqual([]);
    expect(parseEcbSdmxCsv('', ECB_DFR_ID)).toEqual([]);
  });
});

/**
 * Une réponse vide n'est pas une source qui a changé (décision n° 98). Le Data Download Program
 * de la Fed rend `200 text/html` de zéro octet aussi bien pour une sélection retirée que pour un
 * hoquet passager : le générateur réessaie, et s'il persiste il nomme le vide au lieu d'accuser
 * la source d'avoir retiré une série qu'elle sert encore.
 */
describe('téléchargement : une non-réponse se réessaie, puis se nomme', () => {
  const respond = (body: string) =>
    ({ ok: true, status: 200, text: () => Promise.resolve(body) }) as unknown as Response;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('un corps vide déclenche un nouvel essai, et le second sert le document', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respond(''))
      .mockResolvedValueOnce(respond('"Time Period","RESH4R_N.WW"'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchText('https://example.test/h41.csv', { pauseMs: 0 })).resolves.toContain(
      'RESH4R_N.WW',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('un vide qui persiste échoue en nommant le vide, jamais la série', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(respond('   '));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchText('https://example.test/h41.csv', { pauseMs: 0 })).rejects.toThrow(
      /réponse vide/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('un HTTP en erreur reste un échec, réessayé lui aussi', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchText('https://example.test/h41.csv', { pauseMs: 0 })).rejects.toThrow(
      /HTTP 503/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
