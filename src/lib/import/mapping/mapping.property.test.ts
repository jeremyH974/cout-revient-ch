/**
 * Les deux propriétés de fond de l'appariement (P64), et une **mesure**.
 *
 * 1. **En-têtes permutés et renommés par synonymes → le mapping d'origine est retrouvé.** C'est
 *    la propriété qui dit ce que vaut la voie déterministe : elle ne reconnaît pas un fichier, elle
 *    reconnaît des colonnes, où qu'elles soient et quel que soit leur nom parmi ceux qu'elle
 *    connaît.
 * 2. **Toute proposition acceptée produit un rapport vert.** Invariant comptable tenu, aucune
 *    position bloquée. C'est la garantie que le vérificateur et le proposeur ne se contredisent
 *    jamais : ce qui est proposé passe ce qui est vérifié.
 *
 * Et la mesure, qui n'est pas un test mais un **constat rapporté** : combien de colonnes peuvent
 * devenir opaques (`col_3`, un nom qu'aucune table ne connaît) avant que l'appariement ne perde
 * son admissibilité. C'est la vraie valeur de la voie déterministe, et elle mérite d'être écrite
 * plutôt que supposée.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseCsvText, type CsvTable } from '../csv';
import { confirmedMapping, proposeMapping } from './propose';
import { SYNONYMS } from './synonyms';
import { TARGET_FIELDS, type MappingTarget } from './schema';
import { contextOf, verifyMapping } from './verify';

const RATE = (): string => '1.1';

/** Un jeu pivot minimal mais complet : douze colonnes, toutes renseignées. */
const FIELDS: readonly MappingTarget[] = [
  'date',
  'sentAmount',
  'sentCurrency',
  'receivedAmount',
  'receivedCurrency',
  'feeAmount',
  'feeCurrency',
  'netWorthAmount',
  'netWorthCurrency',
  'label',
  'description',
  'txHash',
];

const ROWS: readonly Readonly<Record<MappingTarget, string>>[] = [
  {
    date: '2026-03-02 09:00:00',
    sentAmount: '2000',
    sentCurrency: 'EUR',
    receivedAmount: '0.05',
    receivedCurrency: 'BTC',
    feeAmount: '5',
    feeCurrency: 'EUR',
    netWorthAmount: '2000',
    netWorthCurrency: 'EUR',
    label: 'trade',
    description: 'achat',
    txHash: '0xaa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff2233445566',
  },
  {
    date: '2026-04-10 14:30:00',
    sentAmount: '0.01',
    sentCurrency: 'BTC',
    receivedAmount: '0.4',
    receivedCurrency: 'ETH',
    feeAmount: '0.0001',
    feeCurrency: 'BTC',
    netWorthAmount: '450',
    netWorthCurrency: 'EUR',
    label: 'trade',
    description: 'echange',
    txHash: '0xbb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff2233445566aa11',
  },
  {
    date: '2026-05-15 08:00:00',
    sentAmount: '0.2',
    sentCurrency: 'ETH',
    receivedAmount: '300',
    receivedCurrency: 'EUR',
    feeAmount: '0.3',
    feeCurrency: 'EUR',
    netWorthAmount: '300',
    netWorthCurrency: 'EUR',
    label: 'trade',
    description: 'vente',
    txHash: '0xcc33dd44ee55ff66aa77bb88cc99dd00ee11ff2233445566aa11bb22',
  },
];

/** Construit le CSV avec un en-tête par champ, dans l'ordre donné. */
function build(order: readonly MappingTarget[], headers: readonly string[]): CsvTable {
  const lines = [headers.join(',')];
  for (const row of ROWS) lines.push(order.map((field) => row[field]).join(','));
  return parseCsvText(lines.join('\n'));
}

/** Champ → index de colonne, tel que la proposition l'a retrouvé. */
const mappedOf = (table: CsvTable): Partial<Record<MappingTarget, number>> =>
  confirmedMapping(proposeMapping(table)).columns;

