/**
 * Le calendrier macroéconomique américain : ce que l'app en sait, et sous quelle forme.
 *
 * Trois choix structurent ce module.
 *
 * **Aucune requête à l'exécution.** Le calendrier est un fichier TypeScript *engendré* et committé
 * (`events.generated.ts`), importé dans le bundle comme `tickers.generated.ts` l'est déjà. Il n'y a
 * donc ni origine à autoriser dans la CSP, ni opt-in réseau, ni tiers qui apprenne quels événements
 * vous consultez — et l'écran fonctionne hors ligne par construction, pas par précache.
 *
 * **Des instants, pas des dates naïves.** La règle du projet « jamais de conversion de fuseau »
 * vise les dates Coinhouse, qui sont *naïves* : « 14:32:11 » sans fuseau, dont toute conversion
 * inventerait de l'information. Un événement macro est l'exact inverse — « 8 h 30, heure de New
 * York » est un **instant réel**, dont la position en UTC dépend de l'heure d'été américaine. La
 * conversion est donc faite **une fois, à la génération**, par le fuseau IANA `America/New_York` ;
 * `at` porte le résultat en UTC, et l'écran le rend dans le fuseau du lecteur. Confondre les deux
 * régimes produirait des heures fausses une moitié de l'année.
 *
 * **Un rang éditorial, annoncé comme tel.** `tier` distingue ce qui déplace les marchés de ce qui
 * les intéresse. C'est un **choix de rédaction**, pas une mesure : aucune volatilité n'a été
 * calculée pour l'établir, et l'écran le dit. L'alternative — n'afficher aucun rang — rendrait la
 * liste illisible ; l'alternative inverse — prétendre à une mesure — serait un chiffre inventé.
 *
 * Ce module ne recommande rien et n'interprète rien : il dit ce qui sera publié, et quand.
 */

/**
 * Institution qui publie, et qui fait foi en cas de doute.
 *
 * Le Trésor américain n'y est pas : ses adjudications quotidiennes sont du bruit pour qui suit la
 * crypto, et les annonces de refinancement trimestriel méritent leur propre traitement. Mieux vaut
 * trois sources tenues que quatre dont une décorative.
 */
export type SourceId = 'fomc' | 'bls' | 'bea' | 'ecb' | 'eurostat';

/**
 * Nature de la publication. Volontairement fermée : un type inconnu doit casser la compilation
 * plutôt que d'atterrir sans libellé ni icône dans la liste.
 */
export type EventKind =
  /**
   * Décision de politique monétaire : communiqué et conférence de presse, plus les projections
   * économiques quatre fois par an.
   *
   * Les *minutes* de la réunion n'y figurent pas, et c'est délibéré : la Fed les publie trois
   * semaines après, mais n'annonce la date qu'une fois la réunion tenue. La déduire de sa règle
   * serait une prévision présentée comme un fait — exactement ce que ce module s'interdit.
   */
  | 'fomc-decision'
  | 'cpi'
  | 'ppi'
  | 'employment'
  | 'jolts'
  | 'pce'
  | 'gdp'
  /**
   * Décision du Conseil des gouverneurs de la BCE (décision n° 93). Trois pièges sur la page
   * officielle, tous écartés par le parseur : une réunion « **non**-monetary policy » contient la
   * sous-chaîne « monetary policy meeting » ; le « General Council » est un autre organe ; et la
   * conférence de presse a sa propre ligne, qui doublerait la réunion.
   */
  | 'ecb-decision'
  /** Inflation de la zone euro (IPCH), estimation rapide puis chiffre définitif. */
  | 'hicp';

/**
 * `exact` — l'heure de publication est officiellement annoncée (le cas courant : 8 h 30 ou
 * 14 h 00 à New York). `day` — seul le jour l'est ; l'écran n'affiche alors aucune heure plutôt
 * qu'une heure plausible.
 */
export type TimePrecision = 'exact' | 'day';

/** Rang éditorial. Voir l'en-tête : c'est une hiérarchie de lecture, pas une mesure d'impact. */
export type EventTier = 'major' | 'secondary';

export interface MarketEvent {
  /**
   * Identifiant stable et lisible, `<source>-<kind>-<jour>`. Stable veut dire : recalculé à
   * l'identique à chaque génération, pour que le diff hebdomadaire du fichier engendré reste
   * relisible — et qu'un futur rappel « une heure avant » puisse s'y accrocher.
   */
  id: string;
  kind: EventKind;
  /** Instant UTC, ISO 8601 terminé par `Z`. Jamais une date locale. */
  at: string;
  precision: TimePrecision;
  /** Libellé affiché, en français. */
  title: string;
  /** Précision affichée sous le titre, quand elle apporte quelque chose. */
  detail?: string;
  tier: EventTier;
  source: SourceId;
  /** Page officielle de la publication : l'utilisateur doit pouvoir remonter à la source. */
  url: string;
}

/** Ce que chaque source a fourni, et quand elle a été lue. Affiché avec le calendrier. */
export interface SourceStamp {
  source: SourceId;
  /** Jour de lecture, `AAAA-MM-JJ`. */
  checkedOn: string;
  /** Nombre d'événements retenus, pour que les barrières du générateur soient vérifiables. */
  count: number;
  /** Dernier jour annoncé par cette source, `AAAA-MM-JJ`. */
  coversTo: string;
  /**
   * `auto` — relue à chaque exécution du cron. `manual` — table tenue à la main, parce que la
   * source refuse les clients non-navigateurs (voir `bls-schedule.ts`).
   */
  upkeep: 'auto' | 'manual';
}

/** Le fichier engendré, en entier. */
export interface Calendar {
  /** Instant de génération, UTC. */
  generatedAt: string;
  /** Premier et dernier jour présents dans la liste, `AAAA-MM-JJ`. */
  coversFrom: string;
  coversTo: string;
  /**
   * Jour jusqu'auquel le calendrier est **complet**, c'est-à-dire le plus proche des horizons de
   * ses sources.
   *
   * La distinction n'est pas cosmétique : la Fed publie ses réunions dix-huit mois à l'avance,
   * le BLS douze, le BEA un an civil. Afficher `coversTo` — la dernière réunion connue, fin 2027 —
   * laisserait croire que l'app connaît les CPI de 2027, qui ne sont pas publiés. C'est
   * `completeTo` que l'écran annonce, et au-delà duquel il prévient qu'il ne sait plus tout.
   */
  completeTo: string;
  sources: readonly SourceStamp[];
  /** Trié par `at` croissant, puis par `id` — l'ordre est stable d'une génération à l'autre. */
  events: readonly MarketEvent[];
}
