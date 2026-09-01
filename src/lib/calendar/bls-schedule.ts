/**
 * Le calendrier du Bureau of Labor Statistics — CPI, emploi, PPI, JOLTS — tenu **à la main**.
 *
 * Pourquoi à la main, alors que tout le reste du calendrier est engendré automatiquement : le
 * réseau de diffusion de `www.bls.gov` répond **403 à tout client qui n'est pas un navigateur**.
 * Constaté le 28/08/2026 depuis deux réseaux distincts, sur les pages de calendrier *et* sur le
 * flux `bls.ics` — celui-là même que le BLS publie pour qu'on s'y abonne depuis un agenda. Un cron
 * GitHub Actions serait donc bloqué lui aussi.
 *
 * Se faire passer pour un navigateur contournerait un contrôle d'accès délibéré. La donnée, elle,
 * est publique et du domaine public (œuvre du gouvernement fédéral, 17 U.S.C. § 105) : elle est
 * donc **relue dans un vrai navigateur, une fois par an**, et recopiée ici.
 *
 * Ce que ça coûte, et comment on évite que ça pourrisse. Une table périmée en silence serait pire
 * que pas de table du tout — l'écran affirmerait qu'il n'y a pas de CPI le mois prochain. Mais la
 * couverture qui raccourcit recouvre **deux situations opposées**, et les confondre revient à
 * crier au loup :
 *
 * - **notre copie est en retard** : le BLS a publié plus loin, personne n'a relu. Un humain peut
 *   corriger — le générateur refuse d'écrire et le cron ouvre une issue ;
 * - **la source elle-même s'arrête** : le BLS n'a pas encore publié l'année suivante. Personne ne
 *   peut rien, sinon revenir voir. Bloquer serait absurde ; le générateur écrit et le cron pose un
 *   rappel.
 *
 * Rien ici ne permet de distinguer les deux — seule une relecture le peut. C'est pourquoi
 * `BLS_CHECKED_ON` porte une **affirmation** et pas seulement une date : « à ce jour, tout ce que
 * le BLS publiait était recopié ci-dessous ». La barrière du générateur s'appuie dessus : elle ne
 * bloque que si la couverture est courte **et** que cette affirmation a vieilli.
 *
 * Constaté le 01/09/2026, les quatre pages relues : le BLS s'arrête au 15/12/2026 et n'a pas encore
 * publié son calendrier 2027 — sa navigation n'offre que « ENTIRE YEAR, 2026 » et « PRIOR YEARS ».
 * Les dates ci-dessous sont donc complètes, et le resteront jusqu'à cette publication (à l'automne,
 * sans date annoncée).
 *
 * Les heures sont celles de New York, telles que le BLS les publie (« All times on calendar are
 * Eastern Time »). Leur conversion en UTC est faite à la génération, jamais ici.
 */

import type { EventKind, EventTier } from './types';

/**
 * Jour de lecture des pages officielles, `AAAA-MM-JJ`. Sert aussi de date d'arrêt affichée.
 *
 * À mettre à jour **à chaque relecture, même quand elle ne change rien** : c'est ce qui dit au
 * générateur que la table est courte parce que le BLS s'arrête là, et non parce qu'on a oublié.
 */
export const BLS_CHECKED_ON = '2026-09-01';

/** Une publication : le jour où elle sort, et le mois sur lequel elle porte. */
export interface BlsRelease {
  /** Jour de publication à New York, `AAAA-MM-JJ`. */
  day: string;
  /** Mois de référence des données publiées, `AAAA-MM`. */
  reference: string;
}

export interface BlsSeries {
  kind: EventKind;
  /** Libellé affiché, en français. */
  title: string;
  /** Nom officiel, conservé pour retrouver la ligne sur la page source. */
  officialName: string;
  tier: EventTier;
  /** Heure de publication à New York, constante pour la série, `HH:mm`. */
  easternTime: string;
  /** Page officielle du calendrier de cette série. */
  url: string;
  /** Publications, dans l'ordre chronologique. */
  releases: readonly BlsRelease[];
}

