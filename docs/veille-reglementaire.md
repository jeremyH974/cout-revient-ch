# La veille réglementaire — ce qu'elle sait, et comment l'entretenir

L'écran « Veille réglementaire » (`#/watch`, dans le menu « Plus ») recense l'état du droit et de
la doctrine fiscale française applicables aux crypto-actifs : ce qui est en vigueur, ce qui a été
adopté sans l'être tout à fait encore, ce qui est en discussion, ce que la doctrine n'a pas
stabilisé, et ce qui a été proposé puis retiré. Il ne commente rien, ne calcule rien sur votre
portefeuille et ne recommande jamais d'action : ce document est le mode d'emploi de la table qui
l'alimente.

## Ce qu'elle contient

Neuf lignes au démarrage de P67 : le taux et le seuil d'exonération du prélèvement forfaitaire
unique, l'option pour le barème progressif, un amendement de « fortune improductive » proposé puis
abandonné, le régime encore incertain des récompenses de staking et des airdrops, la collecte et le
premier échange automatique DAC8/CARF entre administrations fiscales, et le régime propre aux
jetons uniques (NFT) — hors périmètre de cette app, qui ne suit que des actifs fongibles.

Une dixième depuis P70 (thème `ia`, voir [`ia-harnais.md`](ia-harnais.md)) : l'article 50 de l'AI
Act impose depuis le 02/08/2026 une mention **visible** sur tout texte généré par un modèle, mais
son marquage **lisible par machine** n'a aucune norme technique stabilisée. Ce n'est pas de la
fiscalité — c'est une obligation qui pèse sur ce que l'app affiche —, et c'est exactement ce pour
quoi cette table existe : écrire ce qu'on sait, écrire ce qu'on ne sait pas, et le dater.

La table en compte **vingt-trois** au 13/09/2026 : s'y sont ajoutées, au fil des briques, la
fiscalité des titres et des dividendes, celle des prêts participatifs, puis — à la relecture du
13/09/2026 (décisions n° 142 et 144) — le délai de reprise allongé des comptes non déclarés et la
ratification française du CARF, encore en discussion.

Chaque ligne porte : un statut codé, la date à laquelle ce statut est devenu vrai, une phrase sur
son effet, sa source (avec son adresse quand elle a pu être confirmée), un degré de certitude
(`confirmed` si un texte officiel permet de l'écrire, `secondary-only` si seuls des commentaires de
praticiens le disent), et sa propre date de relecture.

## Ce qu'elle ne contient pas, et pourquoi

- **Un calcul d'impact sur votre portefeuille.** C'est le rôle des constats fiscaux du Rapport, pas
  de cet écran : une ligne de veille reste vraie indépendamment de vos données, un constat s'en
  déduit — les deux mécanismes ne se confondent jamais (voir la séparation moteur/rendu des
  constats, `src/lib/domain/insights.ts`).
- **Une prévision de ce qui sera voté.** Seul ce qui a été voté, proposé ou retiré est repris ;
  rien n'anticipe une décision à venir.
- **Une injonction.** « Faites vérifier votre situation par un professionnel » est la seule
  formulation de ce type que l'écran s'autorise. Des tournures comme « pensez à » ou « avant qu'il
  ne soit trop tard » sont explicitement exclues.

## Comment elle est tenue

Contrairement au calendrier macro (`npm run calendar`, voir [`calendrier-macro.md`](calendrier-macro.md))
ou aux indicateurs (`npm run macro`), **aucun générateur** n'alimente cette table : « adopté en
commission » ou « la doctrine n'est pas stabilisée » sont des jugements de lecture d'un texte, pas
une donnée qu'une requête peut récupérer. [`src/lib/watch/entries.ts`](../src/lib/watch/entries.ts)
est donc tenu entièrement à la main, sur le modèle du catalogue de sources
([`src/lib/support/sources.ts`](../src/lib/support/sources.ts)), pas sur celui de la table BLS du
calendrier (recopiée depuis une page qui refuse les clients non-navigateurs).

## La barrière de fraîcheur

Chaque entrée porte sa propre date de relecture (`reviewedOn`). Une ligne devient **périmée** :

- si son statut est mouvant (`in-discussion`, `adopted-not-final`, `doctrine-unsettled`) et n'a pas
  été relue depuis plus de **3 mois** ;
- si son statut est stable (`in-force`, `adopted-final`, `dropped`) et n'a pas été relue depuis
  plus de **6 mois** ;
- si une échéance qu'elle annonçait (`deadline`) est dépassée sans relecture postérieure — **sans
  délai de grâce** : une échéance qui passe doit être rouverte, pas simplement attendue.

[`entries.test.ts`](../src/lib/watch/entries.test.ts) fait échouer `npm run check` dès qu'une
entrée est périmée : `staleEntries(WATCH_ENTRIES, today)` doit rendre `[]`. Cette assertion est
**volontairement fragile avec le temps** — c'est le but : le silence ne doit jamais se confondre
avec la stabilité.

