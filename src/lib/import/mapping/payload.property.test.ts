/**
 * La propriété de NON-FUITE de P64 — le pendant, pour l'appariement de colonnes, de la propriété
 * d'ancrage de la décision n° 70.
 *
 * Elle a trois volets, et il en faut trois :
 *
 * 1. **La sentinelle universelle.** Un CSV dont *chaque* cellule vaut une sentinelle : la charge
 *    utile ne doit en contenir aucune. C'est le contrôle de fond — ce qui part ne vient pas des
 *    données.
 * 2. **La sentinelle dans la colonne de type.** C'est la seule porte par laquelle une valeur de
 *    cellule peut légitimement voyager (les libellés de type). Une sentinelle qui porte un motif
 *    interdit — chiffres, arobase, `0x`, séparateur décimal — doit être **écartée entièrement**,
 *    jamais tronquée. Et son pendant : un libellé anodin, lui, **passe** — sans quoi la propriété
 *    serait vraie parce que rien ne part jamais, ce qui ne prouverait rien.
 * 3. **Les clés de la charge utile.** Elles sont exactement celles déclarées, **à toute
 *    profondeur**. Sans ce troisième volet, un futur champ « exemples » entrerait dans l'envoi
 *    sans qu'aucun test ne tombe : les deux premiers ne regardent que des valeurs.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildRequest, canonicalJson } from '../../ai/contract';
import { parseCsvText } from '../csv';
import {
  MAX_TYPE_LABELS,
  PAYLOAD_KEYS,
  buildColumnMappingInput,
  filterTypeLabels,
  payloadKeysByLevel,
} from './payload';
import { proposeMapping } from './propose';

/** En-têtes pivot connus : le cas le PLUS favorable à une fuite, tout étant apparié. */
const HEADERS = [
  'Date',
  'Sent Amount',
  'Sent Currency',
  'Received Amount',
  'Received Currency',
  'Fee Amount',
  'Fee Currency',
  'Net Worth Amount',
  'Net Worth Currency',
  'Label',
  'Description',
  'TxHash',
];

/**
 * Une sentinelle porte toujours au moins quatre chiffres consécutifs : c'est ce qui la rend
 * reconnaissable ET ce qui la fait écarter par le filtre. Une sentinelle sans motif interdit
 * n'éprouverait pas la non-fuite, elle éprouverait le filtre à l'envers.
 */
const sentinel = fc.integer({ min: 10_000_000, max: 99_999_999 }).map((n) => `zzSENTINELLE${n}zz`);

const payloadOf = (lines: readonly string[]): string => {
  const table = parseCsvText(lines.join('\n'));
  const { input } = buildColumnMappingInput(table, proposeMapping(table));
  const request = buildRequest('column-mapping', input);
  return `${request.system}\n${request.user}`;
};

