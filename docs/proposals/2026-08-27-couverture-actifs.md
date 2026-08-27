# Couverture des actifs — logos et table des prix

> **Demande traitée.** « Il faut que l'appli puisse avoir les logos des cryptos et alts les plus
> connus, car chaque personne possède des cryptos différentes » — et, sur relance, la **table des
> prix** avec, puisqu'un logo sans cotation ne sert à rien.
>
> Plan écrit avant le code, partie par partie. « État de l'art » = ce qui est mesuré et daté, pas
> supposé. « Prêt pour le futur » = la couverture doit pouvoir grandir sans rien réécrire, et sans
> que personne ne recopie une table à la main.

Établi le 27/08/2026, sur `main` à `830931c`. Chaque chiffre ci-dessous a été mesuré dans le dépôt
ou contre l'API réelle à cette date.

## Le cœur du problème, en une phrase

Couvrir la longue traîne bute sur **deux contraintes de nature opposée** : côté prix, le risque est
la **justesse** — un mauvais identifiant donne un prix faux, ce qui est bien pire que pas de prix ;
côté logos, le risque est le **poids** — le service worker précache tout, et 1 800 logos feraient
2,3 Mo à l'installation. Les deux se traitent séparément, avec des règles différentes.

## État des lieux, vérifié

| Constat                                         | Mesure                                                      |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Table curée `TICKERS`                           | **70 entrées** (`src/lib/pricing/tickers.ts`, 3 984 octets) |
| Logos embarqués                                 | **62 fichiers**, 84 Ko, moyenne 1 362 octets                |
| Logos précachés par le service worker           | **62 sur 62** — `globPatterns` inclut `**/*.svg`            |
| Gisement disponible                             | `@web3icons/core` **MIT**, ≈ 1 800 jetons nommés par ticker |
| Projection : 1 800 logos précachés              | **2 377 Ko téléchargés à chaque installation**              |
| Actif absent de `TICKERS`                       | **aucun prix automatique** ; badge d'initiales              |
| Échappatoire « forcer l'identifiant CoinGecko » | **le modèle existe, l'interface n'existe pas**              |

Ce dernier point corrige ce que j'ai affirmé en discussion : `AssetSettings.coingeckoId` est bien
défini (`storage/schema.ts:48`) et câblé jusqu'aux fournisseurs (`app.svelte.ts:1977`), mais
`grep coingeckoId src/routes src/components` ne rend **rien** : aucun écran ne permet de le saisir.
L'échappatoire est une plomberie sans robinet.

---

# Partie 1 — La table des prix

## 1.1 L'ambiguïté de ticker, mesurée plutôt que redoutée

C'est le risque que j'annonçais comme le plus grave. Sonde du 27/08/2026 sur
`api.coingecko.com/api/v3/coins/markets?order=market_cap_desc`, deux pages de 250 :

```
500 coins · 493 symboles distincts · 7 collisions (1,4 %)
```

