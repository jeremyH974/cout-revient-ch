# Contexte de marché — macro, flux et calendrier : étude sourcée et découpage

> Question traitée : « Ajouter une page de grands indicateurs qui pèsent sur la crypto (taux à 10
> ans américain, pétrole, VIX, Fear & Greed…), plus les flux ETF bitcoin, les flux institutionnels
> et les mouvements de whales, plus un calendrier des événements majeurs aux États-Unis (PCE,
> autres indices, discours de la Fed). Qu'en penser, que recommander, comment font les meilleurs, et
> comment être prêt pour le futur ? »

_Établie le 28/08/2026 à partir de quatre recherches en ligne parallèles menées ce jour (sources
macro, flux de capitaux crypto, calendrier officiel américain, état de l'art produit et cadre
réglementaire), complétées par cinq vérifications personnelles et un audit du code. Les faits sont
marqués **vérifié** (page officielle chargée ou en-tête HTTP constaté), **supposé** (consensus non
rechargé ce jour) ou **à vérifier** (source primaire inaccessible aux outils automatiques). Statut :
**proposition** — sauf le § 1, corrigé le jour même. Les numéros P47-P51 prolongent la numérotation
de [`docs/ROADMAP.md`](../ROADMAP.md)._

---

## 1. La panne trouvée d'abord (corrigée le 28/08/2026)

Avant d'ajouter la moindre source, il fallait constater que **la seule déjà branchée ne
fonctionnait pas**.

`fear-greed.ts` appelle `https://api.alternative.me/fng/`, mais cette origine ne figurait pas dans
le `connect-src` de la politique de sécurité, écrit à la main dans `vite.config.ts`. Sur le site
publié, le navigateur bloquait donc la requête. Trois mécanismes rendaient la panne **invisible** :

1. la CSP n'est injectée **qu'au build** — en développement, tout marchait ;
2. `loadFearGreed` avale toute erreur et rend `null`, par une décision volontaire qui rendait le
   contexte facultatif ;
3. `gateSatisfied` refuse de déclencher une alerte dont il ne peut pas vérifier la moitié des
   termes — donc **toute alerte conditionnée au sentiment de marché restait muette**, sans message
   ni voyant.

Aggravant : `scripts/api-contract.mjs` **surveillait** cette API et la déclarait verte, parce qu'il
l'interroge depuis Node, où aucune CSP ne s'applique. _Une surveillance qui n'exerce pas la
contrainte réelle ne surveille rien._

Corrigé, avec le garde-fou qui généralise le cas : `src/lib/support/csp.ts` porte la table des
origines et engendre la politique, `csp.test.ts` la croise avec les origines littérales du code
livré. Contacter une origine sans l'inscrire casse la CI ([`DECISIONS.md`](../DECISIONS.md) n° 57).
Vérifié par mutation : le test échoue en nommant le fichier fautif, et le build publie désormais 18
origines au lieu de 16.

**Leçon à retenir pour la suite de ce document : chaque source ajoutée est une dépendance à vie.
Le coût n'est pas l'écran, c'est la surveillance.**

---

## 2. Ce que l'app fait déjà

- Douze sources externes, une table d'attributions qui casse la CI si l'une est utilisée sans être
  créditée ([`sources.ts`](../../src/lib/support/sources.ts), décision n° 47).
- Un **opt-in réseau par fonction**, décoché par défaut, distinct pour les prix et pour le contexte.
- Un indice Fear & Greed déjà posé comme **du contexte, jamais un signal** (décision n° 44).
- Une doctrine de tableau de bord : un chiffre domine, une période gouverne l'écran, la couleur est
  réservée aux variances (décision n° 56).
- Un historique de patrimoine calculé localement ([`net-worth.ts`](../../src/lib/history/net-worth.ts)).

Rien de ce qui suit ne demande d'inventer une doctrine : tout consiste à **étendre celle-là**.

---

## 3. Le principe : les conditions d'utilisation choisissent l'architecture

### 3.1 Trois voies, une seule tenable par défaut

| Voie                                | Description                                                       | Verdict                                                                               |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **(a) Appel direct navigateur**     | Impose CORS ouvert, aucune clé, licence permissive                | Possible pour une minorité de sources                                                 |
| **(b) Instantané froid**            | Cron GitHub Actions → JSON normalisé committé → servi en `'self'` | **Voie par défaut**                                                                   |
| **(c) Proxy / fonction serverless** | Relais côté serveur                                               | **Refusé** — casse la promesse « aucun backend » et crée un journal des consultations |

