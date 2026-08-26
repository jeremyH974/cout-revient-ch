# Constats — l'aide à la décision, sans jamais conseiller

> P33, livré le 26/08/2026 — décision de conception : [`docs/DECISIONS.md`](DECISIONS.md) n° 40.
> Issu de l'étude [`proposals/2026-08-26-aide-a-la-decision.md`](proposals/2026-08-26-aide-a-la-decision.md)
> (panorama sourcé : Monarch « Automated Insights », Delta « Why Is It Moving? », Waltio, Finary).

## Ce que ça fait

L'app lit vos chiffres déjà calculés et en tire des **observations en une phrase**, avec le nombre
qui les fonde : « Vous avez payé X € de frais d'opérations sur 12 mois, soit 0,4 % du volume
échangé », « BTC représente 72 % de la valeur de vos positions », « 3 opérations ne sont pas encore
interprétées ». Elles apparaissent :

- sur la **Vue d'ensemble**, section « Constats » (les 6 plus importantes, plus un bouton
  « Copier » qui met la liste en texte brut dans le presse-papier) ;
- dans le **Rapport**, section « Constats » — la liste complète, enrichie du repère « mêmes apports
  en BTC » que seul cet écran charge ;
- dans le **PDF**, la même section, mêmes phrases.

## La règle intangible

**Un constat constate. Il ne recommande jamais.** Aucune phrase ne dit d'acheter, de vendre ni
d'arbitrer, et aucune ne présente une opération comme adaptée à votre situation : c'est exactement
la frontière que la doctrine AMF du 04/08/2026 trace entre l'information non personnalisée (libre)
et le conseil en crypto-actifs (réservé aux prestataires agréés, MiCA art. 3, § 1, 24). Le rapport
l'écrit noir sur blanc sous la section.

## Les règles livrées

| Code                           | Ce qu'il constate                                                | Condition d'apparition                      |
| ------------------------------ | ---------------------------------------------------------------- | ------------------------------------------- |
| `unqualified`                  | Opérations que le moteur n'a pas su interpréter                  | au moins une                                |
| `unpriced`                     | Actifs détenus sans cours connu                                  | au moins un                                 |
| `subscription-net`             | Rentabilité réalisée de l'offre Coinhouse sur 12 mois            | une offre est détectée (décision n° 39)     |
| `fees-12m`                     | Frais d'opérations payés sur 12 mois et leur part du volume      | frais ≥ 1 unité de la devise                |
| `concentration`                | Poids du premier actif dans la valeur cotée                      | part ≥ 25 % (mise en avant au-delà de 50 %) |
| `top3-share`                   | Poids cumulé des trois premiers actifs                           | ≥ 75 % et au moins 3 actifs valorisés       |
| `max-drawdown`                 | Plus forte baisse encaissée, dates comprises ([risque](risk.md)) | historique de prix chargé (écran Rapport)   |
| `xirr`                         | Rendement personnel annualisé, depuis la date du 1er flux        | le calcul converge (≥ 30 jours de recul)    |
| `benchmark-gap`                | Écart avec « mêmes apports sur un seul actif »                   | historique de prix chargé (écran Rapport)   |
| `realized`                     | Plus ou moins-values déjà encaissées                             | montant ≥ 1 unité de la devise              |
| `contribution-top` / `-bottom` | Actifs qui pèsent le plus, en bien et en mal                     | au moins 2 positions valorisées             |
| `capital-recovered`            | Positions dont les ventes ont rendu la mise de départ            | au moins une                                |
| `stablecoin-share`             | Part des stablecoins (la trésorerie qui ne suit pas le marché)   | part ≥ 5 %                                  |

Seuils et rangs d'affichage sont déclarés une seule fois, en haut de
[`src/lib/domain/insights.ts`](../src/lib/domain/insights.ts) (`MIN_NOTABLE`,
`CONCENTRATION_NOTE`, `CONCENTRATION_HIGH`, `TOP3_SHARE_NOTE`, `DRAWDOWN_HIGH`,
`STABLE_SHARE_MIN`, `PRIORITY`).

## Comment c'est construit

```
src/lib/domain/insights.ts    règles pures  → {code, tone, priority, values} (chaînes décimales)
src/lib/format/insights.ts    rendu français → {title, detail, tone, link}
src/components/shared/InsightList.svelte    affichage (aucun calcul)
```

**Le moteur ne parle aucune langue.** Il émet des valeurs typées (`money`, `ratio`, `count`,
`assets`, `day`, `tier`) ; le rendu décide du format, du masquage en mode discret (les montants
seulement — pourcentages, dates et compteurs restent lisibles, comme partout dans l'app) et de la
devise d'affichage. Traduire l'app ou reformuler une phrase ne touchera donc jamais au calcul, et
un constat reste du JSON simple — directement exposable par un futur serveur MCP.

**Ajouter un constat** = une règle dans `insights.ts`, son code dans `InsightCode`, son rang dans
`PRIORITY`, sa phrase dans `format/insights.ts`. Le `switch` du rendu est exhaustif : oublier la
phrase ne compile pas.

**Les tons** séparent deux choses que les tableaux de bord confondent souvent : le signe d'un
chiffre (`positive` / `negative`, vert et rouge comme partout ailleurs) et un point à traiter
(`attention`, ambre : lignes à qualifier, actifs sans cours, concentration). Sans cette séparation,
un portefeuille en baisse s'affiche entièrement en orange et les vrais problèmes de données s'y
noient. Le ton n'est jamais porté par la seule couleur : un repère textuel l'accompagne (« Favorable
— », « À regarder — »), vérifié par axe en CI.

**L'ordre est déterministe** : priorité décroissante, égalité départagée par l'identifiant. La
qualité des données passe avant les chiffres — un total calculé sur des lignes non qualifiées est
faux, autant le dire d'abord.

## Ce qui est vérifié

- `src/lib/domain/insights.test.ts` — une assertion par règle sur des portefeuilles synthétiques,
  plus l'ordre déterministe, l'unicité des identifiants et le silence sur les montants négligeables.
- `src/lib/format/insights.test.ts` — chaque code produit une phrase complète sans trou de
  formatage, les pluriels s'accordent, le mode discret masque les montants et pas les pourcentages,
  la devise d'affichage est suivie.
- `src/lib/export/report-model.test.ts` — la section du rapport reprend mot pour mot le rendu.
- `tests/e2e/coherence.spec.ts` — l'écran affiche les phrases du moteur (rejouable sur un export
  réel avec `COHERENCE_CSV`), et la mention « ni un conseil en investissement » est présente.

## Ce que ça ne fait pas

Pas de prédiction de prix, pas de score « achetez / vendez », pas d'appel réseau : les constats se
calculent sur les données déjà présentes dans le navigateur. P31 (risque et structure) est livré et
documenté dans [`docs/risk.md`](risk.md) ; les briques suivantes de l'étude (P30 aperçu fiscal avant
cession, P32 projections, P34 contexte de marché, P35 alertes composées) restent des propositions.
