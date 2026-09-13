# État de l'art contre la 2.17.0 — le produit est mûr, c'est le jour de la déclaration qui ne l'est pas

> Question traitée : « Comment améliorer l'outil ? Benchmark, besoins, douleurs, retours d'expérience.
> Viser l'état de l'art et la préparation au futur. Propositions classées par ROI, dans l'ordre
> d'exécution, expliquées à un commanditaire non développeur. »

_Établi le 13/09/2026 contre `main` à la **2.17.0** (106 705 lignes dans `src/`, 205 fichiers de tests
unitaires, 35 parcours E2E, 140 décisions). Les faits sont marqués **vérifié** (remesuré par moi dans
le dépôt ce jour, référence de fichier donnée) ou **sourcé** (recherche en ligne, URL et date en
§ 8). Méthode : quatre agents de recherche bornés menés en parallèle — concurrence, fiscalité
française, audit interne, socle technique — puis vérification par moi des affirmations décisives,
qui en a corrigé trois. Propositions numérotées **P105-P114** : P104 était le dernier numéro pris
(étude du 06/09/2026). Statut : **proposition**._

---

## 1. Pourquoi cette étude est différente des deux précédentes

C'est le troisième exercice de ce type sur ce dépôt : l'étude fondatrice du 23/08/2026, puis le
réaudit du 01/09/2026 contre la 2.15.0, dont **toutes** les propositions (P75-P95) sont closes au
02/09. Entre-temps, neuf briques de plus ont été livrées (P96-P104 : prêts, actions et ETF eToro,
fiscalité des titres, dividendes, intérêts de trésorerie).

Conséquence : **il ne reste aucun manque de fonctionnalité évident à aller chercher.** Une liste de
plus du type « ajoutez un graphique de répartition » serait du remplissage. Les trois manques réels
que cette étude retient se ressemblent, et aucun n'est une fonctionnalité absente :

1. L'outil est excellent onze mois par an et **faux le douzième** — celui où l'on déclare.
2. Sa table de veille réglementaire **affirme du droit périmé**, sur le seul changement de 2026 qui
   concerne l'utilisateur.
3. Les chiffres sont justes mais **dispersés** : cinq moteurs fiscaux, aucun total.

## 2. Le constat central : le Rapport ne sait pas de quelle année il parle

**Vérifié.** [`src/routes/invest/Report.svelte`](../../src/routes/invest/Report.svelte) dérive
l'année fiscale de `generatedAt`, c'est-à-dire de **l'instant où le rapport est produit** :

| Ligne | Ce qui est calculé          | Année utilisée                             |
| ----- | --------------------------- | ------------------------------------------ |
| 54    | Récapitulatif DAC8          | `Number(generatedAt.slice(0, 4))`          |
| 68    | Comptes à déclarer 3916-bis | `Number(generatedAt.slice(0, 4))`          |
| 86    | Constats fiscaux            | `taxYear: Number(generatedAt.slice(0, 4))` |
| 138   | Export « Cessions 2086 »    | `cessionsToCsv(tax)` — **aucune année**    |

Un même identifiant porte donc deux notions qui n'ont rien à voir : _quand ce rapport a été produit_
et _quelle année il décrit_. Les conséquences sont concrètes :

- **Au printemps 2027, quand l'utilisateur déclarera 2026**, l'écran lui montrera le récapitulatif
  DAC8 et les comptes à déclarer de **2027** — trois mois de données, la mauvaise année.
- **L'export « Cessions au format 2086 » déverse toutes les années à la fois**, alors que
  [`cessionsToCsv`](../../src/lib/export/csv-export.ts) accepte déjà un paramètre `year` que
  personne ne lui passe. Or le 2086 se remplit **pour une année**.

Ce n'est pas un calcul faux : c'est un calcul juste sur la mauvaise période, ce qui est plus
difficile à repérer. Rien dans l'écran ne nomme l'année retenue.