Le CORS n'est que le symptôme le plus visible. Les vraies raisons de préférer (b) :

1. **Same-origin** → `connect-src 'self'`, la panne du § 1 devient structurellement impossible ;
2. **précachable par le service worker** → le contexte macro fonctionne **hors ligne**, ce qu'aucun
   service en ligne ne sait faire ;
3. **aucun tiers n'apprend quels indicateurs sont consultés** — cohérent avec le reste du projet ;
4. **testable** : un JSON figé est une fixture, donc les tests E2E peuvent comparer l'écran au
   moteur comme partout ailleurs ;
5. les clés restent des secrets GitHub, jamais dans le bundle.

Contrepartie assumée : fraîcheur J+1. Pour des séries **quotidiennes**, c'est sans effet — le taux
à 10 ans ne bouge pas entre deux `git push`.

### 3.2 Pourquoi FRED est disqualifié — et pourquoi c'est structurant

FRED semblait couvrir sept indicateurs sur huit avec une seule clé gratuite. Ses conditions
d'utilisation, durcies en juin 2024 [D1], **interdisent de « storing, caching, or archiving any
portion of FRED Content »** et de l'incorporer « in any database, compilation, archive, cache, or
other medium ». Committer un instantané JSON en CI, c'est exactement cela. S'ajoute que `SP500` et
`NASDAQCOM` y sont des séries **propriétaires S&P Dow Jones Indices** simplement relayées.

_(La page des CGU répond 403 aux outils automatiques ; la clause a été lue via la synthèse de
recherche et l'annonce officielle de mise à jour — **à relire dans un navigateur** avant toute
décision définitive.)_

**Conséquence heureuse** : la contrainte pousse vers les **émetteurs primaires**, qui sont tous du
domaine public américain (17 U.S.C. § 105), sans clé, sans quota, et qui ne disparaîtront pas.
C'est plus robuste que l'agrégateur, pas moins.

---

## 4. Les sources, vérifiées et datées

### 4.1 Macro

