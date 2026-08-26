# Risque et structure du portefeuille

> P31, livré le 26/08/2026 — décision de conception : [`docs/DECISIONS.md`](DECISIONS.md) n° 41.
> Issu de l'étude [`proposals/2026-08-26-aide-a-la-decision.md`](proposals/2026-08-26-aide-a-la-decision.md)
> (références : IBKR PortfolioAnalyst, Portfolio Performance, Ghostfolio X-ray).

## Le point qui décide de tout

**Ces mesures portent sur l'indice de performance, pas sur la valeur de votre portefeuille.**

Un retrait de 10 000 € fait chuter la valeur brute sans qu'aucune perte n'ait eu lieu. Un repli
calculé sur cette valeur inventerait un krach chaque jour de virement, et la « volatilité » d'un
investisseur régulier gonflerait à mesure qu'il verse. L'indice, lui, suit la croissance d'une
unité investie au premier jour, **apports et retraits neutralisés** : c'est la série qu'utilisent
les outils de référence, et la seule sur laquelle « quelle baisse ai-je encaissée ? » a un sens.

Conséquence pratique : le repli affiché ici **ne se compare pas à votre relevé de compte**. Le
rapport le dit explicitement sous le tableau.

L'indice vient de `twrEur` (Dietz modifié à l'intérieur de chaque jour, puis chaînage) — le même
calcul qui produit déjà le rendement hors apports du rapport. Un jour neutralisé (portefeuille vide
au départ de la journée) reporte l'indice de la veille, à plat.

## Ce qui est calculé

| Mesure                    | Définition                                                              | Conditions                        |
| ------------------------- | ----------------------------------------------------------------------- | --------------------------------- |
| **Repli maximal**         | Plus forte baisse depuis un plus haut, avec dates de sommet et de creux | dès le premier recul              |
| **Retour au niveau**      | Jour où le plus haut précédent a été retrouvé (ou « pas encore »)       | —                                 |
| **Repli en cours**        | Écart entre le dernier point et le plus haut atteint                    | —                                 |
| **Volatilité annualisée** | Écart-type d'échantillon des variations quotidiennes × √365             | ≥ 30 rendements quotidiens        |
| **Volatilité baissière**  | Idem, sur les seules journées de baisse                                 | ≥ 30 jours et au moins une baisse |
| **Ratio de Sortino**      | Rendement annualisé ÷ volatilité baissière                              | les deux disponibles              |
| **Régularité**            | Jours gagnants / perdants, meilleur et pire jour                        | —                                 |

**√365 et non √252** : la crypto se négocie en continu, il n'y a pas de jours de fermeture.

**Sortino plutôt que Sharpe** : le Sharpe exige un taux sans risque qu'il faudrait inventer et
paramétrer, et il pénalise autant les hausses que les baisses. Le Sortino ne mesure que ce qui fait
mal. La cible de rendement est fixée à 0 % et l'affichage le dit.

**30 jours minimum** avant d'annoncer une volatilité : en dessous, un écart-type n'est que du bruit.
Le repli, lui, reste mesurable dès la première baisse — c'est un fait, pas une statistique.

## Où ça s'affiche

- **Rapport → section « Risque »** (écran et PDF) : le tableau complet, avec la note d'avertissement.
- **Constats** : `max-drawdown` (« Votre plus forte baisse a été de X %, du … au … ») rejoint les
  règles de [`docs/insights.md`](insights.md), ainsi que `top3-share` (« Vos trois premiers actifs
  pèsent 85 % de la valeur »).
- **Rapport → section « Répartition »** : anneau SVG (`AllocationDonut`), parts triées de la plus
  grosse à la plus petite, queue regroupée en « n autres ». L'anneau est décoratif
  (`aria-hidden`) : le tableau qui le suit reste la source lisible par un lecteur d'écran.

L'historique quotidien des prix n'est chargé que par l'écran Rapport : ailleurs, ces mesures se
taisent plutôt que d'afficher un chiffre partiel.

## Ce qui est vérifié

- `src/lib/domain/risk.test.ts` — repli du sommet au creux et date de retour, repli le plus profond
  gardé plutôt que le dernier, silence sur un indice qui ne recule jamais, seuil des 30 jours,
  formule du Sortino, et surtout : **un retrait n'invente pas de repli** (le même calcul sur la
  valeur brute verrait une baisse de plus de 50 % là où l'indice ne bouge pas).
- `src/lib/domain/twr.test.ts` — l'indice part de 1 et finit sur le rendement cumulé.
- `src/lib/export/report-model.test.ts` — le repli s'affiche négatif, avec ses dates ; la section
  avoue ce qu'elle ne peut pas calculer sur une série courte.
- `tests/e2e/coherence.spec.ts` — le constat et le tableau annoncent le même repli et la même
  mention de recouvrement.

## Ce que ça ne fait pas

Ni bêta, ni alpha, ni VaR : ces mesures supposent un indice de marché de référence ou une loi de
distribution, deux hypothèses que l'app ne peut pas honnêtement poser sur un portefeuille crypto
personnel. Aucune de ces mesures n'est un conseil : elles décrivent ce qui s'est produit.
