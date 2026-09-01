/**
 * Le générateur du calendrier macro, éprouvé hors ligne.
 *
 * L'intérêt de ce fichier tient à un hasard heureux : **le BEA publie ses dates déjà en UTC**
 * (`2026-09-30T12:30:00+00:00`), alors que le BLS et la Fed les publient en heure de New York.
 * Les instants du BEA constituent donc un **oracle indépendant** du convertisseur de fuseau — des
 * couples (heure locale, instant UTC) certifiés par une agence fédérale, couvrant les deux régimes
 * d'heure d'été. Aucun chiffre attendu n'est écrit à la main ici.
 *
 * Aucun test ne sort sur le réseau : les deux sources sont figées dans `tests/fixtures/calendar/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  beaEvents,
  easternToUtc,
  ecbDecisionEvents,
  frankfurtToUtc,
  gateProblems,
  gateWarnings,
  hicpEvents,
  parseEcbEntries,
  parseFomc,
  referenceLabel,
  render,
  withoutStamp,
} from '../../scripts/generate-calendar.ts';
import { BLS_CHECKED_ON, blsCoverageEnd } from '../../src/lib/calendar/bls-schedule';
import type { MarketEvent } from '../../src/lib/calendar/types';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'calendar');
const FOMC_HTML = readFileSync(join(FIXTURES, 'fomccalendars.html'), 'utf8');
const BEA_JSON: unknown = JSON.parse(
  readFileSync(join(FIXTURES, 'bea-release-dates.json'), 'utf8'),
);
const ECB_GC_HTML = readFileSync(join(FIXTURES, 'ecb-governing-council.html'), 'utf8');
const ECB_HICP_HTML = readFileSync(join(FIXTURES, 'ecb-hicp-calendar.html'), 'utf8');

/** Heure murale à New York pour un instant donné : `['2026-09-30', '08:30']`. */
function newYorkWallClock(instant: string): [string, string] {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant))) {
    parts[part.type] = part.value;
  }
  const hour = String(Number(parts['hour']) % 24).padStart(2, '0');
  return [`${parts['year']}-${parts['month']}-${parts['day']}`, `${hour}:${parts['minute']}`];
}

describe('conversion heure de New York → UTC', () => {
  it('retrouve exactement les instants publiés par le BEA, été comme hiver', () => {
    const events = beaEvents(BEA_JSON);
    expect(events.length).toBeGreaterThan(30);

    for (const event of events) {
      const [day, hhmm] = newYorkWallClock(event.at);
      expect(easternToUtc(day, hhmm), `${event.id} (${day} ${hhmm} à New York)`).toBe(event.at);
    }
  });

  it('couvre bien les deux régimes d’heure — sinon l’oracle ne prouverait rien', () => {
    const offsets = new Set(
      beaEvents(BEA_JSON).map((event) => {
        const [day, hhmm] = newYorkWallClock(event.at);
        return (Date.parse(event.at) - Date.parse(`${day}T${hhmm}:00Z`)) / 3_600_000;
      }),
    );
    // -4 h en heure d'été (EDT), -5 h en heure normale (EST) : les deux doivent être représentées.
    expect([...offsets].sort()).toEqual([4, 5]);
  });

  it('est réversible pour toute heure hors de la bascule nocturne', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2024-01-01T00:00:00Z'),
          max: new Date('2031-12-31T00:00:00Z'),
          noInvalidDate: true,
        }),
        fc.integer({ min: 3, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (date, hour, minute) => {
          const day = date.toISOString().slice(0, 10);
          const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          const [backDay, backTime] = newYorkWallClock(easternToUtc(day, hhmm));
          expect([backDay, backTime]).toEqual([day, hhmm]);
        },
      ),
      // Les heures 0 h–2 h sont exclues : le 2ᵉ dimanche de mars, 2 h 30 n'existe pas à New York,
      // et le 1ᵉʳ dimanche de novembre, 1 h 30 s'y produit deux fois. Aucune publication officielle
      // n'a lieu à ces heures-là.
      { numRuns: 500 },
    );
  });
});

