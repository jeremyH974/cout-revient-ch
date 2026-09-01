/**
 * Veille réglementaire (P67) : ce que la loi et la doctrine disent, à la date où c'est relu —
 * jamais ce qu'elles pourraient devenir. Principalement la fiscalité française des crypto-actifs ;
 * depuis P70, aussi les obligations qui pèsent sur **ce que l'app affiche** (marquage des textes
 * générés par un modèle) — même nature de fait juridique, même barrière de fraîcheur.
 *
 * **Table entièrement manuelle, sans générateur.** Contrairement au calendrier macro
 * (`../calendar`) ou aux indicateurs (`../macro`), rien ici ne s'automatise : « adopté en
 * commission » ou « la doctrine n'est pas stabilisée » sont des jugements de lecture d'un texte,
 * pas une donnée qu'on récupère par une requête. Le modèle le plus proche est
 * `../support/sources.ts` (catalogue déclaratif, relu à la main, daté), pas
 * `../calendar/bls-schedule.ts` (recopié depuis une page qui refuse les clients non-navigateurs).
 *
 * **Pourquoi hors de `domain/`.** Ce module ne porte ni montant ni quantité — aucun `Big`, aucune
 * chaîne décimale — donc rien de ce qui définit le moteur pur (voir `CLAUDE.md`). Il est la
 * sœur de `calendar/` et `macro/` : de la donnée compilée dans le bundle, jamais interrogée à
 * l'exécution.
 *
 * **La barrière de fraîcheur.** Une ligne de veille non relue depuis trop longtemps est un
 * mensonge silencieux — l'app continuerait d'annoncer un statut que personne n'a vérifié depuis
 * des mois. `isStale` / `staleEntries` l'attrapent : statut mouvant (`in-discussion`,
 * `adopted-not-final`, `doctrine-unsettled`) non relu depuis plus de 3 mois, statut stable
 * (`in-force`, `adopted-final`, `dropped`) non relu depuis plus de 6 mois, ou échéance annoncée
 * dépassée sans relecture postérieure (celle-là sans délai de grâce : une échéance qui passe doit
 * être rouverte, pas simplement attendue). Ces fonctions prennent `today` **en paramètre** — jamais
 * une horloge cachée (`Date.now()`), pour rester testables sans dépendre de l'instant d'exécution
 * et pour que l'appelant (test, écran) contrôle exactement ce qu'« aujourd'hui » signifie.
 *
 * **Ce module ne dit jamais ce qu'il faut faire.** `effect` constate un régime ou son absence,
 * jamais une recommandation ; le rendu français (`../format/watch.ts`) ne fait qu'habiller ces
 * mêmes faits, comme `format/insights.ts` habille les constats du moteur (décision n° 40) — sans
 * s'y confondre : une entrée de veille est vraie indépendamment des données de l'utilisateur, un
 * constat se déduit d'elles.
 */
import { epochDayOf } from '../domain/date';

/** Statut d'une ligne de veille — fermé délibérément : un statut inconnu doit casser la
 * compilation plutôt que s'afficher sans libellé (voir le `switch` exhaustif du rendu). */
export type WatchStatus =
  | 'in-force'
  | 'adopted-final'
  | 'adopted-not-final'
  | 'in-discussion'
  | 'doctrine-unsettled'
  | 'dropped';

/**
 * Thème d'une ligne, pour un filtre éventuel sur l'écran dédié (`relevantTo`). Volontairement
 * grossier : six thèmes suffisent à dix entrées, une taxonomie plus fine coûterait plus qu'elle
 * ne rendrait service.
 */
export type WatchTopic = 'cession' | 'detention' | 'revenus' | 'declaratif' | 'nft' | 'ia';

/** Certitude de l'entrée : ce que le texte permet d'affirmer, distinct du statut lui-même. */
export type WatchCertainty = 'confirmed' | 'secondary-only';

export interface WatchSource {
  /** Référence telle que citée par le juriste qui l'invoque (loi, article, décret, JORF). */
  label: string;
  /** `null` quand aucune adresse n'a pu être confirmée : jamais une adresse inventée. */
  url: string | null;
  /** Texte officiel (Légifrance, JORF, BOFiP…) plutôt que commentaire de cabinet. */
  official: boolean;
  /** Jour de lecture de la source, `AAAA-MM-JJ`. */
  checkedOn: string;
}

