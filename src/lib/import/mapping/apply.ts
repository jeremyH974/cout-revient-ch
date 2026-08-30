/**
 * Un appariement confirmé → des brouillons de lignes pivot (P64).
 *
 * C'est le même contrat que les huit convertisseurs natifs : `PlatformDraft[]` puis
 * `draftsToPivotRows`, donc la clé d'une ligne hache le **contenu natif** (décision n° 26). La
 * conséquence est celle qu'on veut : **corriger un appariement ne duplique jamais les lignes**,
 * puisque l'entrée du convertisseur — les cellules brutes — n'a pas changé. Corriger un
 * appariement déjà importé passe donc par « annuler cet import », pas par un ré-import qui
 * empilerait deux lectures du même fichier.
 *
 * ## La forme lue vient de l'inférence, pas d'une devinette par ligne
 *
 * `1 234,56` et `1,234.56` désignent deux nombres différents, et rien dans la cellule ne les
 * départage. C'est la COLONNE qui tranche (`shape.ts`, sur cent lignes), et la même règle
 * s'applique ensuite à toutes ses cellules. Deviner ligne à ligne ferait cohabiter deux lectures
 * dans un même fichier, et la ligne qui bascule serait invisible.
 *
 * Une cellule que la forme de sa colonne ne sait pas lire devient une **anomalie signalée** avec
 * son numéro de ligne — jamais une valeur approchée, jamais un zéro silencieux.
 */
import type { PivotAmount } from '../../domain/types';
import type { CsvTable } from '../csv';
import { utcStringToMs } from '../time';
import type { PivotIssue } from '../pivot/rows';
import type { PlatformConversion, PlatformDraft } from '../platforms/types';
import type { ConfirmedMapping, MappingTarget } from './schema';
import { readDecimalShape, type ShapeInfo, type ValueShape } from './shape';

/**
 * Séparateur du contenu natif : le séparateur d'unité ASCII, écrit en échappement `\u001f` —
 * un caractère de contrôle invisible dans un fichier source est un piège de relecture (même
 * convention que les cassettes du harnais, `docs/ia-harnais.md`). Aucune cellule CSV ne le
 * porte, donc deux lignes distinctes ne peuvent pas produire le même contenu natif par collage.
 */
const NATIVE_SEPARATOR = '\u001f';

/**
 * Instant d'une cellule selon la forme de sa colonne, en millisecondes UTC, ou `null`.
 *
 * `dmy-datetime` est ramené à l'ISO **avant** d'être lu : `utcStringToMs` est la seule porte
 * d'entrée des dates du dépôt, et lui ajouter un second format l'exposerait à tous les autres
 * imports. Le jour et le mois sont lus dans l'ordre français (`jj/MM/aaaa`) : le fichier est
 * ouvert par un utilisateur français, et une date américaine mal lue se verrait — les douze
 * premiers jours de chaque mois excepté, ce qui est précisément le piège. Il est nommé ici et non
 * comblé : la forme `dmy` reste ambiguë par nature.
 */
export function readInstant(raw: string, shape: ValueShape): number | null {
  const text = raw.trim();
  if (text === '') return null;
  if (shape === 'epoch-s') {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  if (shape === 'epoch-ms') {
    const ms = Number(text);
    return Number.isFinite(ms) ? ms : null;
  }
  if (shape === 'dmy-datetime') {
    const match = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[T ](\d{1,2}:\d{2}(?::\d{2})?))?$/.exec(
      text,
    );
    if (match === null) return null;
    const [, day, month, year, time] = match;
    const iso = `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')} ${time ?? '00:00:00'}`;
    return utcStringToMs(iso);
  }
  return utcStringToMs(text);
}

/**
 * Montant d'une cellule selon la forme de sa colonne, en chaîne décimale à point (le format que
 * `Big` lit). Le signe est **conservé** : `draftsToPivotRows` prendra la valeur absolue, le sens
 * étant porté par la jambe, pas par le nombre.
 */
export function readAmount(raw: string, shape: ValueShape): string | null {
  const text = raw.trim();
  if (text === '') return null;
  const read = readDecimalShape(text);
  if (!read.ok) return null;
  const negative = /^-/.test(text) || /^\(.*\)$/.test(text);
  const body = text
    .replace(/^\((.*)\)$/, '$1')
    .replace(/^[+-]/, '')
    .replace(/\s/g, '');
  // Le séparateur décimal effectivement lu commande la dépose des groupements : un point de
  // groupement (`1.234,56`) et un point décimal (`1234.56`) ne se retirent pas de la même façon.
  const separator = read.separator ?? (shape === 'decimal-comma' ? ',' : '.');
  const digits =
    separator === ',' ? body.replace(/\./g, '').replace(',', '.') : body.replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(digits)) return null;
  return negative ? `-${digits}` : digits;
}