| Symbole     | En conflit                                   |
| ----------- | -------------------------------------------- |
| `dai`       | dai (#23) vs dai-on-pulsechain (#250)        |
| `m`         | memecore (#39) vs mantis (#429)              |
| `usdf`      | falcon-finance (#62) vs astherus-usdf (#243) |
| `up`        | up-2 (#187) vs unitas (#256)                 |
| `safe`      | safecoin (#260) vs **safe (#336)**           |
| `usda`      | usda-2 (#260) vs usda-3 (#302)               |
| `pc0000023` | deux produits structurés                     |

**Bornée à la tête de marché, l'ambiguïté est marginale.** Elle n'est pas nulle pour autant, et le
cas `safe` montre pourquoi la règle simple ne suffit pas : « le mieux classé gagne » donnerait
_safecoin_, alors que le jeton que tout le monde appelle SAFE est _safe_ (#336), moins bien classé.

## 1.2 La règle retenue

**Un symbole ambigu n'est pas cartographié.** Ni prix, ni devinette : l'actif garde le comportement
actuel (aucune cotation automatique) et l'utilisateur tranche lui-même. Sept exceptions sur cinq
cents, c'est un prix dérisoire pour ne jamais afficher un prix faux.

Le contraire — « prendre le mieux classé » — échangerait une couverture marginale contre un risque
de justesse, dans une application dont c'est précisément la promesse. Un PRU faux est pire qu'un PRU
absent, et rien à l'écran ne le signalerait.

## 1.3 Génération, pas recopie

`scripts/generate-tickers.mjs` interroge CoinGecko, retient le **top N** (N = 500 pour commencer),
écarte les symboles en collision, et **écrit** `src/lib/pricing/tickers.generated.ts`. La table
curée actuelle reste **prioritaire** : elle porte des décisions humaines (`eurcv` sans identifiant
parce qu'ancré à l'euro, `wif` → `dogwifcoin`) qu'aucune génération ne doit écraser.

Ordre de résolution, du plus fort au plus faible : réglage utilisateur → table curée → table
générée. Un test vérifie qu'aucune entrée générée ne contredit une entrée curée.

**Poids.** 57 octets par entrée mesurés sur la table actuelle → ≈ 28 Ko bruts pour 500 entrées, très
répétitifs donc bien comprimés. À mesurer après coup contre le budget Lighthouse (performance en
`warn` à 0,90 ; accessibilité, bonnes pratiques et SEO en `error` à 0,95).

## 1.4 Ce que la génération ne fait pas

Les symboles Coinbase et Kraken de la table curée ne sont **pas** devinés : CoinGecko ne les
connaît pas. Une entrée générée n'a qu'un identifiant CoinGecko — donc CoinGecko et DefiLlama la
cotent, Coinbase et Kraken non. C'est suffisant, et cela ne dégrade rien : ces deux-là ne cotaient
déjà pas ces actifs.

---

# Partie 2 — Les logos

## 2.1 La contrainte qui décide : le précache

`vite.config.ts` déclare `globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}']`. Les 62
logos sont donc **tous** précachés — vérifié : le `sw.js` produit en compte 62. Vendoriser 1 800
logos sans rien changer imposerait **2,3 Mo à chaque installation**, pour des actifs que personne ne
détient tous. L'installation PWA et le score de performance en souffriraient immédiatement.

## 2.2 La solution : précache la coquille, cache d'exécution les logos

Les icônes sortent de `globPatterns` et reçoivent une règle `runtimeCaching` en _cache d'abord_. Un
utilisateur télécharge alors **les logos de ses propres actifs**, une fois, puis plus jamais. Douze
cryptos détenues, douze requêtes de 1,4 Ko.

Rien ne change côté vie privée : les logos restent servis depuis notre origine, la CSP
`img-src 'self' data:` est inchangée, aucun tiers n'est appelé.

**Contrepartie assumée et écrite** : hors ligne, un actif dont le logo n'a jamais été affiché montre
ses initiales. C'est déjà le comportement d'un actif inconnu, `CoinBadge` sait le faire, et une
initiale colorée vaut mieux qu'un carré vide.

## 2.3 Vendorisation par script

`scripts/generate-icons.mjs` lit `@web3icons/core` (**MIT**, déjà source de 61 des 62 logos
existants), sélectionne les jetons de la table — curée **et** générée —, optimise, écrit
`public/icons/` et **régénère `KNOWN_ICONS`**. La liste écrite à la main disparaît : c'est une
connaissance dupliquée, et `icons.test.ts` la surveille déjà précisément parce qu'elle dérive.

`NO_ICON` reste, mais pour les seuls cas motivés à la main — les quatre kits de marque à obtenir
(EUR CoinVertible, Hyperliquid, Sky, USDS).

`public/icons/LICENSE.md` doit dire que le dossier est **généré** et sous quelle licence, au lieu
d'énumérer 500 fichiers.

## 2.4 Le piège du ticker, ici aussi

`@web3icons/core` nomme ses fichiers **par ticker**, et l'app résout **par ticker**. Le paquet a
donc déjà tranché les collisions à notre place, sans nous dire comment. Le script n'embarque un logo
que pour un symbole **non ambigu** au sens de la partie 1 — les mêmes sept exceptions. Afficher le
mauvais logo est moins grave qu'un prix faux, mais ce n'est pas une raison de le faire exprès.

---

# Partie 3 — L'échappatoire manquante

Un actif absent de la table, ou écarté pour ambiguïté, doit rester **utilisable**. Aujourd'hui, rien
ne permet de le rattraper : le champ existe, l'écran non.

La fiche actif reçoit donc un champ **« Identifiant CoinGecko »**, à côté du prix manuel qui y vit
déjà (`AssetDetail.svelte:87`). Saisi, il est prioritaire sur les deux tables et suffit à faire
coter l'actif par CoinGecko et DefiLlama.

C'est la brique qui rend les deux autres honnêtes : la couverture automatique peut refuser un cas
douteux **parce que** l'utilisateur a le dernier mot.

---

# Prêt pour le futur

- **Grandir se fait par un paramètre.** Passer de 500 à 1 000 actifs = relancer le script. Aucune
  table recopiée, aucune décision à reprendre.
- **La règle d'ambiguïté est une fonction pure et testée**, pas un jugement dispersé dans un script.
  Elle servira telle quelle à P41 (actions et ETF), où le même problème se pose avec les ISIN.
- **Les logos sont découplés du poids d'installation.** Ce qui rendait la couverture impossible
  devient une question de disque sur le serveur, pas de bande passante chez l'utilisateur.
- **La date de génération est écrite dans le fichier produit.** Une table de marché vieillit ; sans
  date, personne ne sait si elle a deux mois ou deux ans.

# Vérification

- Test : **aucune entrée générée ne contredit une entrée curée** (le contraire écraserait des
  décisions humaines, silencieusement).
- Test : **aucun symbole en collision** dans la table générée, sur un échantillon figé.
- Test : `KNOWN_ICONS` correspond exactement aux fichiers présents — le contrôle existe déjà, il
  s'applique à un dossier de 500 fichiers au lieu de 62.
- Mesure : poids du bundle avant/après, et **score Lighthouse relevé**, pas supposé.
- E2E : un actif de la table générée s'affiche avec logo et cotation ; un actif ambigu s'affiche en
  initiales sans prix, et son champ d'identifiant permet de le rattraper.
- `scripts/api-contract.mjs` : ajouter le contrat de `coins/markets` — c'est désormais une source
  dont dépend une table livrée.

# Ce que ce plan ne fait pas

- **Aucune requête réseau supplémentaire à l'exécution** : la table est générée au développement,
  livrée figée. L'app n'interroge pas CoinGecko pour savoir ce qu'est un ticker.
- **Aucun logo dont la licence n'est pas établie.** Les quatre kits de marque restent à obtenir.
- **Aucune devinette sur un symbole ambigu**, ni pour le prix, ni pour le logo.
