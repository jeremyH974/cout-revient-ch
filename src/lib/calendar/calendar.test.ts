import { describe, expect, it } from 'vitest';
import { CALENDAR, daysUntilIncomplete, groupByDay, localDay, splitAround } from './index';
import type { Calendar, MarketEvent } from './types';

/**
 * Deux choses distinctes sont vérifiées ici.
 *
 * D'abord les **invariants du fichier engendré** : il est committé, donc il peut être modifié à la
 * main par accident, et le générateur ne tourne qu'une fois par semaine en CI. Un calendrier
 * désordonné ou incohérent avec ses propres compteurs doit casser la CI ici, pas s'afficher.
 *
 * Ensuite la **sélection**, sur des événements synthétiques : le fichier engendré change chaque
 * semaine, on ne bâtit donc aucune attente dessus.
 */

const KINDS = new Set([
  'fomc-decision',
  'cpi',
  'ppi',
  'employment',
  'jolts',
  'pce',
  'gdp',
  'ecb-decision',
  'hicp',
]);

describe('calendrier engendré', () => {
  it('est trié par instant puis par identifiant', () => {
    const keys = CALENDAR.events.map((event) => `${event.at}|${event.id}`);
    expect(keys).toEqual([...keys].sort());
  });

  it('n’a aucun identifiant en double', () => {
    const ids = CALENDAR.events.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ne porte que des instants UTC lisibles', () => {
    for (const event of CALENDAR.events) {
      expect(event.at, event.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(new Date(event.at).toISOString().replace('.000Z', 'Z'), event.id).toBe(event.at);
    }
  });

  it('ne connaît que des natures, des rangs et des sources déclarés', () => {
    for (const event of CALENDAR.events) {
      expect(KINDS.has(event.kind), `${event.id} → ${event.kind}`).toBe(true);
      expect(['major', 'secondary']).toContain(event.tier);
      expect(['fomc', 'bls', 'bea', 'ecb', 'eurostat']).toContain(event.source);
      expect(['exact', 'day']).toContain(event.precision);
    }
  });

  it('renvoie chaque événement à une page officielle en HTTPS', () => {
    for (const event of CALENDAR.events) {
      expect(event.url.startsWith('https://'), event.id).toBe(true);
      expect(event.title.length, event.id).toBeGreaterThan(3);
    }
  });

  it('annonce des bornes conformes à son propre contenu', () => {
    const first = CALENDAR.events.at(0);
    const last = CALENDAR.events.at(-1);
    expect(CALENDAR.coversFrom).toBe(first?.at.slice(0, 10));
    expect(CALENDAR.coversTo).toBe(last?.at.slice(0, 10));
  });

  it('compte juste, source par source', () => {
    for (const stamp of CALENDAR.sources) {
      const actual = CALENDAR.events.filter((event) => event.source === stamp.source).length;
      expect(actual, stamp.source).toBe(stamp.count);
    }
  });

  it('ne se dit complet que jusqu’au plus court horizon de ses sources', () => {
    const soonest = [...CALENDAR.sources].map((s) => s.coversTo).sort()[0];
    expect(CALENDAR.completeTo).toBe(soonest);
    // Et c'est bien plus tôt que la dernière réunion connue de la Fed, sans quoi l'écran
    // laisserait croire qu'il connaît des publications qui ne sont pas publiées.
    expect(CALENDAR.completeTo <= CALENDAR.coversTo).toBe(true);
  });

  it('déclare le BLS comme tenu à la main, et toutes les autres comme automatiques', () => {
    // Le BLS est le seul dont le réseau de diffusion refuse les clients non-navigateurs
    // (décision n° 58) ; la BCE et Eurostat répondent à `curl`, comme la Fed et le BEA.
    const upkeep = Object.fromEntries(CALENDAR.sources.map((s) => [s.source, s.upkeep]));
    expect(upkeep).toEqual({
      fomc: 'auto',
      bea: 'auto',
      bls: 'manual',
      ecb: 'auto',
      eurostat: 'auto',
    });
  });
});

// ─── Sélection ───────────────────────────────────────────────────────────────

const event = (id: string, at: string): MarketEvent => ({
  id,
  kind: 'cpi',
  at,
  precision: 'exact',
  title: 'Publication',
  tier: 'major',
  source: 'bls',
  url: 'https://example.invalid',
});

const fake = (events: MarketEvent[], completeTo = '2026-12-15'): Calendar => ({
  generatedAt: '2026-08-28T18:00:00Z',
  coversFrom: events.at(0)?.at.slice(0, 10) ?? '',
  coversTo: events.at(-1)?.at.slice(0, 10) ?? '',
  completeTo,
  sources: [],
  events,
});

describe('jour local', () => {
  it('change de jour selon le fuseau du lecteur', () => {
    const late = '2026-09-11T22:30:00Z';
    expect(localDay(late, 'America/New_York')).toBe('2026-09-11');
    expect(localDay(late, 'Europe/Paris')).toBe('2026-09-12');
    expect(localDay(late, 'Indian/Reunion')).toBe('2026-09-12');
  });

  it('laisse une publication de 8 h 30 à New York le même jour à Paris', () => {
    expect(localDay('2026-09-11T12:30:00Z', 'Europe/Paris')).toBe('2026-09-11');
  });
});

describe('regroupement par jour', () => {
  it('sépare deux événements que le fuseau met de part et d’autre de minuit', () => {
    const events = [event('a', '2026-09-11T12:30:00Z'), event('b', '2026-09-11T22:30:00Z')];
    expect(groupByDay(events, 'America/New_York').map((g) => g.day)).toEqual(['2026-09-11']);
    expect(groupByDay(events, 'Europe/Paris').map((g) => g.day)).toEqual([
      '2026-09-11',
      '2026-09-12',
    ]);
  });

  it('conserve l’ordre chronologique dans chaque jour', () => {
    const events = [
      event('matin', '2026-09-11T12:30:00Z'),
      event('midi', '2026-09-11T14:00:00Z'),
      event('lendemain', '2026-09-12T12:30:00Z'),
    ];
    const groups = groupByDay(events, 'Europe/Paris');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.events.map((e) => e.id)).toEqual(['matin', 'midi']);
  });

  it('ne rend aucun groupe pour une liste vide', () => {
    expect(groupByDay([], 'Europe/Paris')).toEqual([]);
  });
});

