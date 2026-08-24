/**
 * Bitpanda — export CSV de l'historique. Colonnes : `"Transaction ID",Timestamp,"Transaction
 * Type",In/Out,"Amount Fiat",Fiat,"Amount Asset",Asset,"Asset market price","Asset market price
 * currency","Asset class","Product ID",Fee,"Fee asset",Spread,"Spread Currency"` (+ `"Tax Fiat"`
 * parfois en queue, ignorée).
 *
 * PRÉAMBULE : le fichier réel commence par 6 lignes hors CSV (avertissement, titulaire, e-mail,
 * date d'ouverture, « Venue: Bitpanda », « Reported by Bitpanda GmbH ») avant la vraie ligne
 * d'en-tête. Comme `parseCsvText` prend la PREMIÈRE ligne non vide comme en-tête (voir `../csv.ts`),
 * `table.header` reçu par `detect()` est alors la ligne d'avertissement, pas les colonnes réelles.
 * Solution retenue, entièrement locale à ce fichier (aucun changement à `csv.ts` ni à la boucle de
 * détection de `index.ts`, hors périmètre de cette tâche) :
 *   - `detect()` reconnaît DEUX formes : l'en-tête direct (cas normal), OU une ligne à ≤ 2 colonnes
 *     mentionnant « bitpanda » (insensible à la casse) — signature plausible de la 1ʳᵉ ligne du
 *     préambule (aucun autre format de ce registre ne produit une ligne à 1-2 colonnes). C'est une
 *     HEURISTIQUE, pas une certitude : le texte exact de la ligne d'avertissement n'a pas été
 *     observé sur un fichier réel (seules les 2 lignes citées entre guillemets dans la spec sont
 *     vérifiées) ; si elle ne mentionne pas « bitpanda », la détection échouera. Signalé comme
 *     hypothèse, pas comme fait établi.
 *   - `convert()` cherche la vraie ligne d'en-tête (toutes les colonnes requises présentes) dans
 *     `table.header` puis les 10 premières `table.rows` ; les lignes suivantes deviennent les
 *     données. Si elle reste introuvable, un unique `PivotIssue` explicite est émis (jamais un
 *     retour silencieux).
 *
 * Le tiret `-` est LA valeur nulle Bitpanda (pas 0, pas vide) : `isNullCell`.
 *
 * `Amount Fiat` est NET des frais : pour un dépôt, le montant brut réellement débité de l'utilisateur
 * est `Amount Fiat + Fee`. Choix retenu : `received` porte `Amount Fiat` tel quel (c'est le montant
 * qui crédite réellement le solde Bitpanda) et `Fee` reste une jambe séparée — les additionner
 * aurait représenté un montant qui ne correspond à aucune écriture réelle sur la plateforme.
 *
 * `Spread` n'est pas un frais facturé (marge incluse dans le prix affiché) : colonne lue mais
 * jamais convertie en jambe de frais, comme demandé par la spec.
 *
 * `Asset market price` est ignoré pour `netWorth` (jamais utilisé) : ce n'est pas une contre-valeur
 * déclarée de LA transaction mais un prix de marché au moment T, donc l'utiliser serait estimer en
 * silence (interdit par les règles du projet) — même choix que Ledger Live pour ses colonnes
 * Countervalue. `netWorth` reste donc toujours `null` ; pour achat/vente la jambe fiat porte déjà
 * la contre-valeur réelle via `sent`/`received`.
 *
 * `In/Out` n'est PAS utilisé : le sens (jambe envoyée/reçue) se déduit entièrement de
 * `Transaction Type` (buy/sell/deposit/withdrawal), ce qui suffit et évite de deviner le
 * vocabulaire exact de cette colonne (non confirmé par la spec) ; toujours exigée à la détection
 * pour la fiabilité du repérage d'en-tête, jamais lue en conversion.
 *
 * `transfer` → HYPOTHÈSE ASSUMÉE : traité comme mouvement interne (`skippedInternal`), par analogie
 * avec tous les autres convertisseurs de ce registre où un type « transfer » désigne un mouvement
 * entre comptes/produits internes à la plateforme (ex. spot ↔ staking), non un fait générateur.
 * La spec ne confirme pas explicitement cette sémantique pour Bitpanda — signalé comme un choix,
 * pas une certitude.
 *
 * Une ligne = une opération complète (aucun regroupement multi-lignes), contrairement à Binance.
 */
import { D, ZERO, type Big } from '../../domain/money';
import type { PivotAmount } from '../../domain/types';
import type { CsvTable } from '../csv';
import type { PivotIssue } from '../pivot/rows';
import { canonHeader, type PlatformConverter, type PlatformDraft } from './types';