Le cron [`.github/workflows/watch.yml`](../.github/workflows/watch.yml) relance ces tests une fois
par mois et ouvre (ou referme) une issue de rappel. Il ne régénère et n'écrit rien, contrairement
au calendrier macro et aux indicateurs : son seul rôle est de signaler qu'une relecture est due.

## Ce que la barrière de fraîcheur ne peut pas faire

Elle vérifie **une date, pas une lecture**. `reviewedOn` prouve qu'on a coché une case ; il ne
prouve pas qu'on a rouvert le texte, et encore moins qu'on a vu ce qui y avait changé.

Ce n'est pas théorique. L'entrée `bareme-progressif` portait `reviewedOn: '2026-08-29'` — donc
parfaitement fraîche au sens de la barrière — et décrivait pourtant un droit qui n'existait plus
depuis le 21 février 2026 : la loi de finances pour 2026 avait supprimé le caractère **irrévocable**
de l'option pour le barème, et la ligne ne le disait pas (décision n° 144).

Aucun test ne peut combler cet écart : « le droit a-t-il changé ? » n'est pas une assertion
mécanisable. Le vert de la CI ne vaut donc **jamais** relecture, et c'est écrit ici pour qu'on cesse
de l'espérer. Même famille que la limite reconnue par la décision n° 90 : le dispositif adosse
`ARCHITECTURE.md` au code, mais l'état d'une proposition n'est vérifiable par aucun test.

Une chose, en revanche, **est** mécanisable, et elle rend une citation périmée visible à l'œil nu.
Une adresse Légifrance de la forme `codes/article_lc/LEGIARTI…` désigne **une version** d'un
article, pas l'article : quand le texte est modifié, l'ancienne version reste en ligne, inchangée et
silencieuse — c'est précisément ce qui s'était produit. Le libellé d'une telle source doit donc
nommer la version qu'il cite, sous la forme « version en vigueur au JJ/MM/AAAA », et
[`entries.test.ts`](../src/lib/watch/entries.test.ts) l'exige. Un lecteur voit alors tout de suite
si la version citée est ancienne.

## La marche à suivre pour relire une entrée

1. Rouvrir sa source (`source.url`, ou chercher la référence donnée par `source.label` si aucune
   adresse n'a pu être confirmée). Sur Légifrance, vérifier **quelle version** s'affiche : l'adresse
   d'une version périmée continue de fonctionner, sans le moindre avertissement.
2. Mettre à jour `status`, `statusDate`, `effect` et `source` si le texte ou la doctrine ont changé.
   Pour un article de code, faire figurer la version citée dans `source.label` (« version en vigueur
   au JJ/MM/AAAA ») : le test l'exige, et c'est la seule trace de ce qui a été lu.
3. Mettre `reviewedOn` à la date du jour, **que le statut ait changé ou non** : c'est la relecture
   elle-même qui compte, pas seulement son résultat. Et **ne pas** la mettre à jour sur une entrée
   qu'on n'a pas rouverte — une relecture non faite vaut mieux qu'une relecture prétendue.
4. `npm run check` : `entries.test.ts` revalide le format des dates, l'unicité des identifiants, la
   présence de la version pour un article de code, et la barrière de fraîcheur.

## Les statuts

| `WatchStatus`        | Libellé à l'écran       | Sens                                                                                      |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `in-force`           | En vigueur              | Le texte s'applique aujourd'hui.                                                          |
| `adopted-final`      | Adopté, définitif       | Voté et promulgué, sans réserve connue.                                                   |
| `adopted-not-final`  | Adopté, pas définitif   | Voté, mais encore susceptible de changer (décret d'application attendu, recours…).        |
| `in-discussion`      | En discussion           | Déposé ou débattu, non encore voté.                                                       |
| `doctrine-unsettled` | Doctrine non stabilisée | Aucun texte officiel ; seules des positions de praticiens existent.                       |
| `dropped`            | Retiré, non retenu      | Proposé puis abandonné — gardé en mémoire pour ne pas laisser resurgir une fausse alerte. |

`status` est un **code** ; son libellé français vit exclusivement dans
[`src/lib/format/watch.ts`](../src/lib/format/watch.ts), par un `switch` exhaustif : ajouter un
statut sans écrire son libellé est une erreur de compilation. `title` et `effect`, en revanche,
restent des phrases françaises **dans la donnée** (comme `title`/`detail` du calendrier macro) :
paraphraser du droit dans un vocabulaire contrôlé coûterait plus cher, en risque d'erreur, que
d'écrire la phrase une fois, à la source.

## Où c'est affiché, et où ça ne l'est jamais

1. L'écran dédié `#/watch`, table complète, avec un filtre par thème.
2. Un bloc court dans le Rapport (section fiscale, juste après les avertissements fiscaux),
   uniquement les lignes qui ne sont **pas** `in-force`.
3. **Jamais sur l'Accueil, aucun badge, aucun compteur, aucune notification.** Cette table décrit
   un état du droit, pas un fil d'actualité : la faire clignoter transformerait une information
   stable en fausse urgence.
