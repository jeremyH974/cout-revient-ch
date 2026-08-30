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
 *
 * **Depuis P70, la mécanique vit dans `./lexicon.ts`** et sert aussi aux sorties de modèle. Ce
 * fichier garde donc deux devoirs : appliquer le module à ce rendu-ci, et prouver qu'AUCUNE des
 * règles d'origine n'a été perdue au passage — `FORBIDDEN` reste ci-dessous, intact, et un test
 * exige que le module le couvre motif pour motif, raison pour raison.
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
import { ALL_LEXICONS, missingAllowed, scanOutput, scanSource } from './lexicon';
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

describe('aucune règle d’origine n’a été perdue en généralisant le lexique', () => {
  for (const { pattern, why } of FORBIDDEN) {
    it(`le module couvre encore ${String(pattern)} — ${why}`, () => {
      const covered = ALL_LEXICONS.some(
        (rule) =>
          rule.pattern.source === pattern.source &&
          rule.pattern.flags === pattern.flags &&
          rule.why === why,
      );
      expect(covered, `${String(pattern)} a disparu de src/lib/format/lexicon.ts`).toBe(true);
    });
  }
});

describe('lexique du second avis', () => {
  it('la phrase autorisée mot pour mot est bien présente, intacte', () => {
    // Sans elle, l'exception ci-dessus retirerait du texte quelque chose qui n'y est plus, et le
    // lexique deviendrait plus strict que ce que le cahier des charges autorise — en silence.
    expect(missingAllowed(SOURCE, [ALLOWED_NEGATION])).toEqual([]);
  });

  for (const { pattern, why } of FORBIDDEN) {
    it(`n’emploie jamais ${String(pattern)} — ${why}`, () => {
      const hits = scanSource(SOURCE, [{ pattern, why }], [ALLOWED_NEGATION]);
      expect(
        hits.map((h) => `${h.line} : ${h.text}`),
        `second-opinion.ts, ${why}`,
      ).toEqual([]);
    });
  }

  it('passe aussi les trois autres lexiques : conseil, garantie, classement', () => {
    // Couverture ÉLARGIE par P70, jamais réduite : le rendu du second avis doit tenir devant le
    // même lexique que celui qu'on opposera demain à une sortie de modèle.
    const hits = scanSource(SOURCE, ALL_LEXICONS, [ALLOWED_NEGATION]);
    expect(hits.map((h) => `${h.line} : ${h.why} — ${h.text}`)).toEqual([]);
  });
});

describe('lexique des phrases rendues', () => {
  for (const { pattern, why } of FORBIDDEN) {
    it(`aucune phrase affichée n’emploie ${String(pattern)} — ${why}`, () => {
      expect(scanOutput(sentences, [{ pattern, why }])).toEqual([]);
    });
  }

  it('aucune phrase affichée n’emploie non plus le vocabulaire du conseil ni de la garantie', () => {
    expect(scanOutput(sentences, ALL_LEXICONS).map((h) => `${h.why} — ${h.text}`)).toEqual([]);
  });
});