export const BLS_SERIES: readonly BlsSeries[] = [
  {
    kind: 'cpi',
    title: 'Inflation américaine (CPI)',
    officialName: 'Consumer Price Index',
    tier: 'major',
    easternTime: '08:30',
    url: 'https://www.bls.gov/schedule/news_release/cpi.htm',
    releases: [
      { day: '2026-01-13', reference: '2025-12' },
      { day: '2026-02-13', reference: '2026-01' },
      { day: '2026-03-11', reference: '2026-02' },
      { day: '2026-04-10', reference: '2026-03' },
      { day: '2026-05-12', reference: '2026-04' },
      { day: '2026-06-10', reference: '2026-05' },
      { day: '2026-07-14', reference: '2026-06' },
      { day: '2026-08-12', reference: '2026-07' },
      { day: '2026-09-11', reference: '2026-08' },
      { day: '2026-10-14', reference: '2026-09' },
      { day: '2026-11-10', reference: '2026-10' },
      { day: '2026-12-10', reference: '2026-11' },
    ],
  },
  {
    kind: 'employment',
    title: 'Emploi américain (rapport mensuel)',
    officialName: 'Employment Situation',
    tier: 'major',
    easternTime: '08:30',
    url: 'https://www.bls.gov/schedule/news_release/empsit.htm',
    releases: [
      { day: '2026-01-09', reference: '2025-12' },
      { day: '2026-02-11', reference: '2026-01' },
      { day: '2026-03-06', reference: '2026-02' },
      { day: '2026-04-03', reference: '2026-03' },
      { day: '2026-05-08', reference: '2026-04' },
      { day: '2026-06-05', reference: '2026-05' },
      { day: '2026-07-02', reference: '2026-06' },
      { day: '2026-08-07', reference: '2026-07' },
      { day: '2026-09-04', reference: '2026-08' },
      { day: '2026-10-02', reference: '2026-09' },
      { day: '2026-11-06', reference: '2026-10' },
      { day: '2026-12-04', reference: '2026-11' },
    ],
  },
  {
    kind: 'ppi',
    title: 'Prix à la production (PPI)',
    officialName: 'Producer Price Index',
    tier: 'secondary',
    easternTime: '08:30',
    url: 'https://www.bls.gov/schedule/news_release/ppi.htm',
    releases: [
      { day: '2026-01-14', reference: '2025-11' },
      { day: '2026-01-30', reference: '2025-12' },
      { day: '2026-02-27', reference: '2026-01' },
      { day: '2026-03-18', reference: '2026-02' },
      { day: '2026-04-14', reference: '2026-03' },
      { day: '2026-05-13', reference: '2026-04' },
      { day: '2026-06-11', reference: '2026-05' },
      { day: '2026-07-15', reference: '2026-06' },
      { day: '2026-08-13', reference: '2026-07' },
      { day: '2026-09-10', reference: '2026-08' },
      { day: '2026-10-15', reference: '2026-09' },
      { day: '2026-11-13', reference: '2026-10' },
      { day: '2026-12-15', reference: '2026-11' },
    ],
  },
  {
    kind: 'jolts',
    title: 'Postes vacants (JOLTS)',
    officialName: 'Job Openings and Labor Turnover Survey',
    tier: 'secondary',
    easternTime: '10:00',
    url: 'https://www.bls.gov/schedule/news_release/jolts.htm',
    releases: [
      { day: '2026-01-07', reference: '2025-11' },
      { day: '2026-02-05', reference: '2025-12' },
      { day: '2026-03-13', reference: '2026-01' },
      { day: '2026-03-31', reference: '2026-02' },
      { day: '2026-05-05', reference: '2026-03' },
      { day: '2026-06-02', reference: '2026-04' },
      { day: '2026-06-30', reference: '2026-05' },
      { day: '2026-08-04', reference: '2026-06' },
      { day: '2026-09-01', reference: '2026-07' },
      { day: '2026-09-29', reference: '2026-08' },
      { day: '2026-11-03', reference: '2026-09' },
      { day: '2026-12-01', reference: '2026-10' },
    ],
  },
];

/** Dernier jour couvert par la table, toutes séries confondues. Sert à la barrière de fraîcheur. */
export function blsCoverageEnd(): string {
  let last = '';
  for (const series of BLS_SERIES) {
    const release = series.releases[series.releases.length - 1];
    if (release && release.day > last) last = release.day;
  }
  return last;
}