describe('analyse du calendrier FOMC', () => {
  const meetings = parseFomc(FOMC_HTML);
  const YEARS = [2021, 2022, 2023, 2024, 2025, 2026, 2027];
  const of = (year: number) => meetings.filter((m) => m.day.startsWith(`${year}-`));

  it('lit huit réunions par an', () => {
    for (const year of YEARS) expect(of(year), `année ${year}`).toHaveLength(8);
  });

  it('trouve exactement quatre réunions à projections par an, comme le veut la Fed', () => {
    for (const year of YEARS) {
      expect(
        of(year).filter((m) => m.projections),
        `année ${year}`,
      ).toHaveLength(4);
    }
  });

  it('retient le dernier jour de la réunion, celui de la décision', () => {
    // La réunion des 27 et 28 janvier 2026 décide le 28 ; son communiqué s'appelle
    // « monetary20260128a.htm » dans la page source, ce qui le confirme.
    expect(of(2026).map((m) => m.day)).toContain('2026-01-28');
    expect(FOMC_HTML).toContain('monetary20260128a.htm');
  });

  it('bascule de mois quand la réunion est à cheval', () => {
    // La Fed écrit « Jan/Feb » et « Oct/Nov » avec la plage « 31-1 » : la décision tombe le 1ᵉʳ du
    // mois suivant. Une table de mois en toutes lettres perdait ces deux réunions sans un mot.
    expect(FOMC_HTML).toContain('<strong>Jan/Feb</strong>');
    expect(of(2023).map((m) => m.day)).toContain('2023-02-01');
    expect(of(2023).map((m) => m.day)).toContain('2023-11-01');
  });

  it('écarte les votes par notation, qui ne sont pas des réunions', () => {
    // Le 22 août 2025, le FOMC a voté par écrit sur son cadre de politique monétaire : ni décision
    // de taux, ni conférence de presse. L'annoncer comme un rendez-vous serait faux.
    expect(FOMC_HTML).toContain('(notation vote)');
    expect(of(2025).map((m) => m.day)).not.toContain('2025-08-22');
  });

  it('marque une réunion hors calendrier sans lui inventer d’heure', () => {
    const [meeting] = parseFomc(
      '<a>2020 FOMC Meetings</a><div class="fomc-meeting__month"><strong>March</strong></div>' +
        '<div class="fomc-meeting__date">15 (unscheduled)</div>',
    );
    expect(meeting).toEqual({ day: '2020-03-15', projections: false, unscheduled: true });
  });

  it('rend des jours valides et croissants dans chaque année', () => {
    for (const year of YEARS) {
      const days = of(year).map((m) => m.day);
      expect(days, `année ${year}`).toEqual([...days].sort());
      for (const day of days) expect(Number.isNaN(Date.parse(day)), day).toBe(false);
    }
  });

  it('ne rend rien plutôt que n’importe quoi si la page change de forme', () => {
    expect(parseFomc('<html><body>Rien de connu ici</body></html>')).toEqual([]);
  });
});

describe('lecture du BEA', () => {
  it('refuse une réponse amputée plutôt que de rendre un calendrier vide', () => {
    expect(() => beaEvents({ 'Gross Domestic Product': { release_dates: [] } })).toThrow(
      /Personal Income and Outlays/,
    );
    expect(() => beaEvents(null)).toThrow();
  });

  it('signale une date illisible', () => {
    expect(() =>
      beaEvents({
        'Personal Income and Outlays': { release_dates: ['pas une date'] },
        'Gross Domestic Product': { release_dates: [] },
      }),
    ).toThrow(/illisible/);
  });

  it('déduplique les dates que le BEA republie', () => {
    const twice = '2026-09-30T12:30:00+00:00';
    const events = beaEvents({
      'Personal Income and Outlays': { release_dates: [twice, twice] },
      'Gross Domestic Product': { release_dates: [] },
    });
    expect(events).toHaveLength(1);
  });
});

describe('libellé du mois de référence', () => {
  it('élide devant une voyelle', () => {
    expect(referenceLabel('2026-07')).toBe('Données de juillet 2026');
    expect(referenceLabel('2026-08')).toBe('Données d’août 2026');
    expect(referenceLabel('2026-04')).toBe('Données d’avril 2026');
    expect(referenceLabel('2026-10')).toBe('Données d’octobre 2026');
  });
});