| Indicateur                     | Source primaire                                                                           | Clé      | Statut                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| 10 ans, 2 ans, spread 2s10s    | `home.treasury.gov/…/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=2026` | non      | **vérifié** [D2]                                                    |
| Taux réel 10 ans (TIPS)        | même flux, `data=daily_treasury_real_yield_curve`                                         | non      | supposé (même schéma)                                               |
| VIX                            | `cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv` (1990 → aujourd'hui)    | non      | **vérifié** [D3] ; CGU Cboe à lire                                  |
| WTI / Brent                    | API EIA v2                                                                                | gratuite | vérifié (inscription)                                               |
| RRP / repo                     | `markets.newyorkfed.org/api/rp/all/all/results/lastTwoWeeks.json`                         | non      | **vérifié** [D4]                                                    |
| Compte général du Trésor (TGA) | `api.fiscaldata.treasury.gov` (Daily Treasury Statement)                                  | non      | vérifié                                                             |
| M2, bilan Fed, dollar large    | Fed Data Download Program (H.6, H.4.1, H.10)                                              | non      | **à vérifier**                                                      |
| Fear & Greed crypto            | `api.alternative.me/fng/` — déjà en place                                                 | non      | **vérifié**, 60 req/10 min                                          |
| **DXY (ICE), MOVE**            | aucune source libre                                                                       | —        | → indice dollar large de la Fed **libellé comme proxy** ; MOVE omis |
| **Or**                         | aucune source primaire propre et gratuite                                                 | —        | → **renoncer au lancement**                                         |

### 4.2 Flux

| Besoin                                         | Réponse                                                                                                                         | Statut                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Flux ETF spot BTC/ETH quotidiens, par émetteur | **SoSoValue**, API officielle, tier gratuit, 20 req/min, CORS ouvert                                                            | **vérifié** (en-tête `Origin` reflété) |
| Flux institutionnels                           | **SEC EDGAR** (`data.sec.gov`), gratuit, domaine public — mais **événementiel**, pas un flux                                    | vérifié (`ACAO: *`)                    |
| Mouvements de whales nominatifs                | **aucune source gratuite et redistribuable.** Glassnode (~999 $/mois), CryptoQuant, Whale Alert, Arkham : payants et CORS fermé | vérifié                                |
| Capital entrant, proxy honnête                 | **DefiLlama stablecoins** (`stablecoins.llama.fi`), mint/burn net par chaîne, gratuit                                           | **vérifié** (`ACAO: *`)                |
| Farside, CoinGlass                             | **à exclure** : pas d'API publique, « all rights reserved », CORS fermé                                                         | vérifié                                |

**Piège technique à retenir** : la SEC exige un en-tête `User-Agent` nominatif, or `User-Agent` est
un **en-tête interdit** en `fetch()` navigateur — le code ne peut pas le poser. EDGAR doit donc
passer par la voie (b), sans exception.

### 4.3 Calendrier — le volet le plus propre

| Source                         | Format                                                           | Statut                                 |
| ------------------------------ | ---------------------------------------------------------------- | -------------------------------------- |
| **BEA** (PCE, PIB)             | `apps.bea.gov/API/signup/release_dates.json` — **JSON direct**   | **vérifié**                            |
| **FOMC**                       | HTML officiel, publié 12-18 mois à l'avance ; 2027 déjà en ligne | **vérifié**                            |
| **Discours Fed**               | `feeds.federalreserve.gov`, flux RSS dont un **par gouverneur**  | **vérifié**                            |
| **BLS** (CPI, NFP, PPI, JOLTS) | calendrier annuel figé, publié en bloc ; 8 h 30 ET systématique  | vérifié indirectement (403 anti-robot) |
| **Treasury** (adjudications)   | `api.fiscaldata.treasury.gov`                                    | vérifié                                |

Réunions FOMC restantes en 2026 (**vérifié**) : **15-16 septembre** (projections), **27-28 octobre**,
**8-9 décembre** (projections). Communiqué à 14 h ET, minutes à J+3 semaines.

Deux limites à **afficher** plutôt qu'à masquer :

- **Le consensus n'existe pas gratuitement.** Il est propriétaire partout (Econoday, Bloomberg,
  Trading Economics). N'afficher que _précédent_ et _réalisé_ est plus honnête qu'un chiffre non
  licencié — ou qu'un « consensus maison » qui n'en serait pas un.
- **ISM, Conference Board, U. Michigan** : la **date** de publication est un fait libre, la
  **valeur** est sous copyright. Afficher la date, pas la valeur.

### 4.4 Ce à quoi il faut renoncer, et le dire

Whale tracking nominatif · consensus de marché · primes et décotes ETF (aucune source combinée) ·
DXY d'ICE · MOVE · or · temps réel (les données sont quotidiennes).

Renoncer explicitement vaut mieux qu'un proxy médiocre présenté comme la chose : _un chiffre faux
est pire qu'un chiffre absent_ — la règle que le projet applique déjà aux identifiants CoinGecko
ambigus.

---

## 5. Ce que font les meilleurs, et ce qu'il faut en retenir

1. **Jamais une valeur brute seule.** Glassnode et Checkonchain accompagnent systématiquement chaque
   chiffre de son **rang historique** — percentile sur 1 et 5 ans, ou z-score sur fenêtre glissante
   de 2-3 ans [D5][D6]. « VIX à 18 » ne dit rien ; « VIX à 18, 34ᵉ percentile sur 5 ans » dit tout.
2. **Le macro n'est jamais l'écran d'accueil.** Chez Checkonchain c'est le quatrième et dernier
   niveau de profondeur. La Vue d'ensemble ne doit pas bouger.
3. **Une corrélation à fenêtre unique est trompeuse par construction.** BTC / M2 : Pearson 0,94 en
   tendance longue, mais la corrélation glissante à 180 jours oscille entre **+0,95 et −0,90** [D7].
   BTC / S&P 500 : ≈ 0,2 en rendements quotidiens sur dix ans, mais pic à 0,88 en moyenne 20 jours
   début 2025. → afficher **trois fenêtres (30 / 90 / 180 j)**, ou afficher la variabilité
   elle-même. C'est ce qui transforme l'écran d'« affirmation » en « constat ».