**Ce qui n'est pas en cause**, et qu'il ne faut donc pas « réparer » : la section fiscale du rapport
affiche déjà les **trois années les plus récentes** en lignes de tableau
([`report-model.ts:763`](../../src/lib/export/report-model.ts), sur `tax.years` trié décroissant —
vérifié), exactement comme l'écran Actions et ETF ([`Titles.svelte:177`](../../src/routes/invest/Titles.svelte)).
Le motif maison est bien « une ligne par année », et il fonctionne. Le défaut est cantonné aux trois
objets qui **ne peuvent porter qu'une seule année** : le DAC8, le 3916-bis et l'annexe 2086.

## 3. La veille a pris du retard sur le changement qui compte

**Vérifié.** [`src/lib/watch/entries.ts:386`](../../src/lib/watch/entries.ts) décrit l'option pour le
barème progressif comme « alternative globale et annuelle au prélèvement forfaitaire, sur option
expresse », sourcée sur une version historique de l'article 200 A du CGI, `reviewedOn: '2026-08-29'`.

**Sourcé.** La loi de finances pour 2026 a **supprimé le caractère irrévocable** de cette option
[S1] [S2] : le choix se refait chaque année, et se corrige après coup — jusqu'au 31/12/2029 pour les
revenus 2026.

La ligne n'est donc pas seulement incomplète : elle décrit un droit qui n'existe plus. Un écran qui
affirme du droit périmé est **pire qu'un écran absent**, parce qu'il inspire une confiance qu'il ne
mérite pas.

### La limite du dispositif, qu'il faut nommer

`docs/veille-reglementaire.md` décrit une barrière de fraîcheur qui fait échouer `npm run check` dès
qu'une entrée n'a pas été relue depuis trois ou six mois. Elle a fonctionné : la ligne n'était pas
périmée au sens de la barrière. **Mais la barrière vérifie une date, pas une lecture.** `reviewedOn`
prouve qu'on a coché une case, jamais qu'on a rouvert le texte.

Aucun test ne peut combler cet écart — « le droit a-t-il changé ? » n'est pas une assertion
mécanisable. La seule réponse honnête est de **l'écrire dans la documentation** au lieu de laisser
croire que le vert de la CI vaut relecture. C'est la même famille que la limite déjà reconnue par la
décision n° 90 : le dispositif adosse la documentation au code, mais l'état d'une proposition n'est
vérifiable par aucun test.

## 4. Cinq moteurs fiscaux, aucun total

**Vérifié.** Le dépôt porte cinq modules fiscaux indépendants, chacun rendu sur son propre écran :

| Module                         | Objet                           | Écran          |
| ------------------------------ | ------------------------------- | -------------- |
| `domain/tax-fr.ts`             | Plus-values crypto (150 VH bis) | Rapport        |
| `domain/equity-tax-fr.ts`      | Plus-values titres (150-0 D)    | Actions et ETF |
| `domain/equity-income-fr.ts`   | Dividendes, crédit d'impôt      | Actions et ETF |
| `domain/interest-income-fr.ts` | Intérêts de trésorerie (2TR)    | Actions et ETF |
| `domain/lending/tax-fr.ts`     | Prêts participatifs (125-00 A)  | Prêts          |

Chacun est juste. Aucun ne connaît les autres. Or **deux décisions ne se prennent que sur le total** :

- le **report case par case** au moment de remplir (P107) ;
- l'**arbitrage entre le prélèvement forfaitaire et le barème** (P108), qui porte sur l'ensemble des
  revenus de capitaux mobiliers — et qui vient précisément de redevenir une décision réversible (§ 3).

## 5. Ce que le benchmark change, et ce qu'il ne change pas

**Sourcé.** Dix outils comparables relevés [S6] à [S9] : Waltio (39-249 €), Koinly (49-179 €),
CoinTracking (49-899 $), Blockpit, Divly (39-299 €), Recap, CoinTracker, Kryptos, Awaken (99-599 $),
Rotki (seul local et open source). Deux enseignements utiles, et un seul manque réel.

**L'argument local-first n'est plus théorique.** En janvier 2026, Waltio — le leader français, en
ligne — a subi une fuite touchant environ 50 000 utilisateurs : adresses e-mail et soldes crypto
agrégés issus des rapports fiscaux, tentative d'extorsion, enquête ouverte [S10] [S11]. Le choix
« rien ne quitte le navigateur » cesse d'être une préférence de conception pour devenir un fait
démontré. La page Confidentialité peut le dire.

