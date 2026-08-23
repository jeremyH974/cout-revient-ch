import { describe, expect, it } from 'vitest';
import type { UnqualifiedLeg } from '../../domain/types';
import { autoKind, normalizeType, rowTypeHint, suggestQualification } from './row-types';

const leg = (signedQty: string, asset = 'sol'): UnqualifiedLeg => ({
  asset,
  signedQty,
  valueEur: null,
});

describe('normalizeType', () => {
  it('retire accents et casse, compacte les espaces', () => {
    expect(normalizeType('Récompense')).toBe('recompense');
    expect(normalizeType('  Mise   en   Staking  ')).toBe('mise en staking');
  });
});

describe('rowTypeHint', () => {
  it('reconnaît les libellés exacts confirmés (auto)', () => {
    expect(rowTypeHint('Dépôt')).toMatchObject({ kind: 'deposit', mode: 'auto' });
    expect(rowTypeHint('Retrait')).toMatchObject({ kind: 'withdrawal', mode: 'auto' });
    expect(rowTypeHint('Récompense')).toMatchObject({ kind: 'reward', mode: 'auto' });
  });

  it('reconnaît les libellés exacts probables (suggest, non confirmés)', () => {
    expect(rowTypeHint('Mise en staking')).toMatchObject({ kind: 'ignore', mode: 'suggest' });
  });

  it('retombe sur les familles de mots pour un libellé exact inconnu (toujours suggest)', () => {
    // « Récompense de staking SOL » ne correspond à aucun libellé exact, mais contient le mot
    // « récompense » : la famille « reward » est testée avant la famille « staking » dans
    // PATTERNS, donc c'est elle qui l'emporte.
    expect(rowTypeHint('Récompense de staking SOL')).toMatchObject({
      kind: 'reward',
      mode: 'suggest',
    });
  });

  it('ne reconnaît « cadeau » qu’en libellé exact, jamais par famille de mots', () => {
    // « cadeau » est dans ROW_TYPE_HINTS (libellé exact) mais n'a pas de famille dans PATTERNS :
    // un libellé qui ne correspond pas mot pour mot à « cadeau » n'est donc pas reconnu.
    expect(rowTypeHint('Cadeau')).toMatchObject({ kind: 'reward', mode: 'suggest' });
    expect(rowTypeHint('Cadeau de Noël')).toBeNull();
  });

  it('renvoie null pour un libellé totalement inconnu', () => {
    expect(rowTypeHint('Transfert interne')).toBeNull();
  });
});

describe('autoKind', () => {
  it('renvoie le type pour les libellés exacts en mode auto', () => {
    expect(autoKind('Dépôt')).toBe('deposit');
    expect(autoKind('Récompense')).toBe('reward');
    expect(autoKind('Retrait')).toBe('withdrawal');
  });

  it('renvoie null pour un libellé exact en mode suggest (non confirmé)', () => {
    // « staking » seul n'est plus interprété automatiquement : à confirmer par l'utilisateur.
    expect(autoKind('staking')).toBeNull();
    expect(autoKind('Mise en staking')).toBeNull();
    expect(autoKind('Cadeau')).toBeNull();
  });

  it('renvoie null pour un libellé reconnu seulement par famille de mots', () => {
    // Les familles de mots (PATTERNS) sont toujours en mode suggest : autoKind ne consulte que
    // ROW_TYPE_HINTS (les libellés exacts), jamais PATTERNS.
    expect(autoKind('Récompense de staking SOL')).toBeNull();
  });

  it('renvoie null pour un libellé totalement inconnu', () => {
    expect(autoKind('Transfert interne')).toBeNull();
  });
});

describe('suggestQualification', () => {
  it('propose une récompense seulement pour une jambe unique positive', () => {
    expect(suggestQualification('Récompense de staking SOL', [leg('0.5')])).toEqual({
      kind: 'reward',
      fairValueEur: null,
    });
    expect(suggestQualification('Récompense de staking SOL', [leg('-0.5')])).toBeNull();
  });

  it('propose un retrait seulement pour une jambe unique négative', () => {
    expect(suggestQualification('Retrait', [leg('-0.5')])).toEqual({
      kind: 'withdrawal',
      proceedsEur: null,
    });
    expect(suggestQualification('Retrait', [leg('0.5')])).toBeNull();
  });

  it('propose un dépôt seulement pour une jambe unique positive', () => {
    expect(suggestQualification('Dépôt', [leg('0.5')])).toEqual({
      kind: 'deposit',
      costEur: null,
    });
    expect(suggestQualification('Dépôt', [leg('-0.5')])).toBeNull();
  });

  it('propose ignorer quel que soit le signe ou le nombre de jambes', () => {
    expect(suggestQualification('Staking', [leg('0.5')])).toEqual({ kind: 'ignore' });
    expect(suggestQualification('Staking', [leg('-0.5')])).toEqual({ kind: 'ignore' });
    expect(suggestQualification('Staking', [leg('0.5'), leg('-0.5', 'eur')])).toEqual({
      kind: 'ignore',
    });
  });

  it('ne propose rien pour un événement à deux jambes (hors ignorer)', () => {
    expect(
      suggestQualification('Récompense de staking SOL', [leg('0.5'), leg('-0.5', 'eur')]),
    ).toBeNull();
    expect(suggestQualification('Dépôt', [leg('0.5'), leg('-0.5', 'eur')])).toBeNull();
  });

  it('ne propose rien pour un libellé non reconnu', () => {
    expect(suggestQualification('Transfert interne', [leg('0.5')])).toBeNull();
  });
});
