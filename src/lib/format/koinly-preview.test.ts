/** Rendu français du décompte de portabilité : une phrase par code, singulier et pluriel. */
import { describe, expect, it } from 'vitest';
import { fmtPortabilityGap } from './koinly-preview';

describe('fmtPortabilityGap', () => {
  it('migration-as-trade : singulier et pluriel', () => {
    expect(fmtPortabilityGap({ code: 'migration-as-trade', count: 1 })).toBe(
      '1 migration sera exportée comme un échange et se relira comme une vente.',
    );
    expect(fmtPortabilityGap({ code: 'migration-as-trade', count: 3 })).toBe(
      '3 migrations seront exportées comme des échanges et se reliront comme des ventes.',
    );
  });

  it('accounts-merged : toujours au pluriel (jamais un seul compte)', () => {
    expect(fmtPortabilityGap({ code: 'accounts-merged', count: 2 })).toBe(
      '2 comptes seront fusionnés en un seul.',
    );
  });

  it('opening-balance-cost-lost : « le coût » reste singulier quel que soit le nombre de positions', () => {
    expect(fmtPortabilityGap({ code: 'opening-balance-cost-lost', count: 1 })).toBe(
      "Le coût d'ouverture de 1 position ne sera pas conservé.",
    );
    expect(fmtPortabilityGap({ code: 'opening-balance-cost-lost', count: 2 })).toBe(
      "Le coût d'ouverture de 2 positions ne sera pas conservé.",
    );
  });

  it('paired-transfers-lost : singulier et pluriel', () => {
    expect(fmtPortabilityGap({ code: 'paired-transfers-lost', count: 1 })).toBe(
      '1 virement interne apparié ne se reliera plus après réimport.',
    );
    expect(fmtPortabilityGap({ code: 'paired-transfers-lost', count: 2 })).toBe(
      '2 virements internes appariés ne se relieront plus après réimport.',
    );
  });
});
