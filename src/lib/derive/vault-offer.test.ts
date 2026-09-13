/**
 * L'invite au coffre (décision n° 145) : un moment, pas une cryptographie.
 *
 * Les trois refus comptent autant que l'acceptation — proposer de chiffrer une démonstration ou un
 * état vide use la seule occasion qu'on aura de poser la question sur de vraies données.
 */
import { describe, expect, it } from 'vitest';
import { vaultOffer, type VaultOfferInput } from './vault-offer';

const input = (over: Partial<VaultOfferInput> = {}): VaultOfferInput => ({
  vaultInstalled: false,
  demoMode: false,
  hasData: true,
  ...over,
});

describe('vaultOffer — quand proposer le coffre', () => {
  it('propose quand il y a de vraies données en clair', () => {
    expect(vaultOffer(input())).toBe('offer');
  });

  it('se tait quand le coffre est déjà installé', () => {
    expect(vaultOffer(input({ vaultInstalled: true }))).toBe('installed');
  });

  it('se tait sur le jeu de démonstration, qui pourtant porte des données', () => {
    // C'est le cas qui justifie le module : `hasData` est vrai en démonstration, donc une simple
    // condition « il y a des données » proposerait de chiffrer du fictif (décision n° 14).
    expect(vaultOffer(input({ demoMode: true }))).toBe('demo');
  });

  it('se tait tant qu’il n’y a rien à protéger', () => {
    expect(vaultOffer(input({ hasData: false }))).toBe('no-data');
  });

  it('donne la priorité au coffre installé sur tout le reste', () => {
    // Un coffre installé pendant une démonstration ne doit pas produire d'invite non plus.
    expect(vaultOffer(input({ vaultInstalled: true, demoMode: true, hasData: false }))).toBe(
      'installed',
    );
  });

  it('n’a qu’une seule valeur qui affiche l’invite', () => {
    // Garde-fou de conception : si une valeur s'ajoute un jour, ce test rappelle que l'écran ne
    // doit afficher l'invite que sur `offer`, jamais « tout sauf installed ».
    const cases: VaultOfferInput[] = [
      input(),
      input({ vaultInstalled: true }),
      input({ demoMode: true }),
      input({ hasData: false }),
    ];
    expect(cases.filter((c) => vaultOffer(c) === 'offer')).toHaveLength(1);
  });
});
