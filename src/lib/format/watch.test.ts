import { describe, expect, it } from 'vitest';
import type { WatchCertainty, WatchEntry, WatchStatus } from '../watch/entries';
import {
  renderWatchEntries,
  renderWatchEntry,
  watchCertaintyLabel,
  watchStatusLabel,
  watchSummaryLine,
  watchTopicLabel,
} from './watch';

const ALL_STATUSES: readonly WatchStatus[] = [
  'in-force',
  'adopted-final',
  'adopted-not-final',
  'in-discussion',
  'doctrine-unsettled',
  'dropped',
];

const ALL_CERTAINTIES: readonly WatchCertainty[] = ['confirmed', 'secondary-only'];

function entry(overrides: Partial<WatchEntry> = {}): WatchEntry {
  return {
    id: 'fixture',
    title: 'Entrée de test',
    status: 'in-force',
    statusDate: '2025-12-30',
    effect: 'Effet de test.',
    source: {
      label: 'Source de test',
      url: 'https://www.legifrance.gouv.fr/',
      official: true,
      checkedOn: '2026-08-29',
    },
    certainty: 'confirmed',
    reviewedOn: '2026-08-29',
    topics: ['cession'],
    ...overrides,
  };
}

describe('watchStatusLabel — switch exhaustif', () => {
  it('donne un libellé complet, distinct, à chacun des statuts connus', () => {
    const labels = ALL_STATUSES.map(watchStatusLabel);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(ALL_STATUSES.length);
  });

  it('reprend les libellés attendus mot pour mot', () => {
    expect(watchStatusLabel('in-force')).toBe('En vigueur');
    expect(watchStatusLabel('adopted-final')).toBe('Adopté, définitif');
    expect(watchStatusLabel('adopted-not-final')).toBe('Adopté, pas définitif');
    expect(watchStatusLabel('in-discussion')).toBe('En discussion');
    expect(watchStatusLabel('doctrine-unsettled')).toBe('Doctrine non stabilisée');
    expect(watchStatusLabel('dropped')).toBe('Retiré, non retenu');
  });
});

describe('watchCertaintyLabel — switch exhaustif', () => {
  it('donne un libellé complet à chaque certitude, et dit clairement le cas non officiel', () => {
    const labels = ALL_CERTAINTIES.map(watchCertaintyLabel);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(watchCertaintyLabel('secondary-only').toLowerCase()).toContain('non officielle');
  });
});

describe('watchTopicLabel — switch exhaustif', () => {
  it('donne un libellé distinct à chacun des six thèmes', () => {
    const topics: readonly WatchEntry['topics'][number][] = [
      'cession',
      'detention',
      'revenus',
      'declaratif',
      'nft',
      'ia',
    ];
    const labels = topics.map(watchTopicLabel);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(topics.length);
  });
});

describe('renderWatchEntry', () => {
  it('formate les dates en JJ/MM/AAAA et reprend title/effect tels quels', () => {
    const r = renderWatchEntry(entry());
    expect(r.statusDate).toBe('30/12/2025');
    expect(r.reviewedOn).toBe('29/08/2026');
    expect(r.title).toBe('Entrée de test');
    expect(r.effect).toBe('Effet de test.');
    expect(r.statusLabel).toBe('En vigueur');
    expect(r.deadline).toBeNull();
  });

  it('formate une échéance quand elle existe', () => {
    const r = renderWatchEntry(entry({ deadline: '2027-09-30' }));
    expect(r.deadline).toBe('30/09/2027');
  });

  it('signale une source non officielle plutôt que de rester silencieux', () => {
    const r = renderWatchEntry(
      entry({
        certainty: 'secondary-only',
        source: { label: 'Cabinets', url: null, official: false, checkedOn: '2026-08-29' },
      }),
    );
    expect(r.secondaryOnly).toBe(true);
    expect(r.officialSource).toBe(false);
    expect(r.certaintyLabel.toLowerCase()).toContain('non officielle');
  });

  it('renderWatchEntries applique le même rendu à toute une liste', () => {
    const list = renderWatchEntries([entry({ id: 'a' }), entry({ id: 'b', status: 'dropped' })]);
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
    expect(list[1]?.statusLabel).toBe('Retiré, non retenu');
  });
});

describe('watchSummaryLine', () => {
  it('tient en une ligne : statut — titre : effet', () => {
    const line = watchSummaryLine(entry());
    expect(line).toBe('En vigueur — Entrée de test : Effet de test.');
  });

  it('ajoute la réserve « source non officielle » quand la certitude est secondary-only', () => {
    const line = watchSummaryLine(entry({ certainty: 'secondary-only' }));
    expect(line).toContain('(source non officielle)');
  });

  it('ne recommande jamais rien : aucune formulation d’injonction', () => {
    for (const status of ALL_STATUSES) {
      const line = watchSummaryLine(entry({ status }));
      expect(line.toLowerCase()).not.toContain('pensez à');
      expect(line.toLowerCase()).not.toContain('vous devriez');
    }
  });
});