describe('non-fuite (1) : aucune cellule ne franchit la charge utile', () => {
  it('n’envoie aucune sentinelle, quel que soit le contenu des cellules', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(sentinel, { minLength: 12, maxLength: 12 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (rows) => {
          const lines = [HEADERS.join(','), ...rows.map((r) => r.join(','))];
          const sent = payloadOf(lines);
          for (const row of rows) {
            for (const cell of row) expect(sent).not.toContain(cell);
          }
          expect(sent).not.toContain('SENTINELLE');
        },
      ),
      { numRuns: 60 },
    );
  });

  it('n’envoie pas davantage les cellules d’un fichier aux en-têtes inconnus', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(sentinel, { minLength: 4, maxLength: 4 }), {
          minLength: 1,
          maxLength: 6,
        }),
        (rows) => {
          const lines = [
            'Horodatage,Opération,Quantité vendue,Devise vendue',
            ...rows.map((r) => r.join(',')),
          ];
          expect(payloadOf(lines)).not.toContain('SENTINELLE');
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('non-fuite (2) : la seule porte ouverte est filtrée, jamais tronquée', () => {
  it('écarte tout libellé de type portant un motif interdit', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 1000, max: 999_999_999 }).map((n) => `client${n}`),
          fc.string({ minLength: 2, maxLength: 8, unit: 'grapheme-ascii' }).map((s) => `${s}@x.fr`),
          fc
            .array(fc.constantFrom(...'0123456789abcdef'.split('')), {
              minLength: 6,
              maxLength: 20,
            })
            .map((h) => `0x${h.join('')}`),
          fc.integer({ min: 1, max: 9999 }).map((n) => `${n},50 EUR`),
        ),
        (suspect) => {
          const lines = [
            'Date,Label,Sent Amount,Sent Currency',
            `2026-03-02 09:00:00,${JSON.stringify(suspect)},1,EUR`,
          ];
          const sent = payloadOf(lines);
          // Écarté ENTIÈREMENT : ni la valeur, ni un préfixe d'au moins quatre caractères.
          expect(sent).not.toContain(suspect);
          expect(sent).not.toContain(suspect.slice(0, 4));
        },
      ),
      { numRuns: 60 },
    );
  });

  it('laisse en revanche passer un libellé anodin : sinon la propriété serait vide', () => {
    const lines = [
      'Date,Label,Sent Amount,Sent Currency',
      '2026-03-02 09:00:00,recompense,1,EUR',
      '2026-03-03 09:00:00,frais de retrait,1,EUR',
    ];
    const sent = payloadOf(lines);
    expect(sent).toContain('recompense');
    expect(sent).toContain('frais de retrait');
  });

  it('compte ce qu’il écarte, et borne ce qu’il garde', () => {
    const filtered = filterTypeLabels([
      'achat',
      'client12345',
      'a@b.fr',
      '0xdeadbeef',
      '12,50',
      'x'.repeat(41),
    ]);
    expect(filtered.kept).toEqual(['achat']);
    expect(filtered.dropped).toBe(5);
    // Au-delà de quarante entrées, le surplus est compté écarté — jamais envoyé en silence.
    const wide = Array.from({ length: 60 }, (_, i) => `type-${i}`);
    const many = filterTypeLabels(wide);
    expect(many.kept).toHaveLength(MAX_TYPE_LABELS);
    expect(many.kept.length + many.dropped).toBe(wide.length);
  });
});

describe('non-fuite (3) : les clés sont exactement celles déclarées, à toute profondeur', () => {
  it('ne produit aucune clé hors liste blanche', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(sentinel, { minLength: 12, maxLength: 12 }), {
          minLength: 1,
          maxLength: 4,
        }),
        (rows) => {
          const table = parseCsvText(
            [HEADERS.join(','), ...rows.map((r) => r.join(','))].join('\n'),
          );
          const { input } = buildColumnMappingInput(table, proposeMapping(table));
          const levels = payloadKeysByLevel(input);
          expect([...levels.keys()].sort()).toEqual(Object.keys(PAYLOAD_KEYS).sort());
          for (const [level, keys] of levels) {
            expect([...keys].sort(), level).toEqual(
              (PAYLOAD_KEYS[level] ?? []).filter((k) => keys.has(k)),
            );
            for (const key of keys) expect(PAYLOAD_KEYS[level], `${level}.${key}`).toContain(key);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it('sérialise la charge utile sans aucune autre clé que celles-là', () => {
    const table = parseCsvText(
      ['Date,Label,Sent Amount,Sent Currency', '2026-03-02 09:00:00,achat,1,EUR'].join('\n'),
    );
    const { input } = buildColumnMappingInput(table, proposeMapping(table));
    const json = canonicalJson(input);
    const keys = [...json.matchAll(/"([A-Za-z]+)":/g)].map((m) => m[1]!);
    const declared = new Set(Object.values(PAYLOAD_KEYS).flat());
    for (const key of keys) expect(declared, key).toContain(key);
  });
});