**Ne jamais retirer une fonction déjà gratuite.** Le palier gratuit de Waltio a perdu la génération
du 2086 en 2026 [S12]. C'est exactement la promesse qu'un outil personnel et gratuit peut tenir sans
effort — à condition de ne jamais la rompre.

**Le seul manque réel face à eux** est le report case par case (P107). Tout le reste de leur avance
est hors de portée et doit le rester : 700 à 1 000 connecteurs, DeFi et NFT à grande échelle,
support humain. Au passage, **la douleur n° 1 du secteur** — un transfert entre plateformes compté à
tort comme une cession, mécanisme chiffré à +944 % de plus-values fantômes dans une étude américaine
de 2026 [S13] — est **déjà traitée ici** : [`domain/transfers.ts`](../../src/lib/domain/transfers.ts)
apparie les virements internes et reporte le coût, avec son test (vérifié).

## 6. Le socle technique : trois gestes, et une longue liste de choses à ne pas faire

**Vérifié.** Trois écarts réels, tous mineurs pris isolément :

- **Aucun Web Worker** dans `src/` : la lecture du fichier et le calcul tournent sur le fil qui
  dessine l'écran. Le moteur est pourtant déjà pur et sans DOM. Le point de rupture mesuré (décisions
  n° 85 et 87) est à ~2 500 cessions : c'est de la robustesse pour plus tard, pas une urgence.
- **Les seuils de couverture surveillent le mauvais coffre** ([`vite.config.ts:225`](../../vite.config.ts)) :
  `src/lib/derive` porte l'exigence la plus haute (95 %) sur **166 lignes en 3 fichiers**, `src/state`
  un plancher symbolique de 2 %, et les **~21 000 lignes de `.svelte`** ne sont mesurées par rien.
- **Deux dérivations de clé pour le même secret** : le coffre utilise Argon2id
  ([`vault.ts`](../../src/lib/storage/vault.ts)), la sauvegarde exportée PBKDF2 à 600 000 itérations
  ([`encryption.ts`](../../src/lib/storage/encryption.ts)). Ce n'est **pas une faille** — PBKDF2-600k
  reste conforme aux recommandations OWASP — c'est une incohérence.

Le signal qui donne son poids au deuxième point : les cinq dernières corrections de chiffres
(décisions n° 130, 135, 136, 137, 140) étaient toutes des **chiffres silencieusement faux**, aucune
n'a levé d'erreur, et toutes se situaient dans la zone la plus récente — Trading, Titres, Prêts —
c'est-à-dire la moins mesurée.

**Sourcé, et à ne pas faire** (§ 7). L'essentiel de l'état de l'art 2026 confirme les choix déjà
pris : Trusted Types est Baseline depuis février 2026 et déjà en place [S14] ; les seuils Core Web
Vitals sont inchangés [S15] ; le `Decimal` natif de JavaScript est encore au stade 1 sur 4 [S16] ;
WCAG 3.0 reste un Working Draft [S17] ; les `remote functions` de Svelte restent expérimentales
[S18].

## 7. Les propositions