export interface WatchEntry {
  /** Identifiant stable, indépendant du libellé affiché. */
  id: string;
  /** Intitulé court, en français. */
  title: string;
  status: WatchStatus;
  /** Jour où ce statut est devenu vrai (date du texte, pas date de relecture), `AAAA-MM-JJ`. */
  statusDate: string;
  /** Une phrase française : ce que ça change, jamais un montant ni un conseil. */
  effect: string;
  source: WatchSource;
  /**
   * `confirmed` — un texte officiel permet d'écrire `effect` tel quel. `secondary-only` — seuls
   * des commentaires de praticiens le disent ; l'écran doit le signaler comme tel.
   */
  certainty: WatchCertainty;
  /** Jour de relecture de CETTE ligne (statut et effet), `AAAA-MM-JJ` — sert à `isStale`. */
  reviewedOn: string;
  /** Échéance annoncée (ex. premier échange DAC8/CARF), `AAAA-MM-JJ`. Absente si aucune. */
  deadline?: string;
  topics: readonly WatchTopic[];
}

export const WATCH_ENTRIES: readonly WatchEntry[] = [
  {
    id: 'pfu-31_4',
    title: 'Taux du prélèvement forfaitaire unique',
    status: 'in-force',
    statusDate: '2025-12-30',
    effect: '31,4 % (12,8 % IR + 18,6 % PS) sur les cessions depuis l’année 2025 ; 30 % avant',
    source: {
      label: 'LOI n° 2025-1403 du 30/12/2025 (LFSS 2026), art. 12, JORF 31/12/2025',
      url: 'https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000053226452',
      official: true,
      checkedOn: '2026-08-29',
    },
    certainty: 'confirmed',
    reviewedOn: '2026-08-29',
    topics: ['cession'],
  },
  {
    id: 'seuil-305',
    title: 'Seuil d’exonération de 305 €',
    status: 'in-force',
    statusDate: '2026-08-23',
    effect:
      'Aucune imposition sous 305 € de cessions dans l’année ; au-delà, tout est imposable dès le premier euro',
    source: {
      label: 'CGI art. 150 VH bis (Légifrance)',
      url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038612228',
      official: true,
      checkedOn: '2026-08-29',
    },
    certainty: 'confirmed',
    reviewedOn: '2026-08-29',
    topics: ['cession'],
  },
  {
    id: 'patrimoine-improductif',
    title: 'Amendement « fortune improductive »',
    status: 'dropped',
    statusDate: '2026-02-19',
    effect: 'Aucun effet : les crypto-actifs ne sont pas entrés dans une assiette de type IFI',
    source: {
      label:
        'LOI n° 2026-103 du 19/02/2026 (LF 2026), JORF 20/02/2026 — dispositif voté par l’Assemblée le 31/10/2025 puis abandonné',
      url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053508155',
      official: true,
      checkedOn: '2026-08-29',
    },
    certainty: 'confirmed',
    reviewedOn: '2026-08-29',
    topics: ['detention'],
  },
  {
    id: 'staking',
    title: 'Régime des récompenses de staking',
    status: 'doctrine-unsettled',
    statusDate: '2026-08-29',
    effect:
      'Aucun bulletin officiel dédié ; l’imposition à la cession n’est qu’une position de cabinets, non opposable',
    source: {
      label: 'Aucun texte officiel identifié (BOI-RPPM-PVBMC-30-20 ne traite pas le cas)',
      url: null,
      official: false,
      checkedOn: '2026-08-29',
    },
    certainty: 'secondary-only',
    reviewedOn: '2026-08-29',
    topics: ['revenus'],
  },
  {
    id: 'airdrops',
    title: 'Régime des airdrops',
    status: 'doctrine-unsettled',
    statusDate: '2026-08-29',
    effect:
      'La distinction entre airdrop passif (imposé à la cession) et airdrop rémunérant une tâche (imposé à réception) est évoquée par les praticiens, non confirmée par un texte',
    source: {
      label: 'Aucun texte officiel identifié (BOI-RPPM-PVBMC-30-20 ne traite pas le cas)',
      url: null,
      official: false,
      checkedOn: '2026-08-29',
    },
    certainty: 'secondary-only',
    reviewedOn: '2026-08-29',
    topics: ['revenus'],
  },
  {
    id: 'bareme-progressif',
    title: 'Option pour le barème progressif',
    status: 'in-force',
    statusDate: '2026-08-29',
    effect: 'Alternative globale et annuelle au prélèvement forfaitaire, sur option expresse',
    source: {
      label: 'CGI art. 200 A (Légifrance)',
      url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042909847',
      official: true,
      checkedOn: '2026-08-29',
    },
    certainty: 'confirmed',
    reviewedOn: '2026-08-29',
    topics: ['cession'],
  },
  {
    id: 'dac8-collecte',
    title: 'Collecte DAC8/CARF par les plateformes',
    status: 'in-force',
    statusDate: '2026-01-01',
    effect:
      'Les prestataires collectent vos données depuis le 1er janvier 2026 ; transmission à l’administration en 2027',
    source: {
      label: 'Décret n° 2025-1276 du 19/12/2025 (CGI art. 1649 AC bis à sexies), JORF',
      url: 'https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053157956',
      official: true,
      checkedOn: '2026-08-29',
    },
    certainty: 'confirmed',
    reviewedOn: '2026-08-29',
    topics: ['declaratif'],
  },
  {
    id: 'dac8-echange',
    title: 'Premier échange automatique DAC8/CARF',
    status: 'in-force',
    statusDate: '2026-08-29',
    effect:
      'Premier croisement international annoncé au plus tard le 30/09/2027, sur les opérations 2026',
    source: {
      label: 'Cadre CARF/OCDE et DAC8 ; la date est reprise de cabinets, absente du décret',
      url: null,
      official: false,
      checkedOn: '2026-08-29',
    },
    certainty: 'secondary-only',
    reviewedOn: '2026-08-29',
    deadline: '2027-09-30',
    topics: ['declaratif'],
  },
  {
    id: 'perpetuals-150-ter',
    title: 'Régime fiscal des perpetuals (dérivés)',
    status: 'doctrine-unsettled',
    statusDate: '2026-09-01',
    effect:
      'Les contrats à terme et CFD relèvent vraisemblablement de l’art. 150 ter du CGI — PFU sans ' +
      'abattement, pertes imputables sur les seuls gains de même nature, report 10 ans — donc d’un ' +
      'régime DISTINCT des cessions d’actifs numériques (150 VH bis). La qualification d’un ' +
      'perpetual DeFi non régulé au regard de ce texte n’est tranchée par AUCUNE source primaire ' +
      'trouvée. L’estimation fiscale de l’app ne couvre donc que l’espace Investissement ; les ' +
      'perpetuals en sont exclus, et ce n’est pas un oubli',
    /*
     * `official: false` et `url: null` alors que l'art. 150 ter existe bel et bien : ce que cette
     * ligne affirme n'est pas le texte, c'est **l'absence de qualification** des perpetuals DeFi au
     * regard de ce texte. Aucune source officielle ne confirme ce point — seules des analyses
     * secondaires convergentes le suggèrent — et l'invariant du module a raison d'exiger qu'une
     * source officielle accompagne un fait confirmé. Citer Légifrance ici ferait passer une
     * incertitude pour une certitude.
     */
    source: {
      label:
        'Analyses secondaires convergentes rattachant les dérivés à l’art. 150 ter du CGI ; aucune source primaire ne traite le cas des perpetuals DeFi',
      url: null,
      official: false,
      checkedOn: '2026-09-01',
    },
    certainty: 'secondary-only',
    reviewedOn: '2026-09-01',
    topics: ['cession'],
  },
  {
    id: 'nft-regime',
    title: 'Régime propre aux jetons uniques (NFT)',
    status: 'adopted-final',
    statusDate: '2026-06-25',
    effect:
      'Les jetons uniques sortent du régime de l’article 150 VH bis pour les cessions depuis le 01/01/2026 — hors périmètre de cette app, qui ne suit que des actifs fongibles',
    source: {
      label: 'LOI n° 2026-534 du 25/06/2026, art. 90-91, JORF 26/06/2026',
      url: 'https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000054310089',
      official: true,
      checkedOn: '2026-08-29',
    },
    certainty: 'confirmed',
    reviewedOn: '2026-08-29',
    topics: ['nft', 'cession'],
  },
  {
    // Ajoutée par P70 : le harnais d'évaluation des fonctions d'IA impose d'étiqueter tout texte
    // généré (`AI_NOTICE`, dans `src/lib/ai/contract.ts`). La mention VISIBLE est claire et
    // datée ; le marquage LISIBLE PAR MACHINE ne l'est pas, et c'est exactement le genre
    // d'incertitude que cette table existe pour ne pas laisser à l'état de rumeur.
    id: 'ai-act-marquage',
    title: 'Marquage des textes générés par une IA (AI Act, art. 50)',
    status: 'doctrine-unsettled',
    statusDate: '2026-08-30',
    effect:
      'La mention visible d’un texte généré est obligatoire depuis le 02/08/2026 ; le marquage lisible par machine, lui, n’a aucune norme technique stabilisée — aucun format n’est désigné, et le délai de grâce annoncé pour l’existant court jusqu’à décembre 2026',
    source: {
      label:
        'Aucune norme technique identifiée (le règlement (UE) 2024/1689, art. 50, impose le marquage sans en désigner le format ; les formats cités le sont par des praticiens)',
      url: null,
      official: false,
      checkedOn: '2026-08-30',
    },
    certainty: 'secondary-only',
    reviewedOn: '2026-08-30',
    topics: ['ia'],
  },
];