4. **Le flux ETF net quotidien est le piège classique.** La rotation GBTC (−21 Md$) vers ses
   concurrents a fait paraître des sorties massives alors que la cohorte encaissait +36 Md$ net sur
   l'année [D8]. → toujours **brut par émetteur + cumulé**, jamais le seul titre du jour.
5. **Fraîcheur par widget, pas globale** : les sources n'ont pas la même cadence. Horodatage
   explicite, et erreur honnête (« indisponible depuis 09 h 15 ») plutôt qu'un échec silencieux —
   c'est précisément ce qui a manqué au § 1.

Et le fait qui doit gouverner tout le ton de la page : **au sommet d'octobre 2025 (126 198 $), aucun
indicateur on-chain classique n'a signalé quoi que ce soit** — ni MVRV, ni NUPL, ni Pi Cycle [D9].
L'ère post-ETF a cassé les repères. Une page qui prétendrait _lire_ le marché serait démentie par
les faits ; une page qui donne du **contexte daté** reste vraie.

---

## 6. La ligne rouge : information, jamais conseil

La position **AMF DOC-2008-23** (mise à jour du 13/02/2024) [D10] pose trois conditions
**cumulatives** au conseil en investissement : (1) adressé à une personne en sa qualité
d'investisseur, (2) **contenu prescriptif** (acheter / vendre / conserver), (3) fondé sur sa
situation propre. Les outils et simulateurs sans recommandation ciblée sont **explicitement
exemptés**. Le règlement délégué MAR 2016/958 confirme que les analyses portant sur des **variables
macroéconomiques** ne sont pas des recommandations d'investissement.

C'est la condition (2) qui est décisive. D'où quatre règles de conception :

- **aucun verbe prescriptif**, aucun score composite « risk-on / accumulation », aucun objectif de
  cours ;
- pas de « X est sous-évalué » — c'est un objectif de cours implicite ;
- **le disclaimer ne protège pas ; c'est la substance qui protège** ;
- superposer **sa propre courbe de patrimoine** à une série macro reste **descriptif**, donc hors
  champ, et c'est le seul avantage que ce projet a sur tous les services en ligne : personne
  d'autre ne peut le faire sans recevoir les données de l'utilisateur.

**À confirmer avant rédaction des mentions légales** : la définition exacte du conseil au sens
**MiCA, art. 3 et 81** (périmètre plus large que le conseil en investissement classique) n'a pas pu
être relue sur le texte officiel ce jour.

---

## 7. Les garde-fous à poser avant les écrans

| Garde-fou                                                        | Pourquoi                                                                                                                                                                                                                    | État               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Test de contrat CSP ↔ origines                                   | Sans lui, chaque source ajoutée est une roulette russe                                                                                                                                                                      | **fait** (§ 1)     |
| Étendre `DATA_SOURCES`                                           | Le mécanisme existe et casse déjà la CI (décision n° 47)                                                                                                                                                                    | à faire par brique |
| Contrat `asOf` / `staleAfter` par indicateur                     | Badge de fraîcheur par widget ; jamais un chiffre sans sa date                                                                                                                                                              | à faire            |
| Étendre `api-contract.mjs` **et** ajouter un contrôle navigateur | Le contrôle Node seul a déjà menti une fois                                                                                                                                                                                 | à faire            |
| Décision écrite : _les indicateurs macro sont des `number`_      | La règle « aucun `number` ne porte un montant » protège l'arithmétique du PRU ; un VIX n'entre jamais dans un PRU. Sans décision explicite, un contributeur futur hésitera — ou fera entrer `Big` là où il n'a rien à faire | à écrire           |

---

## 8. Les briques proposées

Une **seule page**, trois sections (`Régime` / `Flux` / `Calendrier`) : elles répondent à une seule
question, et trois écrans clairsemés sur mobile seraient pires qu'un.

### P47 — Calendrier macro américain (≈ 2 sessions)

JSON engendré en CI depuis BEA, FOMC, BLS et Treasury ; précaché, **consultable hors ligne** ;
30 jours à venir et historique ; heures converties en Europe/Paris avec la mention du fuseau
d'origine. Aucune clé payante, aucun risque de licence, se périme en douze mois.
**À faire en premier** : meilleur rapport valeur / fragilité de tout le lot.

### P48 — Indicateurs macro (≈ 3 sessions)

