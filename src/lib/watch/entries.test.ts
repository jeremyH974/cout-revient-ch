import { describe, expect, it } from 'vitest';
import { nowIso } from '../clock';
import { WATCH_ENTRIES, isStale, relevantTo, staleEntries, type WatchEntry } from './entries';

/**
 * La barrière de fraîcheur est le cœur de ce module (voir l'en-tête d'`entries.ts`) : elle tourne
 * à chaque `npm run check`, et `staleEntries` doit rendre `[]` en continu. Cette dernière
 * assertion est VOLONTAIREMENT fragile avec le temps — c'est le but : le jour où une ligne n'a
 * plus été relue depuis trop longtemps, ce test doit échouer plutôt que de laisser croire que
 * tout est à jour.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function fixtureEntry(overrides: Partial<WatchEntry> = {}): WatchEntry {
  return {
    id: 'fixture',
    title: 'Entrée de test',
    status: 'in-force',
    statusDate: '2026-01-01',
    effect: 'Effet de test, jamais affiché.',
    source: { label: 'Source de test', url: null, official: false, checkedOn: '2026-01-01' },
    certainty: 'secondary-only',
    reviewedOn: '2026-01-01',
    topics: ['cession'],
    ...overrides,
  };
}

describe('table de veille réglementaire', () => {
  it('donne à chaque entrée un identifiant unique', () => {
    const ids = WATCH_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('date statusDate, reviewedOn et deadline au format AAAA-MM-JJ valide', () => {
    const validDay = (value: string, label: string): void => {
      expect(value, label).toMatch(ISO_DAY);
      expect(Number.isNaN(Date.parse(value)), label).toBe(false);
    };
    for (const entry of WATCH_ENTRIES) {
      validDay(entry.statusDate, `${entry.id}.statusDate`);
      validDay(entry.reviewedOn, `${entry.id}.reviewedOn`);
      if (entry.deadline !== undefined) validDay(entry.deadline, `${entry.id}.deadline`);
    }
  });

  it('donne un titre et un effet non vides à chaque entrée', () => {
    for (const entry of WATCH_ENTRIES) {
      expect(entry.title.length, entry.id).toBeGreaterThan(0);
      expect(entry.effect.length, entry.id).toBeGreaterThan(10);
      expect(entry.topics.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('donne une URL https à toute source qui en cite une', () => {
    for (const entry of WATCH_ENTRIES) {
      if (entry.source.url !== null) expect(entry.source.url, entry.id).toMatch(/^https:\/\//);
    }
  });

  it('une entrée confirmed a toujours une source official: true, jamais l’inverse', () => {
    for (const entry of WATCH_ENTRIES) {
      if (entry.certainty === 'confirmed') expect(entry.source.official, entry.id).toBe(true);
      if (entry.certainty === 'secondary-only') expect(entry.source.official, entry.id).toBe(false);
    }
  });

  it('staleEntries ne rend rien aujourd’hui : toute la table est à jour', () => {
    const today = nowIso().slice(0, 10);
    expect(staleEntries(WATCH_ENTRIES, today)).toEqual([]);
  });
});

describe('isStale — les trois barrières', () => {
  it('signale un statut mouvant non relu depuis plus de 3 mois, pas avant', () => {
    const entry = fixtureEntry({ status: 'in-discussion', reviewedOn: '2026-01-01' });
    expect(isStale(entry, '2026-04-02')).toBe(false); // 91 jours
    expect(isStale(entry, '2026-04-05')).toBe(true); // 94 jours
  });

  it('signale un statut stable non relu depuis plus de 6 mois, pas avant', () => {
    const entry = fixtureEntry({ status: 'in-force', reviewedOn: '2026-01-01' });
    expect(isStale(entry, '2026-07-01')).toBe(false); // 181 jours
    expect(isStale(entry, '2026-07-05')).toBe(true); // 185 jours
  });

  it('échoue immédiatement quand une échéance est dépassée sans relecture postérieure, sans délai de grâce', () => {
    const entry = fixtureEntry({
      status: 'in-force',
      reviewedOn: '2026-01-01',
      deadline: '2026-02-01',
    });
    // Avant l'échéance : aucun effet, quel que soit le statut par ailleurs stable.
    expect(isStale(entry, '2026-01-31')).toBe(false);
    // Un seul jour après l'échéance, alors que la relecture reste toute récente par ailleurs :
    // échec immédiat, PAS de délai de grâce.
    expect(isStale(entry, '2026-02-02')).toBe(true);
    // Une fois relue APRÈS l'échéance, la barrière se réarme normalement.
    const rereviewed = fixtureEntry({ ...entry, reviewedOn: '2026-02-03' });
    expect(isStale(rereviewed, '2026-02-04')).toBe(false);
  });

  it('traite une date illisible comme périmée, jamais comme fraîche', () => {
    const entry = fixtureEntry({ reviewedOn: 'pas une date' });
    expect(isStale(entry, '2026-01-02')).toBe(true);
  });
});

describe('relevantTo', () => {
  it('ne rend que les entrées touchant le thème demandé', () => {
    const staking = relevantTo(WATCH_ENTRIES, 'revenus');
    expect(staking.map((e) => e.id).sort()).toEqual(['airdrops', 'staking']);
    for (const entry of staking) expect(entry.topics).toContain('revenus');
  });

  it('rend un tableau vide pour un thème qu’aucune entrée ne touche', () => {
    expect(relevantTo([], 'nft')).toEqual([]);
  });
});
