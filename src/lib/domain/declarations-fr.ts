/**
 * Comptes à déclarer au formulaire **3916-bis** (P66), DÉDUITS des comptes déjà saisis — jamais une
 * déclaration officielle, jamais un conseil fiscal.
 *
 * Article 1649 bis C du CGI (Légifrance, version en vigueur depuis le 01/07/2026) : les personnes
 * domiciliées ou établies en France déclarent, avec leur déclaration de revenus, les références des
 * comptes de crypto-actifs **ouverts, détenus, utilisés ou clos auprès d'entreprises, personnes
 * morales, institutions ou organismes établis À L'ÉTRANGER**. Le critère légal est l'établissement
 * de l'ORGANISME — jamais sa licence, jamais la chaîne suivie par le compte :
 *
 * - **Coinhouse est hors périmètre** : PSCA FRANÇAIS (COINHOUSE SAS, Paris, agrément AMF
 *   n° A2026-013 du 11/05/2026). Toujours `excluded-domestic`, quoi qu'il détienne.
 * - **Les plateformes européennes SONT dans le périmètre** : le passeport MiCA ne change rien au
 *   critère légal de l'établissement. Bitpanda (Autriche), Bitvavo (Pays-Bas), SwissBorg (Suisse)
 *   → comptes étrangers déclarables, MÊME VIDES (défauts posés dans `src/lib/import/platforms/`).
 * - **Le portefeuille auto-hébergé n'est PAS tranché** par le texte : la doctrine
 *   BOI-RPPM-PVBMC-30-30 reprend la formule légale (compte détenu *auprès d'un tiers*) sans viser
 *   nommément ce cas, et un amendement en discussion (CF1520, PLF 2026) viserait à le couvrir
 *   au-delà de 5 000 €. Ce module SIGNALE l'incertitude (`uncertain-self-hosted`) ; il ne tranche
 *   jamais, et un compte on-chain ou Hyperliquid n'est JAMAIS promu à un autre statut, quelle que
 *   soit son activité — l'incertitude est juridique, pas une affaire de volume.
 *
 * Module pur (décision n° 40) : aucune horloge, aucun `number` sur une quantité — seulement des
 * dates déjà présentes dans les événements et des soldes en `Big` (pour dire « vide », jamais pour
 * un PRU). Le texte français vit dans `src/lib/format/declarations-fr.ts`.
 */
import { D, ZERO, isZero, type Big } from './money';
import type { Account, AccountId, CountryCode, LedgerEvent } from './types';

export type DeclarationStatus =
  'excluded-domestic' | 'included' | 'uncertain-self-hosted' | 'unknown';

export interface AccountDeclaration {
  accountId: AccountId;
  label: string;
  status: DeclarationStatus;
  /** Pays déclaré sur le compte (`null` si absent) — jamais déduit d'autre chose que `Account.country`. */
  country: CountryCode | null;
  /** Au moins un événement de ce compte est daté dans `year`. */
  usedInYear: boolean;
  /** Solde non nul sur au moins un actif, à la fin du grand livre (tous événements confondus). */
  currentlyHolds: boolean;
  /** Détenait quelque chose à un moment donné jusqu'à la fin de `year`, et n'a plus rien à ce terme. */
  possiblyClosedInYear: boolean;
}

export interface DeclarationReport {
  year: number;
  accounts: AccountDeclaration[];
  /** Comptes au statut `included` : c'est CE compte qui porte le risque de sanction (art. 1736 X). */
  includedCount: number;
  /** Comptes au statut `uncertain-self-hosted` : le texte ne tranche pas, jamais compté avec les précédents. */
  uncertainCount: number;
}

export interface DeclarationInput {
  /** Comptes déjà saisis dans l'app (implicites et déclarés), dans n'importe quel ordre. */
  accounts: readonly Account[];
  /** Grand livre complet (toutes années) : sert à dater l'usage et à estimer le solde. */
  events: readonly LedgerEvent[];
  /** Année de la déclaration visée (celle du rapport). */
  year: number;
}

const yearOf = (at: string): number => Number(at.slice(0, 4));

/**
 * Statut légal d'un compte : dépend UNIQUEMENT de son genre et du pays qu'il porte — jamais deviné
 * à partir d'une chaîne suivie, d'une adresse ou d'un volume d'opérations.
 */
