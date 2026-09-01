# Le calendrier macroéconomique — ce qu'il sait, et comment l'entretenir

L'écran « Contexte de marché » (`#/market`, dans le menu « Plus ») affiche les dates de publication
américaines qui font bouger les marchés. Il ne commente rien, ne recommande rien et ne connaît pas
votre portefeuille. Le raisonnement complet est dans [`DECISIONS.md`](DECISIONS.md) n° 58 ; ce
document est le mode d'emploi.

## Ce qu'il contient

| Publication                | Source | Heure de New York | Rang       |
| -------------------------- | ------ | ----------------- | ---------- |
| Décision de la Fed (FOMC)  | Fed    | 14 h 00           | majeure    |
| Inflation CPI              | BLS    | 8 h 30            | majeure    |
| Emploi (rapport mensuel)   | BLS    | 8 h 30            | majeure    |
| Inflation PCE et revenus   | BEA    | 8 h 30            | majeure    |
| PIB                        | BEA    | 8 h 30            | majeure    |
| Prix à la production (PPI) | BLS    | 8 h 30            | secondaire |
| Postes vacants (JOLTS)     | BLS    | 10 h 00           | secondaire |

Le rang est un **choix de rédaction**, pas une mesure : aucune volatilité n'a été calculée pour
l'établir, et l'écran l'annonce.

## Ce qu'il ne contient pas, et pourquoi

- **Les minutes du FOMC.** La Fed les publie trois semaines après la réunion, mais n'en annonce la
  date qu'une fois la réunion tenue. La déduire de sa règle serait une prévision présentée comme un
  fait.
- **Le consensus de marché.** Propriétaire chez tous les fournisseurs (Econoday, Bloomberg, Trading
  Economics). Aucune source gratuite et licite n'a été trouvée.
- **Les valeurs de l'ISM, du Conference Board et de l'Université du Michigan.** Leur **date** de
  publication est un fait public, librement republiable ; leur **valeur** est sous copyright.
- **Les adjudications du Trésor.** Quotidiennes et sans intérêt pour qui suit la crypto ; les
  annonces de refinancement trimestriel mériteraient leur propre traitement.
- **Les discours des membres de la Fed.** Les flux RSS officiels publient les discours **après**
  qu'ils ont eu lieu ; un calendrier prévisionnel des interventions individuelles n'existe que chez
  les agrégateurs commerciaux.

## Comment il est fabriqué

```bash
npm run calendar
```

Le script [`scripts/generate-calendar.ts`](../scripts/generate-calendar.ts) interroge la Fed et le
BEA, y ajoute la table BLS tenue à la main, et écrit
[`src/lib/calendar/events.generated.ts`](../src/lib/calendar/events.generated.ts) — un module
TypeScript **committé** et compilé dans l'application. D'où l'absence totale de requête à
l'exécution, et le fonctionnement hors ligne.

Il **refuse d'écrire** si une source est muette ou si le nombre d'événements s'effondre. Il ne
réécrit rien si seuls les horodatages changent, pour que le diff reste relisible — ce qui suppose
que sa sortie soit déjà au format de Prettier, d'où le passage par `prettify()` avant comparaison.

Le cron [`.github/workflows/market-data.yml`](../.github/workflows/market-data.yml) le lance chaque
lundi et chaque vendredi, lance `npm run check` **avant** de committer, puis appelle `ci.yml` — un
push effectué par le robot ne déclenche aucun workflow, et c'est la CI qui publie sur Pages.

### La barrière du BLS a deux étages, et c'est important

Une couverture qui raccourcit recouvre **deux situations opposées**, et les confondre revient à
crier au loup :

| État                             | Cause                          | Ce qu'un humain peut faire | Réponse                  |
| -------------------------------- | ------------------------------ | -------------------------- | ------------------------ |
| Notre copie est en retard        | personne n'a relu les pages    | recopier                   | refuser d'écrire + issue |
| **La source elle-même s'arrête** | le BLS n'a pas publié la suite | rien, sinon revenir voir   | écrire + poser un rappel |

Rien dans le dépôt ne permet de distinguer les deux — seule une relecture le peut. C'est pourquoi
`BLS_CHECKED_ON` porte une **affirmation** et pas seulement une date : « à ce jour, tout ce que le
BLS publiait était recopié ». La barrière s'appuie dessus :

- couverture sous **six mois** → **avertissement**, le calendrier est écrit et le cron ouvre un
  rappel (`[données de marché] Le calendrier du BLS attend la suite`), qui se referme tout seul ;
- couverture sous **trois mois** _et_ relecture vieille de plus de **45 jours** → **blocage**, et
  l'issue d'échec habituelle.

D'où la règle : **mettre `BLS_CHECKED_ON` à jour à chaque relecture, même quand elle ne change
rien**. C'est cette date qui dit au générateur que la table est courte parce que la source s'arrête,
et non parce qu'on a oublié.

## Entretien annuel : la table du BLS

C'est la **seule** intervention manuelle, et elle revient une fois par an.

`www.bls.gov` répond **403 à tout client qui n'est pas un navigateur** — y compris sur le flux
`bls.ics` qu'il publie pourtant pour les agendas. Se faire passer pour un navigateur contournerait
un contrôle d'accès délibéré ; les dates sont donc recopiées à la main.

Vous n'avez pas à y penser : quand la couverture descend sous six mois, le cron **ouvre un rappel**
étiqueté `données de marché`, avec les quatre URL en liste à cocher. Il se referme de lui-même dès
que la table repasse au-dessus. Rien n'est cassé pendant ce temps : le calendrier continue d'être
régénéré et publié.

La marche à suivre :

1. Ouvrir dans un navigateur les quatre pages listées dans
   [`src/lib/calendar/bls-schedule.ts`](../src/lib/calendar/bls-schedule.ts) — CPI, emploi, PPI,
   JOLTS. Le BLS publie l'année suivante en bloc, à l'automne de l'année en cours.
2. Recopier les couples _mois de référence → jour de publication_ dans `BLS_SERIES`, en conservant
   l'ordre chronologique. **S'il n'y a rien de nouveau, c'est une réponse valable** : passez à
   l'étape suivante.
3. Mettre `BLS_CHECKED_ON` à la date du jour — **même si rien n'a changé**. C'est l'étape qui compte
   le plus : sans elle, la barrière finira par bloquer un dépôt pourtant à jour.
4. `npm run check` : `bls-schedule.test.ts` vérifie l'ordre, les doublons, les jours ouvrés, et
   qu'aucune publication ne précède son propre mois de référence — une inversion de lignes est
   attrapée, une simple transposition de chiffres ne l'est pas.
5. `npm run calendar`, puis commit.

## Les heures

Un événement macro est un **instant**, pas une date naïve : « 8 h 30 à New York » se convertit en
UTC à la génération, par le fuseau IANA `America/New_York`. C'est l'inverse de la règle appliquée
aux dates Coinhouse, qui n'ont pas de fuseau et ne doivent jamais être converties.

La conversion est vérifiée par un **oracle indépendant** : le BEA publie ses dates déjà en UTC
quand le BLS et la Fed les publient en heure locale. Les tests reconvertissent chaque instant du
BEA en heure de New York, le repassent dans le convertisseur, et exigent l'instant d'origine — sur
des couples certifiés par une agence fédérale, couvrant les deux régimes d'heure d'été.

Conséquence visible : les États-Unis et l'Europe ne changent pas d'heure le même week-end. Une
réunion de la Fed s'affiche à 20 h à Paris en septembre, et à 19 h fin octobre.
