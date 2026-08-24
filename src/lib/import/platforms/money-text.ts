/**
 * Parseur de montants « humains » (Revolut, Coinbase) : symbole ou code devise collé ou espacé,
 * signe en tête (avant ou après le symbole), virgules de milliers. Pure extraction textuelle —
 * jamais de `number`, jamais d'arithmétique ici (l'appelant construit un `Big` avec `D()` si
 * besoin) : seul le format de la chaîne d'entrée est interprété.
 */

/** Montant texte décomposé : `amount` toujours non signé (`/^\d+(\.\d+)?$/`), devise en minuscules. */
export interface ParsedMoneyText {
  amount: string;
  currency: string | null;
  negative: boolean;
}

/** Symboles reconnus collés en tête du montant (jamais en queue). */
const SYMBOLS: Record<string, string> = { '€': 'eur', $: 'usd', '£': 'gbp' };

const PLAIN_RE = /^\d+(\.\d+)?$/;
/** Milliers valides : premier groupe de 1 à 3 chiffres, puis groupes de 3 après chaque virgule. */
const THOUSANDS_RE = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

/** Code devise de 3 lettres collé ou espacé en tête : le reste doit commencer par un chiffre. */
const HEAD_CODE_RE = /^([A-Za-z]{3})\s?(\d.*)$/;
/** Idem en queue : le montant se termine par un chiffre, suivi (collé ou espacé) du code. */
const TAIL_CODE_RE = /^(.*\d)\s?([A-Za-z]{3})$/;

/**
 * Parse un montant « humain » (`€10.77`, `-€597.49`, `40.60 EUR`, `1,234.56 SEK`…) vers un
 * montant non signé + devise + signe. `null` si la chaîne est vide ou illisible (notamment une
 * virgule qui ne correspond pas à un séparateur de milliers valide, ce qui rend le montant
 * ambigu plutôt que de deviner).
 */
export function parseMoneyText(raw: string, fallbackCurrency?: string): ParsedMoneyText | null {
  // Espaces insécables (fine U+202F, classique U+00A0) fréquentes dans les exports → espace normal.
  const normalized = raw.replace(/[\u202f\u00a0]/g, ' ').trim();
  if (normalized === '') return null;

  let s = normalized;
  let negative = false;
  const stripLeadingSign = (): void => {
    if (s.startsWith('-') || s.startsWith('−')) {
      negative = true;
      s = s.slice(1).trim();
    }
  };
  stripLeadingSign();

  let currency: string | null = null;
  const symbol = SYMBOLS[s.charAt(0)];
  if (symbol) {
    currency = symbol;
    s = s.slice(1).trim();
    stripLeadingSign(); // signe éventuel entre le symbole et le montant : « €-597.49 ».
  }

  if (currency === null) {
    const head = HEAD_CODE_RE.exec(s);
    if (head) {
      currency = head[1]!.toLowerCase();
      s = head[2]!;
    } else {
      const tail = TAIL_CODE_RE.exec(s);
      if (tail) {
        currency = tail[2]!.toLowerCase();
        s = tail[1]!;
      }
    }
  }
  s = s.trim();

  const fallback = fallbackCurrency ? fallbackCurrency.toLowerCase() : null;
  if (PLAIN_RE.test(s)) {
    return { amount: s, currency: currency ?? fallback, negative };
  }
  if (THOUSANDS_RE.test(s)) {
    return { amount: s.replace(/,/g, ''), currency: currency ?? fallback, negative };
  }
  return null;
}
