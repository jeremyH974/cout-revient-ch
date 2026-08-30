# Le harnais d'évaluation des fonctions d'IA — et ses garde-fous testés

> P70, livré le 30/08/2026. Issu de l'étude
> [`proposals/2026-08-29-data-ia-et-agentique.md`](proposals/2026-08-29-data-ia-et-agentique.md)
> (§ 0 et § P70), qui le pose comme **prérequis** : pas une ligne d'IA livrée sans son harnais.
>
> **Mise à jour du 30/08/2026 (P65).** Le premier vrai modèle est branché : récit narratif du
> rapport, clé apportée par l'utilisateur, consentement à chaque envoi. Tout ce qui suit reste
> vrai — le harnais n'a pas été assoupli pour laisser passer le premier client réel, il a été
> étendu. Les paragraphes ajoutés par P65 le disent.

## Ce que ça fait, et ce que ça ne fait pas

P70 n'a livré **aucun modèle** : seulement l'outillage qui rendrait sûres les fonctions à venir.
P65 branche la première (le récit narratif) ; P64 (appariement de colonnes) et P69 (assistant)
suivront. Le chemin réseau vit **hors** de `src/lib/ai/`, et ce n'est pas un détail de rangement :
un test lit le TEXTE des fichiers de ce dossier et échoue s'il y trouve `fetch(`.

| Module                                                                            | Rôle                                                                                     |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`src/lib/ai/numbers.ts`](../src/lib/ai/numbers.ts)                               | Lit les nombres d'un texte français et les **classe** avant de les normaliser            |
| [`src/lib/ai/anchor.ts`](../src/lib/ai/anchor.ts)                                 | Confronte ces nombres au JSON source, par une **liste fermée** de dérivations            |
| [`src/lib/ai/contract.ts`](../src/lib/ai/contract.ts)                             | Étiquette, motifs de refus, `AiOutcome`, consignes système, contrat d'adaptateur         |
| [`src/lib/ai/narrative.ts`](../src/lib/ai/narrative.ts)                           | **P65** — la charge utile du récit, et le pipeline fixe qui la juge                      |
| [`src/lib/ai/adapters/recorded.ts`](../src/lib/ai/adapters/recorded.ts)           | Rejoue des cassettes enregistrées — **aucun chemin réseau**                              |
| [`src/lib/net/anthropic.ts`](../src/lib/net/anthropic.ts)                         | **P65** — le seul chemin réseau, hors de `src/lib/ai/` pour ne pas désarmer le garde-fou |
| [`src/lib/format/lexicon.ts`](../src/lib/format/lexicon.ts)                       | Lexiques proscrits : accusation, conseil, garantie, classement                           |
| [`src/lib/format/ai.ts`](../src/lib/format/ai.ts)                                 | **P65** — le français des refus et de l'étiquette (le contrat ignore la langue)          |
| [`scripts/capture-ai.ts`](../scripts/capture-ai.ts)                               | **P65** — `npm run ai:capture`, hors CI : trois tirages, tout ou rien                    |
| [`tests/integration/ai-harness.test.ts`](../tests/integration/ai-harness.test.ts) | Le banc d'essai, et son verdict en trois classes                                         |

La règle de fond ne change pas : **l'IA n'entre jamais dans le calcul ; elle entre dans la
compréhension, la qualification et la distribution.** Cette règle n'est une garantie que parce
qu'une fonction la vérifie — pas parce qu'un prompt la promet.

## Le premier client du harnais est notre propre rendu français

C'est le choix de conception qui distingue un harnais d'un cadre théorique. La propriété centrale
(`src/lib/ai/anchor.property.test.ts`) tire des `Insight[]` au hasard, les rend en français par
[`format/insights.ts`](../src/lib/format/insights.ts) — du code déterministe, sans le moindre
modèle — et exige qu'**aucun nombre du texte n'échappe au JSON des constats**. Si le vérificateur
devient trop strict, elle tombe immédiatement, sur nos phrases, à chaque `npm run check`.