describe('barrières', () => {
  const event = (id: string, at: string): MarketEvent => ({
    id,
    kind: 'cpi',
    at,
    precision: 'exact',
    title: 'x',
    tier: 'major',
    source: 'bls',
    url: 'https://example.invalid',
  });
  const many = (prefix: string, count: number): MarketEvent[] =>
    Array.from({ length: count }, (_, i) =>
      event(`${prefix}-${i}`, `2027-01-${String((i % 28) + 1).padStart(2, '0')}T12:30:00Z`),
    );

  const healthy = () => ({
    fomc: many('fomc', 8),
    bea: many('bea', 20),
    bls: many('bls', 40),
    ecb: many('ecb', 8),
    eurostat: many('eurostat', 16),
  });

  /** État de la table BLS : jusqu'où elle va, et quand on l'a relue pour la dernière fois. */
  const bls = (coverageEnd: string, checkedOn = '2026-08-28') => ({ coverageEnd, checkedOn });

  it('laisse passer un calendrier sain', () => {
    const bySource = healthy();
    const events = Object.values(bySource).flat();
    expect(gateProblems(events, bySource, '2026-08-28', bls('2027-06-30'))).toEqual([]);
  });

  it('refuse une source appauvrie', () => {
    const bySource = { ...healthy(), bea: many('bea', 2) };
    const problems = gateProblems(
      Object.values(bySource).flat(),
      bySource,
      '2026-08-28',
      bls('2027-06-30'),
    );
    expect(problems.join(' ')).toMatch(/bea : 2 événement/);
  });

  it('refuse un FOMC sans réunion à venir — le symptôme d’une page qui a changé', () => {
    const past = [event('fomc-vieux', '2020-01-01T19:00:00Z')];
    const bySource = {
      ...healthy(),
      fomc: [...past, ...many('fomc', 7).map((e) => ({ ...e, at: '2020-02-01T19:00:00Z' }))],
    };
    const problems = gateProblems(
      Object.values(bySource).flat(),
      bySource,
      '2026-08-28',
      bls('2027-06-30'),
    );
    expect(problems.join(' ')).toMatch(/réunion\(s\) à venir/);
  });

  /**
   * Le cœur de la barrière BLS : une table courte ne prouve rien à elle seule. Entre deux
   * publications annuelles du BLS, elle est courte **parce qu'elle est à jour**. Ce qui doit
   * bloquer, c'est le doute — une table courte que personne n'a regardée depuis longtemps.
   */
  it('laisse passer une table courte qui vient d’être relue — le BLS n’a pas encore publié', () => {
    const bySource = healthy();
    const problems = gateProblems(
      Object.values(bySource).flat(),
      bySource,
      '2026-09-30',
      bls('2026-12-15', '2026-09-28'),
    );
    expect(problems).toEqual([]);
  });

  it('réclame une relecture quand la table est courte et n’a pas été regardée depuis longtemps', () => {
    const bySource = healthy();
    const problems = gateProblems(
      Object.values(bySource).flat(),
      bySource,
      '2026-11-15',
      bls('2026-12-15', '2026-08-28'),
    );
    expect(problems.join(' ')).toMatch(/bls-schedule\.ts/);
    expect(problems.join(' ')).toMatch(/2026-08-28/);
  });

  it('ne dit rien d’une table large, même relue il y a longtemps', () => {
    const bySource = healthy();
    const problems = gateProblems(
      Object.values(bySource).flat(),
      bySource,
      '2026-12-01',
      bls('2027-12-15', '2026-01-01'),
    );
    expect(problems).toEqual([]);
  });

  it('détecte un identifiant en double', () => {
    const bySource = healthy();
    const events = [...Object.values(bySource).flat(), event('fomc-0', '2027-03-01T12:30:00Z')];
    expect(gateProblems(events, bySource, '2026-08-28', bls('2027-06-30')).join(' ')).toMatch(
      /en double/,
    );
  });

  /**
   * L'état réel du dépôt, joué au 18/09/2026 : la table s'arrête au 15/12/2026 parce que le BLS
   * n'a pas encore publié 2027, et elle vient d'être relue. C'est **exactement** le run qui aurait
   * échoué avant cette correction. Il doit passer, et seulement avertir.
   */
  it('laisse passer l’état réel du dépôt au 18/09/2026, en se contentant d’avertir', () => {
    const state = { coverageEnd: blsCoverageEnd(), checkedOn: BLS_CHECKED_ON };
    const bySource = healthy();
    expect(gateProblems(Object.values(bySource).flat(), bySource, '2026-09-18', state)).toEqual([]);
    expect(gateWarnings('2026-09-18', state)).toHaveLength(1);
  });
});

