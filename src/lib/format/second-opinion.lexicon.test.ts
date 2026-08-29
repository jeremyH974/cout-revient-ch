/**
 * Test de LEXIQUE : la CI échoue si un mot proscrit réapparaît dans
 * `src/lib/format/second-opinion.ts`.
 *
 * Ce n'est pas de la cosmétique. Une divergence avec un autre outil vient presque toujours d'une
 * méthode légitimement différente ; laisser entendre qu'un outil « se trompe » détruirait la
 * crédibilité que la traçabilité (décision n° 61) vient d'établir, et ferait sortir la comparaison
 * du cadre licite de la publicité comparative (art. L122-1 s. du code de la consommation), qui
 * n'autorise que la comparaison de caractéristiques objectives et vérifiables. Le vocabulaire de
 * l'accusation, les scores de fiabilité, les classements et toute comparaison d'offre sont donc
 * proscrits — et vérifiés par un test, pas par la discipline de qui écrit.
 *
 * Le fichier de rendu est lu comme du TEXTE : commentaires compris. Une explication de code qui
 * emploie le vocabulaire de l'accusation finirait par déteindre sur les phrases.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  causeTitle,
  inconclusiveSentence,
  metricClassLabel,
  metricLabel,
  methodLabel,
  renderRefusal,
} from './second-opinion';
import { METRIC_CLASS, type ComparableMetric } from '../domain/second-opinion';

const SOURCE = readFileSync(fileURLToPath(new URL('./second-opinion.ts', import.meta.url)), 'utf8');

/**
 * **La seule exception, et elle est nommée.** Cette phrase est autorisée mot pour mot par le
 * cahier des charges : elle est la NÉGATION de l'accusation (« sans qu'aucun ne soit faux »),
 * exactement ce que le lexique cherche à garantir. Elle est retirée du texte avant l'analyse
 * plutôt que d'affaiblir la règle pour tout le fichier — si son libellé change, le test la
 * retrouvera intacte ou échouera.
 */
const ALLOWED_NEGATION =
  'Sur cette grandeur, les deux résultats peuvent différer sans qu’aucun ne soit faux.';

/** Vocabulaire de l'accusation, du score et de la comparaison d'offres. */
const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\berreurs?\b/i, why: 'une divergence n’est pas une anomalie de l’autre outil' },
  { pattern: /\bfaux\b|\bfausses?\b/i, why: 'aucun des deux calculs n’est désigné' },
  { pattern: /\bbugs?\b/i, why: 'le vocabulaire du défaut est proscrit' },
  { pattern: /se\s+trompe/i, why: 'aucune imputation à l’autre outil' },
  { pattern: /surestim|sous-?estim/i, why: 'aucun jugement sur le chiffre de l’autre outil' },
  { pattern: /payez\s+pour\s+rien/i, why: 'aucune comparaison d’offre' },
  { pattern: /trop\s+déclaré/i, why: 'aucun conseil fiscal implicite' },
  { pattern: /fiabilit/i, why: 'aucun score de fiabilité' },
  { pattern: /\bscores?\b/i, why: 'aucun score' },
  { pattern: /classement|\bmeilleur|\bpire\b/i, why: 'aucun classement d’outils' },
  {
    pattern: /tarif|abonnement|\beuros?\s*\/\s*mois/i,
    why: 'aucune comparaison de prix ni d’offre',
  },
];

describe('lexique du second avis', () => {
  const scanned = SOURCE.split(ALLOWED_NEGATION).join(' ');

  it('la phrase autorisée mot pour mot est bien présente, intacte', () => {
    // Sans elle, l'exception ci-dessus retirerait du texte quelque chose qui n'y est plus, et le
    // lexique deviendrait plus strict que ce que le cahier des charges autorise — en silence.
    expect(SOURCE).toContain(ALLOWED_NEGATION);
  });

  for (const { pattern, why } of FORBIDDEN) {
    it(`n’emploie jamais ${String(pattern)} — ${why}`, () => {
      const offending = scanned
        .split('\n')
        .map((line, i) => ({ line: line.trim(), no: i + 1 }))
        .filter((entry) => pattern.test(entry.line));
      expect(offending, `src/lib/format/second-opinion.ts, ${why}`).toEqual([]);
    });
  }
});

describe('lexique des phrases rendues', () => {
  /** Toutes les phrases que l'écran peut afficher, hors celles qui citent le fichier. */
  const sentences: string[] = [
    ...(Object.keys(METRIC_CLASS) as ComparableMetric[]).flatMap((m) => [
      metricLabel(m),
      metricClassLabel(m),
    ]),
    ...(['method', 'scope', 'valuation', 'rounding', 'unexplained'] as const).map(causeTitle),
    ...(
      [
        'scope-not-confirmed',
        'method-not-declared',
        'currency-not-eur',
        'value-unreadable',
        'no-figure-of-ours',
        'ambiguous-line',
      ] as const
    ).map(inconclusiveSentence),
    ...(
      ['no-calculated-figures', 'pdf-only', 'not-yet-comparable', 'transactions-only'] as const
    ).flatMap((r) => {
      const rendered = renderRefusal(r, 'blockpit', [], []);
      return [rendered.title, rendered.detail, rendered.fallback ?? ''];
    }),
    ...(['wac', 'fifo', 'lifo', 'hifo', 'acb', 'opti', 'fr-global', 'unknown'] as const).map(
      methodLabel,
    ),
  ];

  for (const { pattern, why } of FORBIDDEN) {
    it(`aucune phrase affichée n’emploie ${String(pattern)} — ${why}`, () => {
      expect(sentences.filter((s) => pattern.test(s))).toEqual([]);
    });
  }
});
