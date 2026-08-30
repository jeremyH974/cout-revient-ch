import { describe, expect, it } from 'vitest';
import {
  DERIVATION_IDS,
  anchorCoverage,
  auditText,
  collectAnchors,
  isAnchored,
  type DeclaredLiteral,
} from './anchor';
import { NARROW_NBSP, NBSP } from './numbers';

/** Espaces insécables → espace simple, pour écrire les attendus sans caractère invisible. */
const SPACES = new RegExp(`[${NARROW_NBSP}${NBSP}]`, 'g');

const reasons = (text: string, source: unknown): string[] =>
  auditText(text, source).unanchored.map(
    (u) => `${u.token.raw.replace(SPACES, ' ')} → ${u.reason}`,
  );

describe('collectAnchors', () => {
  it('ne retient que les feuilles décimales, avec leur chemin', () => {
    const anchors = collectAnchors({
      code: 'fees-12m',
      values: { amount: '1284.37', rate: '0.0041', label: 'frais' },
      counts: [7, 12],
    });
    expect(anchors.map((a) => `${a.path}=${a.value.toString()}`)).toEqual([
      'values.amount=1284.37',
      'values.rate=0.0041',
      'counts[0]=7',
      'counts[1]=12',
    ]);
    expect(anchors.map((a) => a.kind)).toEqual(['decimal', 'decimal', 'integer', 'integer']);
  });

  it('ajoute la valeur absolue d’une feuille négative, sous le même chemin', () => {
    const anchors = collectAnchors({ amount: '-2310.5' });
    expect(anchors.map((a) => a.value.toString())).toEqual(['-2310.5', '2310.5']);
    expect(new Set(anchors.map((a) => a.path)).size).toBe(1);
  });

  it('ignore ce qui n’est pas une grandeur : libellés, booléens, dates', () => {
    const anchors = collectAnchors({ day: '2026-08-30', ok: true, tier: 'investisseur' });
    expect(anchors).toEqual([]);
  });

  it('déclare les constantes du gabarit avec leur raison et leur genre', () => {
    const literals: DeclaredLiteral[] = [{ value: '305', why: 'seuil légal', kind: 'money' }];
    const anchors = collectAnchors({}, { literals });
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.path).toBe('literal:seuil légal');
    expect(anchors[0]?.appliesTo).toBe('money');
  });
});

describe('la liste des dérivations reste fermée', () => {
  // Ce test n'est pas décoratif : élargir la liste pour absorber un faux positif blanchirait
  // l'arithmétique d'un modèle. Toute nouvelle entrée doit être une décision, pas un réflexe.
  it('déclare exactement cinq dérivations, dans cet ordre', () => {
    expect(DERIVATION_IDS).toEqual(['exact', 'display', 'percent', 'abbrev', 'abs']);
  });
});

describe('auditText — ce qui est ancré', () => {
  it('accepte la valeur exacte', () => {
    expect(
      auditText(`Frais ${NARROW_NBSP}1${NARROW_NBSP}284,37${NBSP}€.`, { a: '1284.37' }).unanchored,
    ).toEqual([]);
  });

  it('accepte un arrondi d’affichage déclaré', () => {
    const report = auditText(`Frais 1${NARROW_NBSP}284,37${NBSP}€.`, { a: '1284.3712' });
    expect(report.unanchored).toEqual([]);
    expect(report.matched[0]?.derivation).toBe('display');
  });

  it('accepte un pourcentage tiré d’un ratio', () => {
    const report = auditText(`Part 12,3${NBSP}%.`, { a: '0.1234' });
    expect(isAnchored(report)).toBe(true);
  });

  it('accepte un abrégé en milliers, et refuse le même nombre lu à l’unité', () => {
    expect(auditText('Total 12,3 k€.', { a: '12345.67' }).unanchored).toEqual([]);
    // Sans le retour à l'unité de `abbrev`, « 12 345 k€ » s'ancrerait à 12 345 € : mille fois trop.
    expect(reasons(`Total 12${NARROW_NBSP}345 k€.`, { a: '12345' })).toEqual([
      '12 345 k€ → derivation-not-declared',
    ]);
  });

  it('accepte une valeur absolue, la phrase portant déjà le sens', () => {
    const report = auditText(`Vos ventes totalisent 2${NARROW_NBSP}310,50${NBSP}€.`, {
      a: '-2310.5',
    });
    expect(isAnchored(report)).toBe(true);
  });

  it('compare par égalité décimale, pas par chaîne : 0,120 vaut 0,12', () => {
    expect(auditText(`Ratio 0,120.`, { a: '0.12' }).unanchored).toEqual([]);
  });

  it('écarte du contrôle les dates, heures et rangs', () => {
    const report = auditText('Du 24/06/2026 à 18:55, ligne 42.', {});
    expect(report.checked).toEqual([]);
    expect(report.excluded).toHaveLength(3);
    expect(isAnchored(report)).toBe(true);
  });
});

describe('auditText — ce qui est refusé, et sous quel nom', () => {
  it('nomme « not-in-source » un nombre qui ne ressemble à rien de la source', () => {
    expect(reasons(`Remises 4${NARROW_NBSP}200,00${NBSP}€.`, { a: '1284.37' })).toEqual([
      '4 200,00 € → not-in-source',
    ]);
  });

  it('nomme « derivation-not-declared » un total recomposé par le modèle', () => {
    // Arbitrage : refaire une somme juste reste un refus. Le total appartient au JSON d'entrée.
    expect(
      reasons(`Ensemble 3${NARROW_NBSP}594,87${NBSP}€.`, { a: '1284.37', b: '2310.5' }),
    ).toEqual(['3 594,87 € → derivation-not-declared']);
  });

  it('nomme « derivation-not-declared » une quantité tronquée', () => {
    expect(reasons('Solde 0,1234 BTC.', { a: '0.123456789' })).toEqual([
      '0,1234 BTC → derivation-not-declared',
    ]);
  });

  it('nomme « derivation-not-declared » une échelle décalée', () => {
    expect(
      reasons(`Total 1${NARROW_NBSP}284${NARROW_NBSP}370,00${NBSP}€.`, { a: '1284.37' }),
    ).toEqual(['1 284 370,00 € → derivation-not-declared']);
  });

  it('refuse qu’une constante déclarée pour un pourcentage blanchisse un montant', () => {
    const literals: DeclaredLiteral[] = [{ value: '1', why: 'repère 100 %', kind: 'percent' }];
    expect(auditText(`Repère 100${NBSP}%.`, {}, { literals }).unanchored).toEqual([]);
    expect(auditText(`Montant 1,00${NBSP}€.`, {}, { literals }).unanchored).toHaveLength(1);
  });
});

describe('anchorCoverage', () => {
  it('mesure la part des ancres réellement citées, sans compter deux fois une valeur absolue', () => {
    const report = auditText(`Frais 1${NARROW_NBSP}284,37${NBSP}€.`, {
      a: '1284.37',
      b: '-2310.5',
    });
    expect(anchorCoverage(report)).toBeCloseTo(0.5, 10);
  });

  it('vaut 1 quand la source ne porte aucun chiffre', () => {
    expect(anchorCoverage(auditText('Aucun chiffre ici.', {}))).toBe(1);
  });
});