Elle a d'ailleurs trouvé quelque chose dès son premier passage : voir « Ce que la propriété a
révélé » plus bas.

## Le constat empirique qui commande l'extracteur

Vérifié sur ce dépôt (Node 24, ICU 78.2), `Intl` en `fr-FR` :

- groupe les milliers avec **U+202F** (espace fine insécable) — pas U+00A0 ;
- n'emploie **U+00A0** que **devant `€` et `%`** ;
- groupe dès quatre chiffres : `2026` mis en forme donne `2 026`, jamais `2026`.

Et [`format/fr.ts`](../src/lib/format/fr.ts) signe les négatifs du moins typographique **U+2212**.
Un vérificateur écrit contre U+00A0 seul laisserait donc passer **tous les milliers** — exactement
les montants qui comptent. Le test `numbers.test.ts` verrouille cette hypothèse : le jour où une
version d'ICU changerait de séparateur, c'est là que ça casse, pas dans un ancrage devenu faux sans
explication.

Le troisième point n'est pas un détail : c'est le séparateur qui distingue un millésime (`2026`,
écarté du contrôle) d'un nombre mis en forme (`2 026`, contrôlé).

## Ce qui est exclu du contrôle, et pourquoi

`date`, `time` et `ordinal` ne sont jamais confrontés aux ancres : `jj/MM/aaaa`, `jj/MM`,
`HH:mm(:ss)`, une année isolée de quatre chiffres entre 1900 et 2100, et un rang annoncé par son
mot (« ligne 42 », liste fermée de marqueurs). Chaque exclusion est une renonciation assumée :
**une date fausse ne sera pas attrapée.**

Les chiffres collés à un identifiant (`1INCH`, `SHIB2`) sont ignorés — sans quoi chaque ticker
exotique produirait un ancrage introuvable.

## La liste des dérivations est fermée, et elle le reste

Une ancre est une feuille décimale du JSON d'entrée. Ses rendus admissibles sont engendrés par une
liste **déclarée**, comparée par `Big.eq`, **sans le moindre epsilon** : l'arrondi d'affichage est
déjà modélisé par `display`, l'absorber une seconde fois dans une tolérance reviendrait à ne plus
rien vérifier.

| Dérivation | Ce qu'elle autorise                                        |
| ---------- | ---------------------------------------------------------- |
| `exact`    | la valeur telle quelle                                     |
| `display`  | l'arrondi half-up à 0, 1, 2, 3, 4, 6, 8, 9 ou 10 décimales |
| `percent`  | `×100` arrondi à 1 ou 0 décimale (pourcentages et points)  |
| `abbrev`   | l'abrégé en milliers ou en millions, **ramené à l'unité**  |
| `abs`      | la valeur absolue                                          |

**5 et 7 décimales en sont volontairement absents** : la précision adaptative de `fmtPrice` n'est
donc pas un rendu déclaré, et un prix cité à cinq décimales serait refusé. Le narrateur rend des
constats, pas des prix.

`abbrev` ramène l'abrégé à l'unité parce que l'extracteur normalise déjà `12,3 k€` en `12300`. Sans
ce retour à l'unité, `12 345 k€` et `12 345 €` deviendraient indiscernables : le vérificateur
accepterait une erreur d'un facteur mille.

**On n'élargit pas la liste pour absorber un faux positif.** Si un modèle refait un total juste —
la somme de deux constats — le texte est **refusé** : blanchir son arithmétique, ce serait la
laisser entrer dans le calcul. Un total qui doit être cité appartient au JSON d'entrée, où il
devient une ancre comme une autre.

Un faux positif se traite donc par l'autre bout : soit la valeur entre dans la source, soit elle
est **déclarée comme constante du gabarit** (`AnchorOptions.literals`), sous son nom, avec le genre
de jeton où elle apparaît, et par le code appelant — jamais par le modèle.