const REQUIRED = [
  'transaction id',
  'timestamp',
  'transaction type',
  'in/out',
  'amount fiat',
  'fiat',
  'amount asset',
  'asset',
  'asset class',
];

const isNullCell = (raw: string): boolean => {
  const t = raw.trim();
  return t === '' || t === '-';
};

const ISO_OFFSET_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * ISO 8601 avec décalage explicite (`2026-03-02T09:14:02+01:00`), jamais `new Date(string)`
 * (interdit sur ces valeurs par les règles du projet) : composantes lues par regex, converties en
 * UTC par soustraction du décalage — déterministe quelle que soit la machine. `null` si la forme ou
 * le calendrier (mois/jour hors bornes) est invalide.
 */
export function parseIsoOffsetToMs(raw: string): number | null {
  const m = ISO_OFFSET_RE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, offsetRaw] = m;
  const ms = Number((frac ?? '0').slice(0, 3).padEnd(3, '0'));
  const localAsUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    ms,
  );
  let offsetMinutes = 0;
  if (offsetRaw !== 'Z') {
    const sign = offsetRaw!.startsWith('-') ? -1 : 1;
    const digits = offsetRaw!.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2, 4));
    offsetMinutes = sign * (oh * 60 + om);
  }
  const trueUtc = localAsUtc - offsetMinutes * 60_000;
  // Rejette les calendriers invalides (Date.UTC les fait déborder en silence).
  return new Date(localAsUtc).toISOString().slice(0, 10) === `${y}-${mo}-${d}` ? trueUtc : null;
}

interface ResolvedTable {
  canonical: string[];
  rows: string[][];
  lineNumbers: number[];
}

/** Retrouve la vraie ligne d'en-tête, directement ou après un préambule (voir docstring). */
function resolveHeader(table: CsvTable): ResolvedTable | null {
  const directCanonical = table.header.map(canonHeader);
  if (REQUIRED.every((name) => directCanonical.includes(name))) {
    return { canonical: directCanonical, rows: table.rows, lineNumbers: table.lineNumbers };
  }
  const WINDOW = 10;
  for (let i = 0; i < Math.min(WINDOW, table.rows.length); i++) {
    const candidate = table.rows[i]!;
    const candidateCanonical = candidate.map(canonHeader);
    if (REQUIRED.every((name) => candidateCanonical.includes(name))) {
      return {
        canonical: candidateCanonical,
        rows: table.rows.slice(i + 1),
        lineNumbers: table.lineNumbers.slice(i + 1),
      };
    }
  }
  return null;
}