describe('en-têtes permutés et renommés par synonymes', () => {
  it('retrouve toujours le mapping d’origine', () => {
    fc.assert(
      fc.property(
        // Une permutation des douze champs…
        fc.constant(FIELDS).chain((fields) =>
          fc
            .array(fc.double({ min: 0, max: 1, noNaN: true }), {
              minLength: fields.length,
              maxLength: fields.length,
            })
            .map((keys) =>
              [...fields].sort((a, b) => keys[fields.indexOf(a)]! - keys[fields.indexOf(b)]!),
            ),
        ),
        // …et, pour chaque champ, un synonyme tiré au hasard dans sa liste.
        fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
        (order, picks) => {
          const headers = order.map((field, i) => {
            const names = SYNONYMS[field];
            return names[picks[i]! % names.length]!;
          });
          const mapped = mappedOf(build(order, headers));
          order.forEach((field, column) => {
            expect(mapped[field], `${field} ← « ${headers[column]} »`).toBe(column);
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it('retrouve aussi le mapping quand les en-têtes portent accents, tirets et collages', () => {
    const disguise = (name: string): string =>
      name.replace(/ /g, '_').replace(/e/g, 'é').toUpperCase();
    const headers = FIELDS.map((field) => disguise(SYNONYMS[field][0]!));
    const mapped = mappedOf(build(FIELDS, headers));
    FIELDS.forEach((field, column) => expect(mapped[field], field).toBe(column));
  });
});

describe('toute proposition acceptée produit un rapport vert', () => {
  it('invariant tenu et aucune position bloquée, sur des en-têtes tirés au hasard', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 12, maxLength: 12 }), (picks) => {
        const headers = FIELDS.map((field, i) => {
          const names = SYNONYMS[field];
          return names[picks[i]! % names.length]!;
        });
        const table = build(FIELDS, headers);
        const proposal = proposeMapping(table);
        const verdict = verifyMapping(confirmedMapping(proposal), contextOf(table, proposal, RATE));
        const failed = verdict.checks.filter((c) => c.status === 'fail');
        expect(failed.map((c) => `${c.id}:${c.code}`)).toEqual([]);
        expect(verdict.ok).toBe(true);
      }),
      { numRuns: 120 },
    );
  });
});

describe('ce que la voie déterministe encaisse avant de perdre le mapping', () => {
  /*
   * On rend les en-têtes OPAQUES un par un (`col_0`, `col_1`…), dans l'ordre inverse de leur
   * importance — les annotations d'abord, les jambes ensuite, la date en dernier —, et l'on
   * regarde jusqu'où l'appariement reste admissible (`date` + une paire complète).
   *
   * Le résultat est rapporté, pas seulement asserté : c'est la mesure de la vraie valeur de la
   * table des synonymes, et elle doit se lire à chaque `npm run check`.
   */
  it('mesure le nombre de colonnes opacifiables, et le rapporte', () => {
    const order: readonly MappingTarget[] = [
      'txHash',
      'description',
      'label',
      'netWorthCurrency',
      'netWorthAmount',
      'feeCurrency',
      'feeAmount',
      'receivedCurrency',
      'receivedAmount',
      'sentCurrency',
      'sentAmount',
      'date',
    ];
    const curve: number[] = [];
    let admissible = 0;
    let firstFall = 'aucune';
    for (let k = 0; k <= order.length; k += 1) {
      const opaque = new Set(order.slice(0, k));
      const headers = FIELDS.map((field, i) =>
        opaque.has(field) ? `col_${i}` : SYNONYMS[field][0]!,
      );
      const table = build(FIELDS, headers);
      const proposal = proposeMapping(table);
      const mapped = confirmedMapping(proposal).columns;
      curve.push(FIELDS.filter((field, column) => mapped[field] === column).length);
      if (proposal.admissible) admissible = k;
      else if (firstFall === 'aucune') firstFall = order[k - 1]!;
    }
    console.info(
      `\nAppariement déterministe — champs exactement retrouvés selon le nombre d'en-têtes rendus ` +
        `OPAQUES (« col_3 », aucun synonyme, aucune parenté), opacifiés du moins essentiel au plus ` +
        `essentiel :\n  ` +
        curve.map((n, k) => `${k}→${n}`).join('  ') +
        `\n  L'admissibilité (date + une paire complète) tient jusqu'à ${admissible} en-têtes ` +
        `opaques ; elle tombe sur « ${firstFall} ».`,
    );
    /*
     * Ce que la courbe dit, et il faut le lire tel quel : passé le premier en-tête — celui des
     * empreintes, que la forme `hash-hex` suffit à retrouver seule —, la voie déterministe perd
     * **un champ par en-tête opaque**. Autrement dit elle s'appuie d'abord sur les NOMS, la forme
     * ne rattrapant que ce qui est structurellement identifiable (une date, une empreinte). C'est
     * une limite honnête, pas un défaut à corriger : deviner qu'une colonne décimale anonyme est
     * « le montant envoyé » plutôt que « la contre-valeur » demanderait exactement l'invention que
     * ce module s'interdit.
     *
     * L'admissibilité, elle, tient beaucoup plus longtemps : il suffit qu'UNE paire survive.
     */
    expect(curve[0]).toBe(FIELDS.length);
    expect(curve[5]).toBeGreaterThanOrEqual(8);
    expect(admissible).toBeGreaterThanOrEqual(8);
  });

  it('déclare une cible pour chacun des douze champs pivot, et rien de plus', () => {
    expect([...TARGET_FIELDS].sort()).toEqual([...FIELDS].sort());
  });
});