/** Statuts jugés mouvants : ils réclament une relecture sous 3 mois plutôt que 6. */
const VOLATILE_STATUSES: ReadonlySet<WatchStatus> = new Set([
  'in-discussion',
  'adopted-not-final',
  'doctrine-unsettled',
]);

/** ~3 mois. */
const VOLATILE_MAX_DAYS = 92;
/** ~6 mois. */
const STABLE_MAX_DAYS = 183;

/**
 * Une ligne est-elle périmée au jour `today` (`AAAA-MM-JJ`) ?
 *
 * Trois barrières, la première qui s'applique l'emporte :
 * 1. échéance (`deadline`) dépassée sans relecture postérieure → périmée, sans délai de grâce ;
 * 2. statut mouvant non relu depuis plus de 3 mois → périmée ;
 * 3. statut stable non relu depuis plus de 6 mois → périmée.
 *
 * Une date illisible (`statusDate`, `reviewedOn` ou `deadline` mal formée) se traite comme
 * périmée par prudence : le silence ne doit jamais se confondre avec la fraîcheur.
 */
export function isStale(entry: WatchEntry, today: string): boolean {
  const todayDay = epochDayOf(today);
  const reviewedDay = epochDayOf(entry.reviewedOn);
  if (todayDay === null || reviewedDay === null) return true;
  if (entry.deadline !== undefined) {
    const deadlineDay = epochDayOf(entry.deadline);
    if (deadlineDay === null) return true;
    if (deadlineDay < todayDay && reviewedDay < deadlineDay) return true;
  }
  const maxDays = VOLATILE_STATUSES.has(entry.status) ? VOLATILE_MAX_DAYS : STABLE_MAX_DAYS;
  return todayDay - reviewedDay > maxDays;
}

/** Les entrées périmées au jour `today`. Doit rendre `[]` sur `WATCH_ENTRIES` en continu. */
export function staleEntries(entries: readonly WatchEntry[], today: string): readonly WatchEntry[] {
  return entries.filter((entry) => isStale(entry, today));
}

/** Entrées touchant un thème donné, dans leur ordre d'origine. */
export function relevantTo(
  entries: readonly WatchEntry[],
  topic: WatchTopic,
): readonly WatchEntry[] {
  return entries.filter((entry) => entry.topics.includes(topic));
}