## Ce que ce vérificateur NE PEUT PAS attraper

- **Un nombre juste, attribué au mauvais actif.**
- **Un sens inversé** — `abs` est un rendu déclaré, donc une perte peut devenir un gain.
- **Une omission** : trois constats flatteurs choisis sur quatorze.
- **Une collision fortuite** avec une autre ancre.
- **Une phrase fausse sans chiffre** (« votre portefeuille est bien diversifié »).
- **Une date fausse**, écartée par classification.

**Un ancrage vert dit exactement une chose : aucun chiffre n'a été fabriqué. Il ne dit rien de la
vérité de la phrase.** Deux cas du jeu de référence (`13-limite-connue-mauvais-actif` et
`14-limite-connue-sens-inverse`) sont **verts et étiquetés** pour cette raison : une limite qui
n'existe que dans la prose finit par être oubliée.

## Le lexique — une condition nécessaire, jamais une preuve

[`format/lexicon.ts`](../src/lib/format/lexicon.ts) généralise le garde-fou écrit pour le second
avis (décision n° 67). Quatre domaines : `accusation`, `advice`, `guarantee`, `ranking`. Deux
modes :

- `scanSource` lit un fichier **comme du texte, commentaires compris** — délibérément : une
  explication de code qui emploie le vocabulaire de l'accusation finit par déteindre sur les
  phrases. Un faux positif s'y traite par **exception nommée mot pour mot**, accompagnée d'un test
  (`missingAllowed`) qui exige qu'elle soit encore là, intacte.
- `scanOutput` lit des phrases rendues, **sans aucune exception**.

`second-opinion.lexicon.test.ts` a été réécrit au-dessus du module en gardant son `FORBIDDEN`
intact, et un test exige que chacune des onze règles d'origine soit encore couverte, motif pour
motif et raison pour raison — aucune régression de couverture. Le rendu du second avis passe
désormais **les quatre lexiques**, pas seulement celui de l'accusation.

**La frontière information / conseil n'est vérifiable que comme condition nécessaire.** Le test dit
« aucun mot de conseil » ; il ne dit pas « ce n'est pas du conseil ». Une recommandation peut
parfaitement se faire par le **choix et l'ordre** des constats — trois chiffres flatteurs sur
quatorze, rangés dans le bon sens, et personne n'a écrit « achetez ». Aucun test ne lit cela.
Prétendre l'inverse serait une garantie fausse.

## Le refus est un état rendu de première classe

`AiOutcome<T>` n'a que deux formes : `ok` avec son étiquette et son audit, ou `refused` avec son
motif et son repli. Une sortie non ancrée est **jetée entière** et remplacée par le rendu
déterministe — jamais un texte partiel, jamais une dégradation silencieuse : afficher les trois
phrases valides d'un texte qui en contenait cinq, c'est publier un résumé que personne n'a écrit.

Deux invariants tenus **par construction** plutôt que par discipline : `ok ⟹ label présent` (le
type l'impose) et `ok ⟹ audit.unanchored.length === 0` (`accept()` refuse de construire l'autre
cas et rend un refus `unanchored`).

Les sept motifs (`no-model`, `model-error`, `unanchored`, `forbidden-lexicon`, `empty`, `quota`,
`timeout`) sont classés par un `switch` exhaustif en deux origines : **le modèle n'a rien dit**, ou
**nous avons rejeté ce qu'il a dit**. C'est cette distinction qui sépare, dans le banc d'essai, un
cas « à recapturer » d'un cas bloquant.

Le **repli** est une propriété de la tâche, pas du motif : le récit narratif retombe sur
`insightsToText`, un assistant conversationnel n'aura rien sur quoi retomber.

## L'étiquette, et ce que la loi ne dit pas encore