function statusOf(account: Account): DeclarationStatus {
  if (account.kind === 'coinhouse') return 'excluded-domestic';
  // Auto-hébergé : incertitude JURIDIQUE (voir l'en-tête du module) — jamais promu ailleurs.
  if (account.kind === 'onchain' || account.kind === 'hyperliquid') return 'uncertain-self-hosted';
  // csv / manual : la juridiction déclarée sur le compte, telle quelle.
  if (!account.country) return 'unknown';
  return account.country === 'FR' ? 'excluded-domestic' : 'included';
}

/**
 * Répercute une jambe signée sur le solde courant d'un actif. Sert uniquement à distinguer
 * « vide » de « non vide » (obligation 3916-bis sans seuil) : jamais un coût, jamais un PRU.
 */
function applyLegs(balances: Map<string, Big>, event: LedgerEvent): void {
  const add = (asset: string, qty: Big): void => {
    balances.set(asset, (balances.get(asset) ?? ZERO).plus(qty));
  };
  switch (event.kind) {
    case 'trade':
    case 'migration':
      add(event.out.asset, D(event.out.qty).neg());
      add(event.in.asset, D(event.in.qty));
      return;
    case 'reward':
    case 'deposit':
    case 'opening-balance':
      add(event.in.asset, D(event.in.qty));
      return;
    case 'withdrawal':
      add(event.out.asset, D(event.out.qty).neg());
      return;
    case 'unqualified':
      for (const leg of event.legs) add(leg.asset, D(leg.signedQty));
      return;
    case 'fee':
      // Frais Coinhouse (abonnement) : jamais rattaché à un actif suivi ici.
      return;
  }
}

const holdsAny = (balances: Map<string, Big>): boolean =>
  [...balances.values()].some((qty) => !isZero(qty));

/**
 * Rejoue le grand livre (tous comptes) dans l'ordre chronologique jusqu'à la fin de `cutoffYear`
 * inclus (`Infinity` = tout le grand livre, c'est-à-dire « maintenant »). Renvoie le solde final par
 * compte ET l'ensemble des comptes ayant détenu quelque chose à un instant quelconque de la période
 * — un compte vidé avant le terme n'est pas seulement décrit par son solde final.
 */
function replayThroughYear(
  events: readonly LedgerEvent[],
  cutoffYear: number,
): { balances: Map<AccountId, Map<string, Big>>; everHeld: Set<AccountId> } {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const balances = new Map<AccountId, Map<string, Big>>();
  const everHeld = new Set<AccountId>();
  for (const event of sorted) {
    if (yearOf(event.at) > cutoffYear) break;
    const account = balances.get(event.accountId) ?? new Map<string, Big>();
    applyLegs(account, event);
    balances.set(event.accountId, account);
    if (holdsAny(account)) everHeld.add(event.accountId);
  }
  return { balances, everHeld };
}

/**
 * Classe chaque compte déjà saisi, pour l'année visée. AUCUN statut n'est deviné : un pays absent
 * reste `unknown`, un auto-hébergé reste `uncertain-self-hosted` quelle que soit son activité.
 */
export function computeDeclarations(input: DeclarationInput): DeclarationReport {
  const usedInYear = new Set(
    input.events.filter((e) => yearOf(e.at) === input.year).map((e) => e.accountId),
  );
  const atYearEnd = replayThroughYear(input.events, input.year);
  const now = replayThroughYear(input.events, Infinity);

  const accounts: AccountDeclaration[] = input.accounts.map((account) => {
    const currentlyHolds = holdsAny(now.balances.get(account.id) ?? new Map());
    const heldAtYearEnd = holdsAny(atYearEnd.balances.get(account.id) ?? new Map());
    return {
      accountId: account.id,
      label: account.label,
      status: statusOf(account),
      country: account.country ?? null,
      usedInYear: usedInYear.has(account.id),
      currentlyHolds,
      // Détenait quelque chose à un instant jusqu'à la fin de l'année visée, et n'a plus rien à ce
      // terme : un signal, jamais une certitude (le grand livre peut s'arrêter avant la clôture réelle).
      possiblyClosedInYear: atYearEnd.everHeld.has(account.id) && !heldAtYearEnd,
    };
  });

  return {
    year: input.year,
    accounts,
    includedCount: accounts.filter((a) => a.status === 'included').length,
    uncertainCount: accounts.filter((a) => a.status === 'uncertain-self-hosted').length,
  };
}

/** Comptes qui concernent RÉELLEMENT l'utilisateur : tout sauf ceux hors périmètre France d'office. */
export function concernedDeclarations(report: DeclarationReport): readonly AccountDeclaration[] {
  return report.accounts.filter((a) => a.status !== 'excluded-domestic');
}
