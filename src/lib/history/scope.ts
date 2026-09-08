/**
 * Périmètre d'une série d'évolution.
 *
 * **Le mot « portefeuille » avait cessé de vouloir dire la même chose pour tout le monde.** Tant
 * que l'application ne valorisait que des actifs numériques, `'portfolio'` désignait sans ambiguïté
 * l'ensemble. L'arrivée de la classe `equity` (décision n° 119) l'a élargi en silence, et deux
 * consommateurs se sont mis à lire plus que ce qu'ils voulaient :
 *
 * - la carte d'évolution de l'onglet **Crypto**, qui traçait les titres avec les cryptos ;
 * - la **valeur globale du portefeuille** servie à l'article 150 VH bis, dont l'assiette est celle
 *   des seuls actifs numériques — un dénominateur gonflé y **minore la plus-value imposable**.
 *
 * Aucun des deux ne produisait d'erreur : ils rendaient un chiffre, simplement pas le bon. D'où une
 * fonction pure, nommée et éprouvée à part, plutôt qu'un filtre enfoui dans une classe d'état.
 */
import type { PositionReport } from '../domain/engine';
import type { AssetCode } from '../domain/types';

/** `'portfolio'` = tout ce que l'application valorise ; les deux autres agrègent une classe. */
export type Scope = 'portfolio' | 'crypto' | 'equities' | AssetCode;

/** Un périmètre agrégé porte plusieurs actifs : ni quantité ni prix unitaire ne s'y définissent. */
export function isAggregate(scope: Scope): scope is 'portfolio' | 'crypto' | 'equities' {
  return scope === 'portfolio' || scope === 'crypto' || scope === 'equities';
}

/**
 * Positions du périmètre demandé.
 *
 * Les **stablecoins restent dans `'crypto'`** : ce sont des actifs numériques au sens du 150 VH bis,
 * et du cash en attente d'être investi au sens de l'écran. Les écarter donnerait une assiette
 * fiscale trop petite — l'erreur exactement inverse de celle que cette fonction corrige.
 */
export function positionsInScope(
  positions: readonly PositionReport[],
  scope: Scope,
): PositionReport[] {
  if (scope === 'portfolio') return [...positions];
  if (scope === 'crypto') return positions.filter((p) => p.assetClass !== 'equity');
  if (scope === 'equities') return positions.filter((p) => p.assetClass === 'equity');
  return positions.filter((p) => p.asset === scope);
}