`AiLabel` porte `generated: true`, le modèle, l'instant et la mention visible (`AI_NOTICE`).
L'article 50 de l'AI Act impose cette mention depuis le 02/08/2026. Le **marquage lisible par
machine**, lui, n'a aucune norme technique stabilisée au 30/08/2026 : c'est écrit dans la veille
réglementaire (`ai-act-marquage`, statut `doctrine-unsettled`, certitude `secondary-only`), avec sa
propre barrière de fraîcheur — trois mois, comme tout statut mouvant.

## L'exécution hors ligne

La clé d'une cassette est `sha256(system ‖ ' ' ‖ user ‖ ' ' ‖ modelId)`, calculée avec
`@noble/hashes` — **déjà une dépendance** du projet (décision n° 13 : aucune n'est ajoutée). Les
cassettes vivent dans `tests/fixtures/ai/replies/<hash>.json` :

```json
{
  "hash": "…",
  "modelId": "…",
  "capturedAt": "2026-08-30T09:00:00",
  "source": "handwritten",
  "text": "…"
}
```

Les espaces insécables et le moins typographique y sont échappés en `\uXXXX` : un séparateur
invisible dans une fixture est un piège de relecture. **Cette convention est désormais tenue par un
test** (P65) et par le script de capture, qui échappe ce qu'il écrit — elle n'était jusqu'ici
qu'une phrase de documentation, et un simple `JSON.stringify` suffisait à la défaire sans que rien
ne le signale.

**Cassette absente = exception, jamais de repli réseau.** Il n'existe aucun chemin réseau dans le
module, et un test le vérifie sur le TEXTE des fichiers de `src/lib/ai` (`fetch(`,
`XMLHttpRequest`, `WebSocket`, `EventSource`) : une promesse de documentation ne prouve rien,
l'absence de ces mots, si. La CI ne sort jamais sur Internet et n'appelle jamais un modèle.

**Chaque cassette porte sa provenance** : `handwritten` ou `fixture-capture`, et `parseCassette`
**refuse toute autre valeur**. C'est la seule barrière entre le dépôt et une capture faite sur un
export réel. Le futur script de capture (livré avec P65) devra la faire respecter : **jamais de
capture sur un export réel**, même « anonymisé » (décision n° 17).

**Une seule cassette par cas** pour les douze écrits à la main. Trois variantes rédigées par la
même personne seraient une fausse variance — elles mesureraient la patience du rédacteur, pas la
variabilité d'un modèle. La règle des trois tirages s'appliquera aux **captures réelles**, avec
P65.

## Le jeu de référence

Un fichier par cas dans `tests/fixtures/ai/cases/`, lisible et diffable :

```json
{ "id": "…", "task": "narrative", "input": {…}, "expect": { "anchored": true, "lexicon": true, "mustRefuse": null } }
```

| Cas                              | Ce qu'il éprouve                                          |
| -------------------------------- | --------------------------------------------------------- |
| `01-recit-nominal`               | récit entièrement ancré                                   |
| `02-chiffre-invente`             | **un** chiffre inventé → échec (`not-in-source`)          |
| `03-total-recompose`             | chiffre juste, somme de deux constats → échec             |
| `04-milliers-espace-fine`        | milliers en U+202F                                        |
| `05-milliers-insecable`          | milliers en U+00A0                                        |
| `06-abrege-milliers`             | `12,3 k€` depuis `12345.67`                               |
| `07-pourcentage-depuis-ratio`    | `12,3 %` depuis un ratio `0.1234`                         |
| `08-quantite-exacte`             | quantité crypto à 9 décimales, exacte                     |
| `09-quantite-tronquee`           | la même tronquée à 4 décimales → échec                    |
| `10-dates-et-numeros-de-ligne`   | dates, heure et numéros de ligne, aucun montant → passe   |
| `11-lexique-conseil`             | « vous devriez alléger » → refus lexique                  |
| `12-modele-indisponible`         | aucun modèle → `refused: 'no-model'`, repli déterministe  |
| `13-limite-connue-mauvais-actif` | **vert et étiqueté** : bonne valeur, mauvais actif        |
| `14-limite-connue-sens-inverse`  | **vert et étiqueté** : bonne valeur, sens inversé         |
| `15-recit-p65-nominal`           | la charge utile réelle de P65, entièrement ancrée         |
| `16-total-absent-de-l-entree`    | le même récit sans `totaux` dans l'entrée → `unanchored`  |
| `17-cle-invalide`                | clé refusée par l'API → `model-error`, repli déterministe |
| `18-plafond-atteint`             | `429` → `quota`                                           |
| `19-delai-depasse`               | abandon au bout de trente secondes → `timeout`            |
| `20-reponse-vide`                | réponse blanche → `empty`                                 |
| `21-reponse-tronquee`            | réponse coupée au plafond de sortie → `empty`             |
| `22-consentement-refuse`         | l'utilisateur annule l'envoi → `no-model`                 |

Les six derniers n'ont **pas de cassette**, et ne peuvent pas en avoir : `parseCassette` refuse un
texte vide, et une cassette ne porte ni code HTTP ni délai. Ils sont joués par un adaptateur qui
**rejette avec son motif**, exactement comme le fait l'adaptateur réseau — même forme d'erreur,
même champ `aiRefusal`. Le banc d'essai éprouve ainsi les branches d'échec du pipeline sans qu'un
seul test touche au réseau, et un test unitaire de `narrative.ts` vérifie que la lecture en canard
s'accorde avec l'erreur réellement levée par `src/lib/net/anthropic.ts` — c'est cette paire qui
tient une frontière volontairement non typée.

Le cas `16` mérite d'être lu deux fois : c'est lui qui **justifie la présence des totaux dans la
charge utile**. Sans eux, un modèle qui cite la valeur du portefeuille cite un nombre introuvable
dans sa source, et le texte est jeté — non parce qu'il est faux, mais parce que rien ne permet de
dire qu'il est juste.

Un test de registre échoue si un identifiant est dupliqué, si une cassette est orpheline, ou si
deux cas partagent la même entrée — ils partageraient alors la même cassette sans qu'on le voie.

## Le verdict en trois classes

- **Bloquant** (échec de CI) : ancrage non vide, mot proscrit, étiquette absente, contrat de refus
  violé.
- **À recapturer** (rapporté, vert) : cassette manquante ou `modelId` différent. C'est ce qui
  distingue « la sortie est fausse » de « le modèle a changé » — confondre les deux ferait rougir
  la CI à chaque mise à jour, et on finirait par ne plus la lire. Deux tests prouvent que cette
  classe existe vraiment, les cassettes du dépôt étant toutes à jour.
- **Indicatif** (rapporté, vert) : longueur du texte, couverture des ancres citées, nombres
  contrôlés et écartés.

**Aucun juge LLM.** Faire noter une sortie de modèle par un autre modèle importerait des biais
mesurés et non corrigés (position, auto-préférence) au cœur même du garde-fou. Tout ce qui est
bloquant est décidé par une fonction pure et rejouable.

## Ce que la propriété centrale a révélé

Dès son premier passage sur `format/insights.ts`, elle a signalé des nombres non ancrés — et elle
avait raison à chaque fois :

1. **Trois constantes écrites en dur dans nos propres phrases** : le seuil légal de `305 €`
   (art. 150 VH bis), la fenêtre de `12` mois glissants, et le `100 %` du repère « un placement
   100 % BTC ». Ce sont des nombres du **gabarit**, pas de la source. Elles sont désormais
   déclarées une par une, avec la phrase qui les porte et le genre de jeton où elles apparaissent —
   un `100 %` déclaré ne blanchit pas un « 1,00 € » inventé. Un test voisin exige que chacune soit
   encore **nécessaire**, sur la phrase minimale qui la porte : une dérogation qui dort est une
   dérogation que plus personne ne relit.
2. **Un faux positif réel** : un réalisé de `−0,005 €` s'affiche « 0,01 € » via `absMoney`, que ni
   `display` (qui donne `−0,01`) ni `abs` seul (qui donne `0,005`) ne produisent — seule leur
   **composition**, que la liste fermée n'autorise pas. Traité **sans élargir la liste** : la
   valeur absolue d'une feuille négative devient une **ancre**, sous le même chemin, parce que
   c'est ce que le rendu fait réellement — `abs()` s'applique à la donnée, avant le formatage.
3. **Une collision qu'il a fallu nommer** dans la propriété de falsifiabilité : un montant déplacé
   d'un centime qui tombe pile sur un multiple de dix centimes s'ancre **légitimement** à sa
   source, `roundHalfUp(s, 0)` et `roundHalfUp(s, 1)` étant des rendus déclarés. La propriété
   écarte ce cas et l'explique, plutôt que de le cacher.

## Ce qui est vérifié

- `src/lib/ai/numbers.test.ts` — le constat empirique sur `Intl`, les quatre séparateurs, les
  signes, les parenthèses comptables, les échelles, les exclusions, et l'aller-retour avec
  `fmtMoney` / `fmtPct` / `fmtPoints` / `fmtQty`.
- `src/lib/ai/anchor.test.ts` — chaque dérivation, chaque motif de refus, et le fait que la liste
  compte exactement cinq entrées.
- `src/lib/ai/anchor.property.test.ts` — la propriété centrale et les deux propriétés d'appui.
- `src/lib/ai/contract.test.ts` — l'exhaustivité des motifs, l'invariant `ok ⟹ audit vide`.
- `src/lib/ai/adapters/recorded.test.ts` — la clé, la provenance obligatoire, l'absence de réseau.
- `src/lib/format/lexicon.test.ts` et `src/lib/format/second-opinion.lexicon.test.ts`.
- `tests/integration/ai-harness.test.ts` — le banc d'essai complet.

## P65 — le premier vrai modèle, et ce qu'il a fallu ajouter

### Le pipeline est fixe, et il est le même partout

appel → texte vide ? `empty` → lexique (**les quatre domaines**) → `forbidden-lexicon` → ancrage
(`auditText`, **sans aucun `literals`**) → tout audit non vide devient `unanchored` → étiquette.
Sinon **refus, texte jeté entier**, repli sur `insightsToText`.

L'ordre n'est pas indifférent : le lexique passe **avant** l'ancrage, parce qu'une phrase de
conseil parfaitement ancrée reste une phrase de conseil, et que c'est ce motif-là qu'on veut lire
quand les deux échouent.

**Aucun `literals` n'est accordé au modèle.** Les constantes de gabarit — le seuil de 305 €, la
fenêtre de douze mois, le 100 % du repère — sont une dérogation réservée à _notre_ rendu
déterministe, dont les phrases sont relues et versionnées. Les accorder au modèle blanchirait
d'avance un nombre inventé qui tomberait dessus par hasard.

Le banc d'essai appelle désormais `judgeNarrative`, **le pipeline livré**, au lieu d'en tenir une
copie. C'était sa faiblesse discrète : il vérifiait sa propre réimplémentation des règles, donc un
pipeline qui aurait oublié le lexique serait resté vert.

### Les totaux sont dans l'entrée, par nécessité

La charge utile est `{ devise, periode, totaux, constats:[{code,tone,values}] }` — et rien d'autre :
ni ligne d'opération, ni lot, ni date d'opération, ni adresse, ni compte. Les **totaux** y figurent
parce que le modèle n'a droit à aucune addition (décision n° 68) : tout chiffre citable doit être
une **ancre**. L'alternative — le laisser additionner deux constats — produirait un chiffre juste
que le vérificateur refuserait, et la seule façon de le faire passer serait d'autoriser
l'arithmétique, c'est-à-dire de laisser l'IA entrer dans le calcul.

### Deux identités de modèle

`MODEL = 'handwritten/p70'` est une **fiction** : les cassettes écrites à la main ne viennent
d'aucun modèle, et leur prêter un identifiant réel serait le premier pas vers une capture qu'on ne
saurait plus distinguer d'une rédaction. `CAPTURED_MODEL` est le vrai modèle. Le modèle entrant
dans la clé, une cassette capturée porte une **autre empreinte**, et le banc d'essai la préfère dès
qu'elle existe — sans qu'on touche à un test. Avant la première capture, tout retombe sur les
cassettes manuscrites, sans rien signaler : il n'y a rien à signaler.

### `npm run ai:capture` — ce qu'il a le droit de lire

L'export réel de l'utilisateur vit à la **racine** du dépôt (ignoré par git). Un script de capture
qui accepterait un chemin en paramètre serait le chemin le plus court entre des données réelles et
une cassette committée. Donc : **aucun paramètre d'entrée** — le script refuse de démarrer s'il en
reçoit — et toute lecture passe par `readAllowed`, qui n'admet que `tests/fixtures/ai/cases/` et le
jeu de démonstration synthétique, sur des chemins **résolus**. La règle n'est pas dans un
commentaire, elle est dans une fonction.

**Trois tirages, tout ou rien.** Un modèle n'est pas déterministe : une capture unique mesurerait
la chance. Si l'un des trois échoue à l'ancrage ou au lexique, **rien n'est écrit** et le script
sort en erreur — un cas dont deux réponses sur trois passent n'est pas un cas qui passe. Un seul
tirage est committé, avec `source: 'fixture-capture'` ; trois seraient trois fois le même test.
Seuls les cas portant `"capture": true` sont concernés : les cassettes qui éprouvent un séparateur
de milliers ou une limite connue sont écrites à la main **exprès**, et une capture réelle leur
ferait perdre ce qu'elles testent.

Le script tourne sous `node --import ./scripts/ts-resolve.mjs` : Node exige une extension sur les
imports relatifs, le code de l'application n'en met pas, et le crochet de résolution comble l'écart
**uniquement pour les scripts qui le chargent** — ni l'application, ni la CI, ni les tests n'en
dépendent.

### L'étiquette, à l'écran et dans le presse-papier

La carte « Votre année en résumé » se distingue par **trois marques indépendantes** — bordure
pointillée, pastille textuelle « généré par IA », fond alternatif : jamais la seule couleur
(WCAG 2.2 AA, critère 1.4.1). Les attributs `data-ai-generated`, `data-ai-model` et `data-ai-at`
en donnent la version lisible par machine, choisie plutôt que suivie (aucune norme technique n'est
stabilisée — entrée `ai-act-marquage` de la veille réglementaire).

**Le presse-papier porte l'étiquette en préfixe.** Une mention qui ne vit que sur l'écran ne
protège que le lecteur qui savait déjà.

**Limite assumée de la v1 : le récit ne sort ni au PDF ni à l'impression.** Un rapport imprimé se
transmet — à un comptable, à un conseiller —, et un texte généré y voisinerait des chiffres
calculés sans que le lecteur suivant sache lequel est lequel. Le presse-papier est différent : le
colleur est celui qui a vu la carte.

## Ce qui reste à faire

- La **première capture réelle** : `15-recit-p65-nominal` porte encore une cassette **manuscrite**,
  faute d'avoir été capturée. Un `npm run ai:capture` la remplacera, et le banc d'essai basculera
  seul sur l'empreinte du vrai modèle.
- Les tâches `column-mapping` (P64) et `assistant` (P69), avec leur consigne système et leur repli
  propres — `TASK_FALLBACK` les attend.
- Un **choix de modèle** : `UiSettings.aiModelId` existe et vaut toujours `null` en v1. Chaque
  modèle supplémentaire multiplierait les cassettes, et un petit modèle qui échoue à l'ancrage
  produit un refus — sûr, mais sans valeur pour l'utilisateur.