Instantané froid CI sur sources primaires (§ 4.1). Pour chaque indicateur : valeur, **percentile
1 an et 5 ans**, sparkline 90 jours, date. Ordre d'affichage par pouvoir explicatif : liquidité →
taux réel 10 ans → dollar → VIX → pétrole. Fear & Greed en fin de section, tel qu'il est déjà traité.

### P49 — Flux (≈ 2 sessions)

Stablecoins DefiLlama en appel direct ; ETF spot via SoSoValue en CI, affichés **bruts par émetteur
et cumulés**, jamais en net quotidien seul. Section explicitement incomplète, et qui le dit.

### P50 — Lecture croisée (≈ 2 sessions)

Corrélations glissantes 30 / 90 / 180 jours entre BTC et chaque indicateur, et **superposition de la
courbe de patrimoine personnelle**, calculée localement. C'est la signature de la page : elle ne
raconte pas ce que le marché fait, elle montre si l'indicateur explique quoi que ce soit — et sur
_vos_ chiffres.

### P51 — Surveillance des nouvelles sources (≈ 1 session)

Contrats d'API étendus, contrôle navigateur, badges de fraîcheur. À livrer **avec** P48, pas après.

---

## 9. Ce qui reste exclu

Backend ou proxy · scraping de Farside et CoinGlass · whale tracking nominatif · consensus de marché
· données temps réel · tout score composite ou lecture directionnelle · toute personnalisation
prescriptive selon le portefeuille.

---

## 10. Décisions attendues du propriétaire

1. **Confirmer l'ordre** P47 → P48 → P51 → P49 → P50, qui commence par le plus solide et non par le
   plus spectaculaire.
2. **Accepter la voie (b)** : un cron GitHub Actions committant un instantané dans le dépôt. C'est
   un changement de nature — le dépôt se met à contenir de la donnée de marché, versionnée.
3. **Trancher sur les clés** : EIA et SoSoValue exigent une inscription gratuite, à stocker en
   secrets GitHub.
4. **Relire deux textes** avant mise en production : les CGU FRED (si l'on veut malgré tout s'en
   servir) et l'article 81 de MiCA.

---

## Sources (consultées le 28/08/2026)

- [D1] FRED, Terms of Use et annonce de mise à jour (juin 2024) —
  <https://fred.stlouisfed.org/docs/api/terms_of_use.html> ;
  <https://news.research.stlouisfed.org/2024/06/weve-updated-our-terms-of-use-action-requested/>
- [D2] U.S. Treasury, Daily Interest Rate XML Feed —
  <https://home.treasury.gov/treasury-daily-interest-rate-xml-feed>
- [D3] Cboe, Historical Data for VIX Index —
  <https://www.cboe.com/tradable-products/vix/vix-historical-data>
- [D4] Federal Reserve Bank of New York, Markets Data APIs —
  <https://markets.newyorkfed.org/static/docs/markets-api.html>
- [D5] Glassnode, Indicators API (z-score, percentile bands) —
  <https://docs.glassnode.com/basic-api/endpoints/indicators>
- [D6] Checkonchain, hiérarchie des métriques — <https://charts.checkonchain.com/>
- [D7] Relation BTC / M2 mondial et instabilité de la corrélation glissante —
  <https://cryptoslate.com/bitcoins-has-an-elastic-relationship-with-global-m2-money-supply-shifted-by-90-days/>
- [D8] Flux ETF nets trompeurs (rotation GBTC) —
  <https://cryptoslate.com/bitcoin-etf-record-outflows-are-deceptive-as-crypto-products-absorbed-46-7-billion-in-2025/>
- [D9] 21Shares, sommet d'octobre 2025 sans signal on-chain —
  <https://www.21shares.com/en-us/research/newsletter-issue-256>
- [D10] AMF, position DOC-2008-23, conseil en investissement (MAJ 13/02/2024) —
  <https://www.amf-france.org/sites/institutionnel/files/doctrine/fr/Position/DOC-2008-23/3.0/Questions-reponses%20sur%20la%20notion%20du%20service%20d%27investissement%20de%20conseil%20en%20investissement.pdf>
- [D11] UX des tableaux de bord temps réel (fraîcheur, données manquantes), septembre 2025 —
  <https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/>
