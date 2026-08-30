/**
 * Lexiques proscrits (P70) — la généralisation du garde-fou écrit pour le second avis
 * (décision n° 67), désormais réutilisable par toute sortie de texte, y compris celle d'un modèle.
 *
 * ## Deux modes, et ils ne se ressemblent pas
 *
 * - `scanSource` lit un fichier **comme du texte, commentaires compris**. C'est délibéré : une
 *   explication de code qui emploie le vocabulaire de l'accusation finit par déteindre sur les
 *   phrases qu'elle explique — le test du second avis a d'ailleurs pris en défaut, une fois, le
 *   commentaire qui l'annonçait. Un faux positif s'y traite par **exception nommée mot pour mot**
 *   (`allowed`), jamais en affaiblissant la règle pour tout le fichier ; `missingAllowed` existe
 *   pour qu'un test exige que l'exception soit encore présente, intacte.
 * - `scanOutput` lit des phrases déjà rendues. **Aucune exception n'y est admise** : une phrase
 *   affichée n'a pas de contexte qui l'excuse.
 *
 * ## Ce que ce test prouve, et ce qu'il ne prouve pas
 *
 * La frontière information / conseil n'est vérifiable que comme **condition nécessaire**. Le test
 * dit « aucun mot de conseil » ; il ne dit pas « ce n'est pas du conseil ». Une recommandation
 * peut parfaitement se faire par le CHOIX et l'ORDRE des constats — trois chiffres flatteurs sur
 * quatorze, rangés dans le bon sens, et personne n'a écrit « achetez ». Aucun test ne lit cela.
 * Prétendre l'inverse serait une garantie fausse, et c'est la doctrine AMF du 04/08/2026 qui en
 * paierait le prix.
 */

export interface LexiconRule {
  readonly pattern: RegExp;
  /** Pourquoi ce mot est proscrit — repris tel quel dans le message d'échec. */
  readonly why: string;
}

export interface LexiconHit {
  /** `String(rule.pattern)`, pour un message lisible sans dépendre de l'objet. */
  readonly pattern: string;
  readonly why: string;
  /** Ligne du fichier (1-based) ou rang de la phrase (1-based). */
  readonly line: number;
  /** La ligne ou la phrase fautive, découpée. */
  readonly text: string;
}

export type LexiconDomain = 'accusation' | 'advice' | 'guarantee' | 'ranking';

/**
 * Le vocabulaire de l'accusation : désigner un calcul, un outil ou une personne comme fautif.
 * Une divergence vient presque toujours d'une méthode légitimement différente (décision n° 67).
 */
const ACCUSATION: readonly LexiconRule[] = [
  { pattern: /\berreurs?\b/i, why: 'une divergence n’est pas une anomalie de l’autre outil' },
  { pattern: /\bfaux\b|\bfausses?\b/i, why: 'aucun des deux calculs n’est désigné' },
  { pattern: /\bbugs?\b/i, why: 'le vocabulaire du défaut est proscrit' },
  { pattern: /se\s+trompe/i, why: 'aucune imputation à l’autre outil' },
  { pattern: /surestim|sous-?estim/i, why: 'aucun jugement sur le chiffre de l’autre outil' },
];

/**
 * Le vocabulaire du conseil. C'est la frontière que la doctrine AMF du 04/08/2026 trace pour les
 * crypto-actifs (MiCA art. 3, § 1, 24) : décrire est libre, recommander est réglementé.
 */
const ADVICE: readonly LexiconRule[] = [
  { pattern: /\bvous\s+(devr|pourr)iez\b/i, why: 'aucune suggestion adressée au lecteur' },
  { pattern: /\bachet(ez|er)\b/i, why: 'aucune incitation à acheter' },
  { pattern: /\bvend(ez|re)\b/i, why: 'aucune incitation à vendre' },
  { pattern: /\barbitr(ez|er)\b/i, why: 'aucune incitation à arbitrer' },
  { pattern: /\bnous\s+recommandons\b/i, why: 'l’app n’émet aucune recommandation' },
  { pattern: /\bil\s+faut\s+(vendre|acheter)\b/i, why: 'aucune injonction d’opération' },
  { pattern: /\ball[ée]g(ez|er)\s+(votre|vos|la|les)\b/i, why: 'aucune consigne de position' },
  { pattern: /trop\s+déclaré/i, why: 'aucun conseil fiscal implicite' },
];