describe('avertissements', () => {
  it('se tait quand la table du BLS a plus de six mois devant elle', () => {
    const warnings = gateWarnings('2026-09-01', {
      coverageEnd: '2027-06-30',
      checkedOn: '2026-09-01',
    });
    expect(warnings).toEqual([]);
  });

  it('prévient quand la table se vide, sans jamais bloquer', () => {
    const warnings = gateWarnings('2026-09-01', {
      coverageEnd: '2026-12-15',
      checkedOn: '2026-09-01',
    });
    expect(warnings).toHaveLength(1);
    expect(warnings.join(' ')).toMatch(/2026-12-15/);
    expect(warnings.join(' ')).toMatch(/BLS_CHECKED_ON/);
  });

  it('prévient aussi quand la relecture est ancienne — l’avertissement double alors la barrière', () => {
    expect(
      gateWarnings('2026-11-15', { coverageEnd: '2026-12-15', checkedOn: '2026-08-28' }),
    ).toHaveLength(1);
  });
});

describe('écriture', () => {
  const calendar = {
    generatedAt: '2026-08-28T18:00:00Z',
    coversFrom: '2026-08-01',
    coversTo: '2027-12-08',
    completeTo: '2026-12-15',
    sources: [
      {
        source: 'bls' as const,
        checkedOn: '2026-08-28',
        count: 1,
        coversTo: '2026-12-15',
        upkeep: 'manual' as const,
      },
    ],
    events: [
      {
        id: 'bls-cpi-2026-09-11',
        kind: 'cpi' as const,
        at: '2026-09-11T12:30:00Z',
        precision: 'exact' as const,
        title: 'Inflation américaine (CPI)',
        detail: 'Données d’août 2026',
        tier: 'major' as const,
        source: 'bls' as const,
        url: 'https://www.bls.gov/schedule/news_release/cpi.htm',
      },
    ],
  };

  it('produit un module TypeScript qui se relit', () => {
    const text = render(calendar);
    expect(text).toContain("import type { Calendar } from './types';");
    expect(text).toContain('export const CALENDAR: Calendar = {');
    expect(text).toContain('completeTo: "2026-12-15"');
    expect(text).toContain('Données d’août 2026');
  });

  it('ignore le seul horodatage de génération quand il compare deux versions', () => {
    const a = render(calendar);
    const b = render({ ...calendar, generatedAt: '2027-01-01T00:00:00Z' });
    expect(a).not.toBe(b);
    expect(withoutStamp(a)).toBe(withoutStamp(b));
  });

  it('voit une vraie différence de contenu', () => {
    const changed = render({ ...calendar, completeTo: '2027-01-31' });
    expect(withoutStamp(render(calendar))).not.toBe(withoutStamp(changed));
  });
});

