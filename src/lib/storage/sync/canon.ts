/**
 * JSON canonique : mêmes clés, ordre indépendant de l'insertion, récursif. Sert à comparer deux
 * enregistrements par CONTENU plutôt que par référence — indispensable ici, puisque chaque
 * instantané (`$state.snapshot`, décision n° 81) reconstruit de nouveaux objets à chaque
 * enregistrement, y compris pour une valeur inchangée : deux appels ne renvoient jamais le même
 * objet, seulement des objets égaux en contenu.
 */
export function canon(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = canonicalize(record[key]);
    return out;
  }
  return value;
}
