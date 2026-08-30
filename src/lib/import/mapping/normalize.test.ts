import { describe, expect, it } from 'vitest';
import { normalizeHeader, segmentGlued, SEGMENT_VOCABULARY } from './normalize';

describe('normalisation des en-têtes', () => {
  it('dépose les accents et met en minuscules', () => {
    expect(normalizeHeader('Quantité vendue').text).toBe('quantite vendue');
    expect(normalizeHeader('OPÉRATION').text).toBe('operation');
    expect(normalizeHeader('Contrepartie reçue').text).toBe('contrepartie recue');
  });

  it('ramène séparateurs et apostrophes à l’espace', () => {
    expect(normalizeHeader('Date_UTC').text).toBe('date utc');
    expect(normalizeHeader('Fee-Amount').text).toBe('fee amount');
    expect(normalizeHeader('net.worth/amount').text).toBe('net worth amount');
    expect(normalizeHeader("Prix d'achat").text).toBe('prix d achat');
  });

  it('écrase les espaces multiples, y compris les insécables', () => {
    expect(normalizeHeader('  Sent   Amount ').text).toBe('sent amount');
    // Écrits en échappement : un séparateur invisible dans un fichier source est un piège de
    // relecture (même convention que les cassettes du harnais). U+00A0 puis U+202F, les deux
    // que `Intl` en français produit (voir `src/lib/ai/numbers.ts`).
    expect(normalizeHeader('Sent\u00a0Amount').text).toBe('sent amount');
    expect(normalizeHeader('Sent\u202fAmount').text).toBe('sent amount');
  });

  it('extrait les parenthèses en jetons d’indice plutôt que de les ignorer', () => {
    const utc = normalizeHeader('Date (UTC)');
    expect(utc.text).toBe('date');
    expect(utc.hints).toEqual(['utc']);
    const gross = normalizeHeader('Gross Amount (EUR)');
    expect(gross.text).toBe('gross amount');
    expect(gross.hints).toEqual(['eur']);
    // Deux colonnes qui ne diffèrent QUE par leur parenthèse restent distinguables.
    expect(normalizeHeader('Gross Amount (CCY)').hints).toEqual(['ccy']);
    expect(normalizeHeader('Gross Amount (EUR)').text).toBe(
      normalizeHeader('Gross Amount (CCY)').text,
    );
  });

  it('accepte crochets et accolades comme parenthèses', () => {
    expect(normalizeHeader('Montant [EUR]').hints).toEqual(['eur']);
    expect(normalizeHeader('Montant {net}').hints).toEqual(['net']);
  });

  it('déplie les collages sur le vocabulaire connu', () => {
    expect(normalizeHeader('sentamount').text).toBe('sent amount');
    expect(normalizeHeader('receivedcurrency').text).toBe('received currency');
    expect(normalizeHeader('dateheure').text).toBe('date heure');
    expect(normalizeHeader('feeamount').text).toBe('fee amount');
  });

  it('ne déplie pas ce qu’il ne reconnaît pas, plutôt que d’inventer une découpe', () => {
    expect(segmentGlued('zorglubmachin')).toBeNull();
    expect(normalizeHeader('zorglubmachin').text).toBe('zorglubmachin');
    // Un mot du vocabulaire n'est jamais recoupé en morceaux.
    expect(segmentGlued('description')).toBeNull();
    expect(normalizeHeader('description').text).toBe('description');
  });

  it('laisse les mots courts intacts (le dépliage ne s’applique qu’au-delà de six lettres)', () => {
    expect(segmentGlued('date')).toBeNull();
    expect(segmentGlued('typo')).toBeNull();
  });

  it('garde l’en-tête d’origine intact : c’est lui qu’on montre à l’utilisateur', () => {
    expect(normalizeHeader('  Contre-valeur (EUR)  ').raw).toBe('Contre-valeur (EUR)');
  });

  it('n’a aucun doublon dans son vocabulaire de segmentation', () => {
    expect(new Set(SEGMENT_VOCABULARY).size).toBe(SEGMENT_VOCABULARY.length);
  });
});
