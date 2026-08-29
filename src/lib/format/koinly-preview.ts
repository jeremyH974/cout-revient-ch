/**
 * Rendu français du décompte de portabilité (`src/lib/export/koinly-preview.ts`) : un code, une
 * phrase — le seul endroit qui sait les écrire. Aucun calcul ici, seulement de la mise en mots.
 */
import type { PortabilityGap } from '../export/koinly-preview';

const plural = (n: number, one: string, many: string): string => (n > 1 ? many : one);

export function fmtPortabilityGap(gap: PortabilityGap): string {
  const n = gap.count;
  switch (gap.code) {
    case 'migration-as-trade':
      return `${n} ${plural(
        n,
        'migration sera exportée comme un échange et se relira comme une vente',
        'migrations seront exportées comme des échanges et se reliront comme des ventes',
      )}.`;
    case 'accounts-merged':
      // Toujours ≥ 2 par construction (koinlyPortabilityPreview) : pas de forme au singulier.
      return `${n} comptes seront fusionnés en un seul.`;
    case 'opening-balance-cost-lost':
      // Sujet = « le coût » (toujours singulier), quel que soit le nombre de positions touchées.
      return `Le coût d'ouverture de ${n} position${n > 1 ? 's' : ''} ne sera pas conservé.`;
    case 'paired-transfers-lost':
      return `${n} ${plural(
        n,
        'virement interne apparié ne se reliera plus après réimport',
        'virements internes appariés ne se relieront plus après réimport',
      )}.`;
  }
}