Barème maison : Valeur (chiffres plus justes ou plus utiles), Fiabilité (risque évité), Satisfaction
(plaisir d'usage), chacun sur 5. Effort en sessions (≈ 2-3 h, tests et vérification compris).
ROI = (V + F + S) ÷ sessions.

| #        | Proposition                                      | Valeur | Fiabilité | Satisf. | Sessions |   ROI   |
| -------- | ------------------------------------------------ | :----: | :-------: | :-----: | :------: | :-----: |
| **P105** | L'année fiscale se choisit dans le Rapport       |   5    |     4     |    3    |   0,5    | **24**  |
| **P112** | Conserver dix ans, pas trois                     |   2    |     3     |    1    |   0,25   | **24**  |
| **P106** | Relire la veille — la ligne « barème » d'abord   |   4    |     5     |    1    |   0,5    | **20**  |
| **P109** | Le coffre proposé, pas caché                     |   3    |     4     |    2    |   0,5    | **18**  |
| **P113** | Une sauvegarde qui existe aussi hors Chrome      |   3    |     5     |    2    |    1     | **10**  |
| **P107** | Le récapitulatif de déclaration, case par case   |   5    |     4     |    5    |    2     |  **7**  |
| **P111** | Mesurer la fiabilité là où elle manque           |   1    |     5     |    0    |    1     |  **6**  |
| **P110** | Le calcul hors du fil qui dessine l'écran        |   2    |     2     |    4    |   1,5    | **5,3** |
| **P108** | L'arbitrage PFU / barème, chiffré                |   5    |     3     |    5    |   2,5    | **5,2** |
| **P114** | Aligner le chiffrement de la sauvegarde exportée |   0    |     2     |    0    |   0,5    |  **4**  |

Total : **≈ 9,75 sessions**.

L'ordre d'exécution n'est pas celui du ROI brut. Il tient compte de l'échéance (P105 et P112 servent
au printemps 2027), d'une dépendance (P106 conditionne P108 : sans la ligne corrigée, l'arbitrage
n'a pas de fondement à citer) et d'un prérequis de confiance (P111 avant P107 : avant d'écrire
« recopiez ce montant dans votre déclaration », mieux vaut mesurer la zone qui a produit cinq
chiffres faux en deux semaines).

**Ordre retenu** : P105 → P112 → P106 → P109 → P113 → P111 → P107 → P108 → P110 → P114.

### Ce qui n'est pas recommandé

Cette section existe pour éviter d'y revenir à chaque revue.

- **DeFi et NFT à grande échelle** — terrain d'Awaken (1 500 protocoles, 80 chaînes) [S9]. Hors de
  portée d'un outil local. La spécialisation Coinhouse / eToro est la force, pas la limite.
- **IA locale dans le navigateur** (WebLLM, Gemini Nano) — exige plus de 4 Go de VRAM et 22 Go de
  disque au premier usage [S19]. Le pipeline IA existant (clé en mémoire seule, consentement par
  charge utile, sortie ancrée aux chiffres réels) offre les mêmes garanties sans ce poids.
- **Synchronisation multi-appareils (CRDT)** — mono-utilisateur, mono-machine : rien à synchroniser.
  Déjà écarté par la feuille de route du 23/08.
- **Quitter big.js** — le `Decimal` de TC39 est au stade 1 [S16] ; `decimal.js` n'apporterait rien.
- **Les nouveautés Svelte** (`remote functions`, `await` libre dans les composants) — encore
  étiquetées expérimentales en juin 2026 [S18].
- **Anticiper l'« impôt sur la fortune improductive »** — l'amendement qui visait les actifs
  numériques a été **écarté** du texte définitif de la LF2026 [S20]. La ligne `dropped` de la table
  de veille est déjà là ; il n'y a rien à construire.
- **Version anglaise** — le public est un Discord francophone. À rouvrir si la demande apparaît.

### Ce qui demande une décision du propriétaire

1. **P107 et P108 touchent au fiscal.** La feuille de route prévoyait déjà une relecture par un
   professionnel avant publication du mode fiscal (P13, § 6 de `ROADMAP.md`). Elle est maintenue.
2. **La case 8PL du formulaire 2047** (crédit d'impôt sur dividendes étrangers) est signalée comme
   nouvelle en 2026 par une **seule source secondaire**, non recoupée sur la notice officielle. À
   confirmer avant toute inscription dans la veille ou dans un écran.
3. **Le CARF** — le projet de loi de ratification a été présenté en Conseil des ministres le
   27/07/2026 mais **n'a pas été voté**. La ligne de veille doit le dire ainsi, pas autrement.

## 8. Limites de cette étude

- L'agent chargé du benchmark a eu un **accès limité aux fils Reddit** : la liste des douleurs
  utilisateurs s'appuie davantage sur la presse spécialisée, Trustpilot et les comparatifs que sur
  des témoignages bruts. À pondérer en conséquence.
- L'audit interne a rapporté **deux affirmations fausses**, corrigées par lecture du code avant
  d'entrer ici : le chiffrement du coffre **existe bien** sur le site public
  ([`Settings.svelte:496`](../../src/routes/Settings.svelte) rend `VaultSection` hors de tout garde
  `__PRIVATE_BUILD__`) — il est seulement éteint par défaut, d'où P109 ; et la **sauvegarde
  automatique existe** ([`backup-folder.ts`](../../src/lib/storage/backup-folder.ts)) — elle est
  seulement limitée aux navigateurs qui implémentent File System Access, d'où P113. C'est la raison
  d'être de la vérification par relecture : deux propositions auraient été surdimensionnées.
- La **date d'entrée en vigueur du taux de 31,4 % pour les cessions d'actifs numériques** (cessions
  2026 ou revenus 2025) n'a pas pu être tranchée sur source primaire pendant cette étude ; P106
  reprend le point.

## Sources

Consultées le 13/09/2026 sauf mention contraire.

- [S1] Vademecum Patrimoine, « Loi de finances pour 2026 : l'option pour le barème progressif n'est plus irrévocable », 23/04/2026 — https://www.vademecum-patrimoine.com/2026/04/23/loi-de-finances-pour-2026-loption-pour-le-bareme-progressif-nest-plus-irrevocable/
- [S2] Rivière Avocats, « Option pour le barème de l'impôt sur le revenu : suppression de son caractère irrévocable » — https://www.contentieux-fiscal-riviere-avocats.fr/option-pour-le-bareme-de-limpot-sur-le-revenu-suppression-de-son-caractere-irrevocable/
- [S3] Légifrance, CGI art. 150 VH bis — https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038612228
- [S4] BOFiP, BOI-RPPM-PVBMC-30-30 (fait générateur) — https://bofip.impots.gouv.fr/bofip/11969-PGP.html/identifiant=BOI-RPPM-PVBMC-30-30-20240423
- [S5] Légifrance, LOI n° 2026-534 du 25/06/2026 (fraudes ; « crypto-actifs », NFT, 3916-bis) — https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000054309429
- [S6] Divly, comparatif France 2026 — https://divly.com/fr/guides/divly-comparison-france-1
- [S7] HelloSafe, avis Koinly, août 2026 — https://hellosafe.fr/investissement/crypto/koinly
- [S8] Rotki, fonctionnalités et dépôt AGPL — https://rotki.com/features
- [S9] Banks for Crypto, Awaken Tax — https://banksforcrypto.com/tax-software/awaken-tax/
- [S10] Protos, « French crypto tax firm targeted in ShinyHunters extortion attempt » — https://protos.com/french-crypto-tax-firm-targeted-in-shinyhunters-extortion-attempt/
- [S11] Cointribune, enquête des autorités françaises sur l'exposition de données Waltio — https://www.cointribune.com/en/french-authorities-probe-waltio-data-exposure/
- [S12] CryptoPulse, « Waltio gratuit 2026 : ce qui est offert » — https://cryptopulseinfo.com/waltio-gratuit-2026-ce-qui-est-offert/
- [S13] CPA Practice Advisor, « IRS 1099-DA reporting gaps could cause crypto investors to overpay taxes », 05/03/2026 — https://www.cpapracticeadvisor.com/2026/03/05/irs-1099-da-reporting-gaps-could-cause-crypto-investors-to-overpay-taxes-by-14500-analysis-finds/179323/
- [S14] dev.to, « Trusted Types is Baseline », février 2026 — https://dev.to/grimicorn/trusted-types-is-baseline-dom-xss-is-now-a-type-error-1k1h
- [S15] Core Web Vitals, seuils 2026 (LCP < 2,5 s, INP < 200 ms, CLS < 0,1) — https://www.corewebvitals.io/core-web-vitals
- [S16] TC39, proposition `Decimal` (stade 1) — https://github.com/tc39/proposal-decimal
- [S17] AbilityNet, état de WCAG 3.0 — https://abilitynet.org.uk/resources/digital-accessibility/what-expect-wcag-30-web-content-accessibility-guidelines
- [S18] Svelte, « What's new in Svelte », juin 2026 — https://svelte.dev/blog/whats-new-in-svelte-june-2026
- [S19] Chrome for Developers, Prompt API (prérequis matériels) — https://developer.chrome.com/docs/ai/prompt-api
- [S20] MoneyVox, sort de l'impôt sur la fortune improductive — https://www.moneyvox.fr/impot/actualites/106000/assurance-vie-or-crypto-votre-epargne-sera-t-elle-taxee-au-nouvel-impot-sur-la-fortune