describe('séparation passé / à venir', () => {
  const events = [
    event('hier', '2026-09-10T12:30:00Z'),
    event('ce-matin', '2026-09-11T12:30:00Z'),
    event('cet-apres-midi', '2026-09-11T18:00:00Z'),
    event('demain', '2026-09-12T12:30:00Z'),
  ];

  it('coupe sur l’instant, pas sur le jour', () => {
    // À 14 h UTC le 11, la publication de 12 h 30 est passée mais celle de 18 h ne l'est pas.
    const { upcoming, past } = splitAround('2026-09-11T14:00:00Z', fake(events));
    expect(upcoming.map((e) => e.id)).toEqual(['cet-apres-midi', 'demain']);
    expect(past.map((e) => e.id)).toEqual(['ce-matin', 'hier']);
  });

  it('range le passé du plus récent au plus ancien', () => {
    const { past } = splitAround('2027-01-01T00:00:00Z', fake(events));
    expect(past.map((e) => e.id)).toEqual(['demain', 'cet-apres-midi', 'ce-matin', 'hier']);
  });

  it('considère un événement à l’instant même comme à venir', () => {
    const { upcoming } = splitAround('2026-09-11T12:30:00Z', fake(events));
    expect(upcoming[0]?.id).toBe('ce-matin');
  });
});

describe('épuisement de la couverture', () => {
  it('compte les jours restants avant la fin de la couverture complète', () => {
    expect(daysUntilIncomplete('2026-12-10T00:00:00Z', fake([], '2026-12-15'))).toBe(5);
  });

  it('rend zéro une fois la couverture dépassée, jamais un nombre négatif', () => {
    expect(daysUntilIncomplete('2027-01-01T00:00:00Z', fake([], '2026-12-15'))).toBe(0);
  });

  it('reste défensif face à une date illisible', () => {
    expect(daysUntilIncomplete('pas une date', fake([], '2026-12-15'))).toBe(0);
  });
});
