# Logos des cryptomonnaies (`public/icons`)

Fichiers `<ticker>.svg` (ticker en minuscules) servis depuis la même origine que l'application
(CSP `img-src 'self'`). Aucune dépendance npm n'a été ajoutée : les SVG sont copiés ponctuellement
depuis les paquets ci-dessous. Les logos restent des marques de leurs projets respectifs et ne sont
utilisés qu'à titre d'identification.

**Ce dossier est en partie généré.** Depuis le 27/08/2026, `scripts/generate-icons.mjs` écrit les
logos manquants pour les tickers de la table des prix — curée et générée — et réécrit `KNOWN_ICONS`
dans `src/lib/pricing/icons.ts`. Le script **n'écrase jamais** un fichier existant : les cas
particuliers retouchés à la main, listés plus bas, sont préservés.

```
npm install --no-save @web3icons/core@4.0.55
node scripts/generate-icons.mjs
npm uninstall @web3icons/core
```

Le paquet n'est volontairement **pas** une dépendance du projet : 49 Mo réinstallés à chaque
exécution de CI pour un outil à usage unique ne se justifient pas.

**Ces logos ne sont plus précachés** par le service worker (`globIgnores` dans `vite.config.ts`) :
avec des centaines de fichiers, tout précacher imposerait plusieurs mégaoctets à chaque
installation. Ils passent par un cache d'exécution — chacun télécharge les logos de ses propres
actifs.

## Sources et licences

### web3icons — licence MIT

- Paquet npm `@web3icons/core` 4.0.55 — <https://github.com/0xa3k5/web3icons>
- Tous les fichiers de ce dossier **sauf `crv.svg`** — 61 copiés à la main, puis 149 générés le
  27/08/2026 par `scripts/generate-icons.mjs`.
- Variante « background » (fond carré de la couleur de marque, glyphe blanc) dont le fond carré a
  été remplacé par un disque de même remplissage (cercle `r=12` et `clipPath` circulaire) —
  transformation désormais appliquée par le script, à l'identique.
- Un logo dont le fond carré n'est pas reconnu **n'est pas embarqué** : mieux vaut des initiales
  qu'une géométrie différente des autres.
- Cas particuliers : `ape.svg` et `doge.svg` sont la variante « mono » (glyphe blanc) posée sur un
  disque couleur de marque (`#0054FA`, `#C2A633`), la variante « background » pesant 25–65 Ko de
  filtres ; `render.svg` vient de l'icône `RNDR` ; `ton.svg` et `inj.svg` des icônes réseau `ton`
  et `injective` ; `bal.svg` de l'icône exchange `balancer`. `eurc.svg` : le masque plein entourant
  le fond a été retiré.

### cryptocurrency-icons — licence CC0 1.0 (domaine public)

- Paquet npm `cryptocurrency-icons` 0.18.1 — <https://github.com/spothq/cryptocurrency-icons>
- Fichier : `crv.svg` (variante « color »).

## Tickers sans logo

Aucune source sous licence libre n'a été trouvée pour : `bonk`, `eurcv`, `floki`, `hype`, `ondo`,
`sky`, `usds`, `wif` — **revérifié le 27/08/2026 dans le paquet installé**, sous chaque variante et
chaque nom approchant. Ces huit-là demandent un kit de marque officiel, avec licence vérifiée.

S'y ajoutent les tickers de la table **générée** absents du paquet : ils ne sont pas énumérés, ils
sont trop nombreux et leur absence n'est le fruit d'aucune décision. L'application affiche alors
les initiales (repli de `CoinBadge`), ce qui est le comportement voulu.

## Texte de la licence MIT (web3icons)

```
MIT License

Copyright (c) 2024 0xa3k5

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
