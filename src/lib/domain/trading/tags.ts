/**
 * Tags du journal de trading (P122) : normalisation à l'écriture, dédoublonnage par clé
 * insensible à la casse et aux accents, usage et renommage (avec fusion). Le champ à puces de la
 * saisie ET la facette « tag » du filtre (`filter.ts`) partagent cette même notion de clé : deux
 * tags de casse ou d'accentuation différentes SONT le même tag.
 *
 * Pur, aucune dépendance à `src/lib/storage` : les plafonds sont dupliqués ici en constantes
 * (`MAX_TAGS`, `MAX_TAG_LABEL_LENGTH`) plutôt qu'importés — le domaine ne dépend jamais de la
 * couche de sauvegarde — et un test vérifie qu'elles valent celles, persistées, du schéma
 * (`storage/schema.ts`, `MAX_LIST`/`MAX_TEXT`).
 */
import type { JournalEntry } from './journal';

/** Nombre maximal de tags par entrée de journal — même valeur que `MAX_LIST` du schéma. */
export const MAX_TAGS = 40;
/** Longueur maximale d'un libellé de tag — même valeur que `MAX_TEXT` du schéma. */
export const MAX_TAG_LABEL_LENGTH = 120;

const DIACRITICS = /[̀-ͯ]/g;
const collapseSpaces = (s: string): string => s.trim().replace(/\s+/g, ' ');

/**
 * Normalisation à l'ÉCRITURE : espaces internes réduits à un seul, casse affichée CONSERVÉE
 * (« Breakout » reste « Breakout »), forme Unicode composée (NFC — celle que produit la plupart
 * des claviers), tronquée au plafond. Idempotente : renormaliser un libellé déjà normalisé ne le
 * change plus.
 */
export function normalizeTagLabel(raw: string): string {
  return collapseSpaces(raw).normalize('NFC').slice(0, MAX_TAG_LABEL_LENGTH);
}

/**
 * Clé de COMPARAISON d'un tag, jamais affichée : NFKD sans diacritiques, minuscules françaises,
 * espaces réduits. « Breakout », « breakout » et « bréakout » partagent la même clé. Idempotente.
 */
export function tagKey(raw: string): string {
  return collapseSpaces(raw).normalize('NFKD').replace(DIACRITICS, '').toLocaleLowerCase('fr');
}

/**
 * Ajoute un tag : ignore une saisie vide (après normalisation), ne double jamais une clé déjà
 * présente (garde la PREMIÈRE casse écrite), plafonne la liste à `MAX_TAGS`. Renvoie toujours un
 * nouveau tableau (immuable), même sans changement effectif.
 */
export function addTag(tags: readonly string[], raw: string): string[] {
  const label = normalizeTagLabel(raw);
  if (label === '') return [...tags];
  const key = tagKey(label);
  if (tags.some((t) => tagKey(t) === key)) return [...tags];
  if (tags.length >= MAX_TAGS) return [...tags];
  return [...tags, label];
}

/**
 * Retire le tag dont la clé correspond à `key` (accepte indifféremment une clé déjà normalisée ou
 * un libellé brut — les deux passent par `tagKey`).
 */
export function removeTag(tags: readonly string[], key: string): string[] {
  const target = tagKey(key);
  return tags.filter((t) => tagKey(t) !== target);
}

export interface TagUsage {
  key: string;
  /** Casse la plus fréquemment écrite pour cette clé (égalité départagée par ordre alphabétique
   * français, pour un résultat déterministe). */
  label: string;
  /** Occurrences totales de la clé, toutes casses confondues. */
  count: number;
}

/** Usage des tags sur l'ensemble d'un journal : une entrée par CLÉ, avec son libellé le plus
 * fréquent — jamais l'inverse (une entrée par libellé brut compterait « BTC » et « btc » à part). */
export function tagUsage(journal: Readonly<Record<string, JournalEntry>>): TagUsage[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const entry of Object.values(journal)) {
    for (const raw of entry.tags) {
      const key = tagKey(raw);
      const labels = byKey.get(key) ?? new Map<string, number>();
      labels.set(raw, (labels.get(raw) ?? 0) + 1);
      byKey.set(key, labels);
    }
  }
  const usage: TagUsage[] = [];
  for (const [key, labels] of byKey) {
    let label = '';
    let labelCount = -1;
    let total = 0;
    for (const [candidate, count] of labels) {
      total += count;
      if (
        count > labelCount ||
        (count === labelCount && candidate.localeCompare(label, 'fr') < 0)
      ) {
        label = candidate;
        labelCount = count;
      }
    }
    usage.push({ key, label, count: total });
  }
  return usage.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
}

/**
 * Suggestions pour le champ à puces : préfixe de clé d'abord, puis simple contenance ; dans
 * chaque groupe, fréquence décroissante puis alphabétique français. `exclus` retire les tags déjà
 * choisis (comparés par clé, pas par libellé).
 */
export function tagSuggestions(
  journal: Readonly<Record<string, JournalEntry>>,
  saisie: string,
  exclus: readonly string[],
  limite: number,
): TagUsage[] {
  const excludedKeys = new Set(exclus.map(tagKey));
  const usage = tagUsage(journal).filter((u) => !excludedKeys.has(u.key));
  const rank = (a: TagUsage, b: TagUsage): number =>
    b.count - a.count || a.label.localeCompare(b.label, 'fr');
  const needle = tagKey(saisie);
  if (needle === '') return usage.sort(rank).slice(0, limite);
  const prefix = usage.filter((u) => u.key.startsWith(needle)).sort(rank);
  const contains = usage
    .filter((u) => !u.key.startsWith(needle) && u.key.includes(needle))
    .sort(rank);
  return [...prefix, ...contains].slice(0, limite);
}

/**
 * Renomme un tag PARTOUT dans le journal : remplace son libellé, et FUSIONNE si l'entrée porte
 * déjà le nom cible (une seule occurrence survit, jamais un doublon de clé). `newLabel` vide
 * retire le tag (symétrique d'`addTag`, qui ignore déjà une saisie vide en écriture).
 *
 * Renvoie une nouvelle carte ; les entrées non concernées gardent leur référence d'origine (pas de
 * ré-écriture inutile). Idempotente : rejouer le même renommage sur le résultat ne change plus
 * rien.
 */
export function renameTag(
  journal: Readonly<Record<string, JournalEntry>>,
  sourceKey: string,
  newLabel: string,
): Record<string, JournalEntry> {
  const label = normalizeTagLabel(newLabel);
  const targetKey = tagKey(label);
  const result: Record<string, JournalEntry> = {};
  for (const [id, entry] of Object.entries(journal)) {
    if (!entry.tags.some((t) => tagKey(t) === sourceKey)) {
      result[id] = entry;
      continue;
    }
    const rest = entry.tags.filter((t) => tagKey(t) !== sourceKey && tagKey(t) !== targetKey);
    result[id] = { ...entry, tags: label === '' ? rest : [...rest, label] };
  }
  return result;
}