export const bitpanda: PlatformConverter = {
  id: 'bitpanda',
  label: 'Bitpanda — export de l’historique',
  detect(header) {
    const canonical = header.map(canonHeader);
    if (REQUIRED.every((name) => canonical.includes(name))) return true;
    // Ligne 1 = préambule probable (voir docstring d'en-tête : hypothèse, pas une certitude).
    return header.length > 0 && header.length <= 2 && /bitpanda/i.test(header.join(' '));
  },
  convert(table: CsvTable) {
    const resolved = resolveHeader(table);
    if (!resolved) {
      return {
        drafts: [],
        issues: [
          {
            lineNo: 1,
            message:
              'Bitpanda : ligne d’en-tête introuvable dans les 10 premières lignes (préambule non reconnu).',
          },
        ],
        skippedInternal: 0,
      };
    }
    const { canonical, rows, lineNumbers } = resolved;
    const col = (name: string): number => canonical.indexOf(name);
    const c = {
      txId: col('transaction id'),
      timestamp: col('timestamp'),
      type: col('transaction type'),
      amountFiat: col('amount fiat'),
      fiat: col('fiat'),
      amountAsset: col('amount asset'),
      asset: col('asset'),
      assetClass: col('asset class'),
      fee: col('fee'),
      feeAsset: col('fee asset'),
    };

    const drafts: PlatformDraft[] = [];
    const issues: PivotIssue[] = [];
    let skippedInternal = 0;

    rows.forEach((cells, i) => {
      const lineNo = lineNumbers[i]!;
      const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
      const native = cells.map((x) => (x ?? '').trim()).join('|');

      const rawTimestamp = cell(c.timestamp);
      const timeMs = parseIsoOffsetToMs(rawTimestamp);
      if (timeMs === null) {
        issues.push({
          lineNo,
          message: `Timestamp Bitpanda illisible « ${rawTimestamp} » (ISO 8601 avec décalage attendu).`,
        });
        return;
      }

      const assetClass = cell(c.assetClass).toLowerCase();
      if (assetClass !== 'cryptocurrency' && assetClass !== 'fiat') {
        issues.push({
          lineNo,
          message: `Ligne Bitpanda de classe « ${cell(c.assetClass)} » : hors périmètre crypto.`,
        });
        return;
      }

      let fiatAmount: Big | null;
      let assetAmount: Big | null;
      let feeAmount: Big | null;
      try {
        const rawFiat = cell(c.amountFiat);
        fiatAmount = isNullCell(rawFiat) ? null : D(rawFiat).abs();
        const rawAsset = cell(c.amountAsset);
        assetAmount = isNullCell(rawAsset) ? null : D(rawAsset).abs();
        const rawFee = cell(c.fee);
        feeAmount = isNullCell(rawFee) ? null : D(rawFee).abs();
      } catch {
        issues.push({
          lineNo,
          message: `Montant Bitpanda illisible (Amount Fiat « ${cell(c.amountFiat)} », Amount Asset « ${cell(c.amountAsset)} » ou Fee « ${cell(c.fee)} »).`,
        });
        return;
      }

      const fiatCurrency = cell(c.fiat).toLowerCase();
      const assetCurrency = cell(c.asset).toLowerCase();
      const feeCurrency = cell(c.feeAsset).toLowerCase();
      const txHash = cell(c.txId) || null;

      let feeLeg: PivotAmount | null = null;
      if (feeAmount && feeAmount.gt(ZERO)) {
        if (feeCurrency === '') {
          issues.push({
            lineNo,
            message: `Frais Bitpanda « ${cell(c.fee)} » sans devise (Fee asset manquant).`,
          });
          return;
        }
        feeLeg = { amount: feeAmount.toString(), currency: feeCurrency };
      }

      const push = (
        sent: PivotAmount | null,
        received: PivotAmount | null,
        label: string | null,
        description: string | null,
      ): void => {
        drafts.push({
          lineNo,
          nativeContent: native,
          timeMs,
          sent,
          received,
          fee: feeLeg,
          netWorth: null,
          label,
          description,
          txHash,
        });
      };

      const type = cell(c.type).toLowerCase();
      switch (type) {
        case 'buy': {
          if (!fiatAmount) {
            issues.push({ lineNo, message: 'Achat Bitpanda sans Amount Fiat exploitable.' });
            return;
          }
          if (!assetAmount) {
            issues.push({ lineNo, message: 'Achat Bitpanda sans Amount Asset exploitable.' });
            return;
          }
          push(
            { amount: fiatAmount.toString(), currency: fiatCurrency },
            { amount: assetAmount.toString(), currency: assetCurrency },
            null,
            null,
          );
          break;
        }
        case 'sell': {
          if (!assetAmount) {
            issues.push({ lineNo, message: 'Vente Bitpanda sans Amount Asset exploitable.' });
            return;
          }
          if (!fiatAmount) {
            issues.push({ lineNo, message: 'Vente Bitpanda sans Amount Fiat exploitable.' });
            return;
          }
          push(
            { amount: assetAmount.toString(), currency: assetCurrency },
            { amount: fiatAmount.toString(), currency: fiatCurrency },
            null,
            null,
          );
          break;
        }
        case 'deposit':
        case 'withdrawal': {
          const leg: PivotAmount | null =
            assetClass === 'fiat'
              ? fiatAmount
                ? { amount: fiatAmount.toString(), currency: fiatCurrency }
                : null
              : assetAmount
                ? { amount: assetAmount.toString(), currency: assetCurrency }
                : null;
          if (!leg) {
            issues.push({
              lineNo,
              message: `${type === 'deposit' ? 'Dépôt' : 'Retrait'} Bitpanda sans montant exploitable (classe « ${assetClass} »).`,
            });
            return;
          }
          let description: string | null = null;
          if (
            type === 'deposit' &&
            feeLeg &&
            assetClass === 'fiat' &&
            feeLeg.currency === fiatCurrency
          ) {
            const gross = D(leg.amount).plus(D(feeLeg.amount));
            description = `Bitpanda : Amount Fiat net de frais ; brut = ${gross.toString()} ${fiatCurrency.toUpperCase()}.`;
          }
          if (type === 'deposit') push(null, leg, null, description);
          else push(leg, null, null, description);
          break;
        }
        case 'transfer':
          // Mouvement interne à la plateforme : voir hypothèse assumée en tête de fichier.
          skippedInternal++;
          break;
        default:
          issues.push({
            lineNo,
            message: `Type Bitpanda inconnu « ${cell(c.type)} » : ligne non importée.`,
          });
      }
    });

    return { drafts, issues, skippedInternal };
  },
};