/** Le vocabulaire de la garantie : une sortie de modèle ne certifie rien, jamais. */
const GUARANTEE: readonly LexiconRule[] = [
  { pattern: /\bgaranti/i, why: 'aucune garantie de résultat ni d’exactitude' },
  { pattern: /\bcertifi/i, why: 'aucune certification' },
  { pattern: /\bsans\s+risque\b/i, why: 'aucune promesse d’absence de risque' },
  { pattern: /\bà\s+coup\s+sûr\b/i, why: 'aucune promesse de résultat' },
  { pattern: /\binfaillible\b/i, why: 'aucune promesse d’infaillibilité' },
  { pattern: /\bexacts?\s+à\s+100\s*%/i, why: 'aucune promesse d’exactitude chiffrée' },
];

/** Le vocabulaire du score, du classement et de la comparaison d'offres. */
const RANKING: readonly LexiconRule[] = [
  { pattern: /payez\s+pour\s+rien/i, why: 'aucune comparaison d’offre' },
  { pattern: /fiabilit/i, why: 'aucun score de fiabilité' },
  { pattern: /\bscores?\b/i, why: 'aucun score' },
  { pattern: /classement|\bmeilleur|\bpire\b/i, why: 'aucun classement d’outils' },
  {
    pattern: /tarif|abonnement|\beuros?\s*\/\s*mois/i,
    why: 'aucune comparaison de prix ni d’offre',
  },
];

export const DOMAIN_LEXICONS: Record<LexiconDomain, readonly LexiconRule[]> = {
  accusation: ACCUSATION,
  advice: ADVICE,
  guarantee: GUARANTEE,
  ranking: RANKING,
};

/** Les quatre lexiques réunis : ce que doit passer toute phrase destinée à l'écran. */
export const ALL_LEXICONS: readonly LexiconRule[] = [
  ...ACCUSATION,
  ...ADVICE,
  ...GUARANTEE,
  ...RANKING,
];

/** Les exceptions déclarées mais absentes du texte : un test doit les traiter comme un échec. */
export function missingAllowed(source: string, allowed: readonly string[]): string[] {
  return allowed.filter((phrase) => !source.includes(phrase));
}

/**
 * Analyse un fichier lu comme du texte. Chaque exception est retirée **mot pour mot** avant
 * l'analyse : affaiblir le motif la ferait disparaître de la surveillance, la retirer la laisse
 * visible et vérifiable par ailleurs (`missingAllowed`).
 */
export function scanSource(
  source: string,
  rules: readonly LexiconRule[],
  allowed: readonly string[] = [],
): LexiconHit[] {
  let scanned = source;
  for (const phrase of allowed) scanned = scanned.split(phrase).join(' ');
  return scanLines(scanned.split('\n'), rules);
}

/** Analyse des phrases déjà rendues. Aucune exception : une phrase affichée s'assume seule. */
export function scanOutput(
  sentences: readonly string[],
  rules: readonly LexiconRule[],
): LexiconHit[] {
  return scanLines(sentences, rules);
}

function scanLines(lines: readonly string[], rules: readonly LexiconRule[]): LexiconHit[] {
  const hits: LexiconHit[] = [];
  lines.forEach((raw, index) => {
    const text = raw.trim();
    if (text === '') return;
    for (const rule of rules) {
      if (rule.pattern.test(text)) {
        hits.push({ pattern: String(rule.pattern), why: rule.why, line: index + 1, text });
      }
    }
  });
  return hits;
}