const cell = (row: readonly string[], index: number | undefined): string =>
  index === undefined ? '' : (row[index] ?? '');

interface AmountRead {
  readonly value: PivotAmount | null;
  readonly issue: string | null;
}

function readLeg(
  row: readonly string[],
  mapping: ConfirmedMapping,
  shapes: readonly ShapeInfo[],
  amountField: MappingTarget,
  currencyField: MappingTarget,
  what: string,
): AmountRead {
  const amountIndex = mapping.columns[amountField];
  const rawAmount = cell(row, amountIndex).trim();
  const currencyIndex = mapping.columns[currencyField];
  // Une colonne de devise l'emporte toujours ; l'indice d'en-tête ne comble qu'un trou.
  const rawCurrency =
    currencyIndex === undefined
      ? (mapping.impliedCurrencies?.[currencyField] ?? '')
      : cell(row, currencyIndex).trim();
  if (rawAmount === '' && rawCurrency === '') return { value: null, issue: null };
  if (rawAmount === '') return { value: null, issue: null };
  if (rawCurrency === '')
    return { value: null, issue: `${what} : montant sans devise, ligne ignorée.` };
  const shape =
    amountIndex === undefined ? 'free-text' : (shapes[amountIndex]?.shape ?? 'free-text');
  const amount = readAmount(rawAmount, shape);
  if (amount === null)
    return { value: null, issue: `${what} : montant illisible « ${rawAmount} ».` };
  return { value: { amount, currency: rawCurrency }, issue: null };
}

/**
 * Le fichier entier, relu selon l'appariement confirmé. Pur et **sans effet** : c'est ce qui rend
 * l'analyse à blanc du vérificateur possible — rejouer un import complet sans rien écrire.
 */
export function mappedDrafts(
  table: CsvTable,
  mapping: ConfirmedMapping,
  shapes: readonly ShapeInfo[],
): PlatformConversion {
  const drafts: PlatformDraft[] = [];
  const issues: PivotIssue[] = [];
  const dateIndex = mapping.columns.date;
  const dateShape =
    dateIndex === undefined ? 'free-text' : (shapes[dateIndex]?.shape ?? 'free-text');

  table.rows.forEach((row, index) => {
    const lineNo = table.lineNumbers[index] ?? index + 2;
    const timeMs = readInstant(cell(row, dateIndex), dateShape);
    if (timeMs === null) {
      issues.push({
        lineNo,
        message: `Date illisible « ${cell(row, dateIndex).trim()} » : ligne ignorée.`,
      });
      return;
    }
    const sent = readLeg(row, mapping, shapes, 'sentAmount', 'sentCurrency', 'Envoyé');
    const received = readLeg(row, mapping, shapes, 'receivedAmount', 'receivedCurrency', 'Reçu');
    const fee = readLeg(row, mapping, shapes, 'feeAmount', 'feeCurrency', 'Frais');
    const netWorth = readLeg(
      row,
      mapping,
      shapes,
      'netWorthAmount',
      'netWorthCurrency',
      'Contre-valeur',
    );
    const issue = sent.issue ?? received.issue ?? fee.issue ?? netWorth.issue;
    if (issue !== null) {
      issues.push({ lineNo, message: issue });
      return;
    }
    if (sent.value === null && received.value === null) {
      issues.push({ lineNo, message: 'Ligne sans montant envoyé ni reçu : ignorée.' });
      return;
    }
    const rawLabel = cell(row, mapping.columns.label).trim().toLowerCase();
    const label = rawLabel === '' ? null : (mapping.typeLabels[rawLabel] ?? rawLabel);
    drafts.push({
      lineNo,
      // Contenu NATIF : les cellules brutes, jamais les champs pivot qu'on en déduit
      // (décision n° 26). Corriger l'appariement ne change donc pas la clé de la ligne.
      nativeContent: row.join(NATIVE_SEPARATOR),
      timeMs,
      sent: sent.value,
      received: received.value,
      fee: fee.value,
      netWorth: netWorth.value,
      label,
      description: cell(row, mapping.columns.description).trim() || null,
      txHash: cell(row, mapping.columns.txHash).trim() || null,
    });
  });

  return { drafts, issues, skippedInternal: 0 };
}
