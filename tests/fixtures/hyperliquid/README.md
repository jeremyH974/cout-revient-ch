# Jeu de démonstration Hyperliquid

`demo.json` est 100 % synthétique : régénéré par `npm run fixture:hl`
(`scripts/generate-hl-fixture.ts`, graine fixe, déterministe). L'adresse
`0x000000000000000000000000000000000000d3a0` est fictive — jamais dérivée d'une adresse ou
d'un compte Hyperliquid réel.

Le scénario porte **exprès** les pièges du format réel, comme le relevé eToro porte les siens :
un ordre exécuté en **cinq tranches à la même milliseconde**, partageant un `oid` et dont les
`tid` ne suivent pas l'ordre d'exécution. Trié par `tid`, ce paquet rejoue la position à
l'envers — c'est exactement ce qui affichait 667 aller-retours sur un compte qui n'en portait
que 68 (décision n° 130). `tests/integration/hl-fixture.test.ts` vérifie que le piège est bien
là, puis que la chaîne `startPosition` tient malgré lui.
