# Logos des cryptomonnaies (`public/icons`)

Fichiers `<ticker>.svg` (ticker Coinhouse en minuscules) servis depuis la même origine que
l'application (CSP `img-src 'self'`). Aucune dépendance npm n'a été ajoutée : les SVG ont été
copiés ponctuellement depuis les paquets ci-dessous, puis optimisés avec svgo 4 (`viewBox`
conservé, attributs `width`/`height`/`class` retirés). Les logos restent des marques de leurs
projets respectifs et ne sont utilisés qu'à titre d'identification.

## Sources et licences

### web3icons — licence MIT

- Paquet npm `@web3icons/core` 4.0.55 — <https://github.com/0xa3k5/web3icons>
- Tous les fichiers de ce dossier **sauf `crv.svg`** (61 fichiers).
- Variante « background » (fond carré de la couleur de marque, glyphe blanc) dont le fond carré a
  été remplacé par un disque de même remplissage (cercle `r=12` et `clipPath` circulaire).
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
`sky`, `usds`, `wif`. L'application affiche alors les initiales (repli de `CoinBadge`).

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