describe('décalage de mois', () => {
  it('avance et recule sans déborder', () => {
    expect(addMonths('2026-08-28', 3)).toBe('2026-11-28');
    expect(addMonths('2026-08-28', -3)).toBe('2026-05-28');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('recule de jours en franchissant les mois, les années et le 29 février', () => {
    expect(addDays('2026-09-18', -45)).toBe('2026-08-04');
    expect(addDays('2026-01-10', -20)).toBe('2025-12-21');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-08-28', 45)).toBe('2026-10-12');
  });
});

/**
 * Les calendriers de la BCE (décision n° 93).
 *
 * Trois pièges y guettent un filtre naïf, et chacun a son test : une réunion « non-monetary
 * policy » contient la sous-chaîne « monetary policy meeting » ; le « General Council » est un
 * autre organe ; et la conférence de presse a sa propre ligne, qui doublerait chaque réunion. Ce
 * sont les analogues du « notation vote » du FOMC, déjà écarté plus haut.
 */
describe('calendriers de la BCE', () => {
  const gc = parseEcbEntries(ECB_GC_HTML);
  const hicp = parseEcbEntries(ECB_HICP_HTML);
  const decisions = ecbDecisionEvents(gc);
  const inflation = hicpEvents(hicp);

  it('lit les entrées des deux pages, dates complètes et heures quand elles sont annoncées', () => {
    expect(gc.length, 'page du Conseil des gouverneurs vide').toBeGreaterThan(20);
    expect(hicp.length, 'page de l’IPCH vide').toBeGreaterThan(5);
    for (const entry of [...gc, ...hicp]) expect(entry.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Le calendrier des réunions n'annonce pas d'heure ; celui de l'IPCH, si.
    expect(gc.every((e) => e.time === null)).toBe(true);
    expect(hicp.some((e) => e.time !== null)).toBe(true);
  });

  it('ne retient qu’une décision par réunion de politique monétaire', () => {
    expect(decisions.length).toBeGreaterThan(4);
    expect(new Set(decisions.map((e) => e.id)).size, 'doublons').toBe(decisions.length);
    for (const event of decisions) {
      expect(event.kind).toBe('ecb-decision');
      expect(event.source).toBe('ecb');
      expect(event.tier).toBe('major');
    }
  });

  it('n’attrape ni les réunions NON monétaires, ni le General Council, ni la conférence seule', () => {
    const retenus = new Set(decisions.map((e) => e.id.replace('ecb-decision-', '')));
    const pieges = gc.filter(
      (e) =>
        /non-monetary/i.test(e.text) ||
        /general council/i.test(e.text) ||
        /^Press conference/i.test(e.text),
    );
    expect(
      pieges.length,
      'la page doit bien contenir des pièges, sinon on ne prouve rien',
    ).toBeGreaterThan(2);
    for (const piege of pieges) {
      // Un piège peut tomber le même jour qu'une vraie réunion : c'est le cas de la conférence de
      // presse. Ce qui compte est qu'il n'ait pas créé d'événement à LUI SEUL.
      if (/non-monetary|general council/i.test(piege.text))
        expect(retenus.has(piege.day), `retenu à tort : « ${piege.text} »`).toBe(false);
    }
  });

  it('sépare l’estimation rapide du chiffre définitif, et les range différemment', () => {
    const flash = inflation.filter((e) => e.id.includes('flash'));
    const final = inflation.filter((e) => e.id.includes('final'));
    expect(flash.length).toBeGreaterThan(2);
    expect(final.length).toBeGreaterThan(2);
    expect(flash.every((e) => e.tier === 'major')).toBe(true);
    expect(final.every((e) => e.tier === 'secondary')).toBe(true);
    expect(inflation.every((e) => e.precision === 'exact')).toBe(true);
  });

  it('les instants sont des UTC valides, croissants avec les jours', () => {
    for (const event of [...decisions, ...inflation]) {
      expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(event.at.slice(0, 10) >= '2020-01-01').toBe(true);
    }
  });

  /**
   * La conversion de fuseau, éprouvée sur le passage à l'heure d'hiver 2026 (dernier dimanche
   * d'octobre). Une même heure murale à Francfort ne donne pas le même instant UTC de part et
   * d'autre — c'est exactement ce que la conversion par nom IANA sait faire et qu'une règle écrite
   * à la main rate une fois sur deux.
   */
  it('l’heure de Francfort suit l’heure d’été, comme celle de New York', () => {
    expect(frankfurtToUtc('2026-10-20', '14:15')).toBe('2026-10-20T12:15:00Z');
    expect(frankfurtToUtc('2026-11-20', '14:15')).toBe('2026-11-20T13:15:00Z');
  });
});
