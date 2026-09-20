/**
 * Le registre canonique des cases (décision n° 147), **adossé** aux quatre registres locaux.
 *
 * Le dispositif est celui de la décision n° 90 : on ne supprime pas la duplication, on la rend
 * incapable de diverger. Un code ajouté dans un module sans l'être ici, ou un libellé qui bouge
 * d'un côté seulement, fait échouer `npm run check`.
 */
import { describe, expect, it } from 'vitest';
import { DIVIDEND_TAX_BOXES } from './equity-income-fr';
import { EQUITY_TAX_BOXES } from './equity-tax-fr';
import { INTEREST_TAX_BOXES } from './interest-income-fr';
import { TAX_BOXES as LENDING_BOXES } from './lending/tax-fr';
import { TAX_BOXES, TAX_BOXES_DELIBERATELY_ABSENT, taxBox, taxBoxCodes } from './tax-boxes';

/** Forme commune aux quatre registres locaux ; seul `sourceId` manque encore à celui des prêts. */
interface LocalBox {
  box: string;
  form: string;
  label: string;
  ref: string;
  sourceId?: string;
}

const locals: [string, Record<string, LocalBox>][] = [
  ['equity', EQUITY_TAX_BOXES],
  ['dividend', DIVIDEND_TAX_BOXES],
  ['interest', INTEREST_TAX_BOXES],
  ['lending', LENDING_BOXES],
];

/**
 * Le 2047 porte **trois** libellés, un par famille — « cadre 20 » pour les dividendes, « cadre 30 »
 * pour les intérêts, « cadre 3, à reporter en 3VG » pour les titres. Ce n'est pas une divergence à
 * corriger : le même formulaire se remplit à des cadres différents selon le revenu, et le dire est
 * une information. Seul son libellé échappe donc à la comparaison.
 */
const LABEL_IS_LOCAL = new Set(['2047']);

/** L'anomalie connue du registre des prêts : une plage là où le champ porte partout un code. */
const LENDING_RANGE = '2TU→2TY';

describe('registre canonique des cases', () => {
  it('ne déclare jamais deux fois le même code', () => {
    const codes = TAX_BOXES.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('connaît tous les codes des quatre registres locaux', () => {
    for (const [family, registry] of locals)
      for (const [key, local] of Object.entries(registry)) {
        const code = local.box === LENDING_RANGE ? '2TU' : local.box;
        expect(taxBox(code), `${family}.${key} (${local.box})`).not.toBeNull();
      }
  });

  /**
   * **Ce test n'avait rien à comparer pour les prêts, et une erreur est passée** (décision n° 149).
   * Le registre des prêts n'avait pas de `form` ; le registre canonique plaçait 2TT, 2CK et 2CG sur
   * la 2042 **C**, alors que le formulaire millésime 2026 les porte sur la **2042**. Un champ
   * facultatif est un garde-fou qui s'endort : il est désormais exigé.
   */
  it('porte le même formulaire et la même référence légale que les registres locaux', () => {
    for (const [family, registry] of locals)
      for (const [key, local] of Object.entries(registry)) {
        const code = local.box === LENDING_RANGE ? '2TU' : local.box;
        const canonical = taxBox(code)!;
        expect(canonical.ref, `${family}.${key} — référence`).toBe(local.ref);
        expect(local.form, `${family}.${key} — formulaire local absent`).not.toBe(undefined);
        expect(canonical.form, `${family}.${key} — formulaire`).toBe(local.form);
      }
  });

  /**
   * Le formulaire relevé sur les imprimés millésime 2026 eux-mêmes, code par code. C'est ce que
   * l'utilisateur ouvrira : se tromper de formulaire lui fait chercher une case qui n'y est pas.
   */
  it('place chaque case sur le formulaire que porte l’imprimé officiel', () => {
    const onForm: [string, string[]][] = [
      ['2042', ['2DC', '2TS', '2TR', '2TT', '2CK', '2BH', '2OP']],
      ['2042 C', ['8PL', '8VL', '3VG', '3VH', '3AN', '3BN', '3CN', '2TU']],
    ];
    for (const [form, codes] of onForm)
      for (const code of codes) expect(taxBox(code)!.form, code).toBe(form);
  });

  it('porte le même libellé, sauf pour le 2047 qui en a un par famille', () => {
    for (const [family, registry] of locals)
      for (const [key, local] of Object.entries(registry)) {
        if (LABEL_IS_LOCAL.has(local.box)) continue;
        const code = local.box === LENDING_RANGE ? '2TU' : local.box;
        expect(taxBox(code)!.label, `${family}.${key} — libellé`).toBe(local.label);
      }
  });

  it('n’ajoute que les codes qu’aucun module ne produisait, et rien d’autre', () => {
    // C'est l'autre sens du garde-fou : une entrée canonique orpheline serait du vocabulaire mort.
    const known = new Set(
      locals.flatMap(([, r]) =>
        Object.values(r).map((b) => (b.box === LENDING_RANGE ? '2TU' : b.box)),
      ),
    );
    const added = TAX_BOXES.map((b) => b.code).filter((c) => !known.has(c));
    expect(added.sort()).toEqual(['2086', '3916-bis', '3AN', '3BN', '3CN'].sort());
  });

  it('n’écrit aucun code dont le rattachement n’est pas établi', () => {
    for (const code of TAX_BOXES_DELIBERATELY_ABSENT) expect(taxBox(code)).toBeNull();
    // La liste est close : 2CG l'a rejointe le jour où la brochure a montré qu'elle ne couvre rien
    // de ce que cette application connaît (décision n° 150).
    expect([...TAX_BOXES_DELIBERATELY_ABSENT]).toEqual(['8UU', '8TT', '2CG']);
  });

  it('marque « souvent pré-rempli » la seule case qu’un imprimé fiscal français alimente', () => {
    const prefilled = TAX_BOXES.filter((b) => b.entry === 'prefilled').map((b) => b.code);
    expect(prefilled).toEqual(['2TT', '2BH']);
  });

  /**
   * Les cinq entrées ajoutées n'ont aucun équivalent local : l'adossement ci-dessus ne les regarde
   * donc jamais. Le test de mutation l'a vu tout de suite — 68 mutants survivaient dans ce fichier,
   * chacun remplaçant un libellé, un formulaire ou une référence par « » (décision n° 147). Ce sont
   * des codes que l'utilisateur recopiera : ils se vérifient un par un, en entier.
   */
  it('décrit en entier les cinq entrées que ce registre est seul à porter', () => {
    expect(taxBox('2086')).toEqual({
      code: '2086',
      kind: 'form',
      form: '2086',
      label: 'Détail des cessions de crypto-actifs, une ligne par cession',
      ref: 'CGI art. 150 VH bis',
      sourceId: 'seuil-305',
      entry: 'typed',
    });
    expect(taxBox('3AN')).toEqual({
      code: '3AN',
      kind: 'box',
      form: '2042 C',
      label: 'Plus-value de cession de crypto-actifs de l’année',
      ref: 'CGI art. 150 VH bis',
      sourceId: 'pfu-31_4',
      entry: 'carried',
      entryNote:
        'En ligne, l’annexe la remplit : « Le montant renseigné remplira automatiquement la case 3AN (plus-value) ou 3BN (moins-value) ». Sur papier, la ligne 52 du 2086 dit « à reporter ligne 3AN de la 2042 C » — c’est alors à vous de l’écrire.',
    });
    expect(taxBox('3BN')).toEqual({
      code: '3BN',
      kind: 'box',
      form: '2042 C',
      label: 'Moins-value de l’année — imputable sur les seules plus-values de même nature',
      ref: 'CGI art. 150 VH bis',
      sourceId: 'pfu-31_4',
      entry: 'carried',
      entryNote:
        'En ligne, l’annexe la remplit : « Le montant renseigné remplira automatiquement la case 3AN (plus-value) ou 3BN (moins-value) ». Sur papier, la ligne 52 du 2086 dit « à reporter ligne 3BN de la 2042 C » — c’est alors à vous de l’écrire.',
    });
    expect(taxBox('3CN')).toEqual({
      code: '3CN',
      kind: 'checkbox',
      form: '2042 C',
      label: 'Option pour le barème progressif, propre aux crypto-actifs',
      // Le 200 C, pas le 200 A : c'est l'article de la case 3CN, et le seul des deux qui dise
      // encore « irrévocable » (décision n° 168).
      ref: 'CGI art. 200 C',
      sourceId: 'bareme-actifs-numeriques',
      entry: 'typed',
      entryNote:
        'Une case à cocher, sans montant : « n’oubliez pas de cocher la case 3CN de la 2042 C » (notice 2086). Distincte de la case 2OP, qui porte sur les revenus de capitaux mobiliers et les cessions de valeurs mobilières.',
    });
    expect(taxBox('3916-bis')).toEqual({
      code: '3916-bis',
      kind: 'form',
      form: '3916-bis',
      label: 'Comptes de crypto-actifs ouverts, détenus, utilisés ou clos à l’étranger',
      ref: 'CGI art. 1649 bis C',
      sourceId: 'delai-reprise-10-ans',
      entry: 'typed',
    });
  });

  it('donne à chaque entrée un formulaire, un libellé et une référence non vides', () => {
    for (const box of TAX_BOXES) {
      expect(box.form, `${box.code} — formulaire`).not.toBe('');
      expect(box.label, `${box.code} — libellé`).not.toBe('');
      expect(box.ref, `${box.code} — référence`).not.toBe('');
      // Un `sourceId` présent doit pointer quelque part : `tax-source.test.ts` croise déjà les
      // identifiants avec la table de veille, mais rien n'interdisait la chaîne vide.
      if (box.sourceId !== undefined) expect(box.sourceId, `${box.code} — veille`).not.toBe('');
      if (box.entryNote !== undefined) expect(box.entryNote, `${box.code} — nuance`).not.toBe('');
    }
  });

  /**
   * Une case à **cocher** ne porte aucun montant : afficher un chiffre à recopier à côté d'elle
   * ferait écrire un nombre là où il n'en faut aucun (décision n° 149). La liste est close — une
   * case à montant reclassée `checkbox` par erreur ferait disparaître son montant de l'écran.
   */
  it('ne compte que deux cases à cocher, et ce sont les deux options pour le barème', () => {
    const checkboxes = TAX_BOXES.filter((b) => b.kind === 'checkbox').map((b) => b.code);
    expect(checkboxes).toEqual(['3CN', '2OP']);
  });

  /**
   * Le troisième membre du triplet `kind` (`box`/`checkbox` ci-dessus, `form` ici) : ce sont les
   * seules entrées qui ouvrent un formulaire au lieu d'une case à recopier. Cinq des huit codes
   * ajoutés par ce registre (2047, 2074, 2074-CMV, 2086, 3916-bis) portent un équivalent local dont
   * la forme (`{ box, form, label, ref, sourceId }`) ne connaît pas `kind` : l'adossement ci-dessus
   * ne les croise donc jamais sur ce champ, contrairement à `entry` et au libellé.
   */
  it('n’ouvre un formulaire, jamais une case à recopier, que pour les annexes', () => {
    const forms = TAX_BOXES.filter((b) => b.kind === 'form').map((b) => b.code);
    expect(forms).toEqual(['2047', '2074', '2074-CMV', '2086', '3916-bis']);
  });

  it('donne un montant à toute case qui n’est ni une annexe ni une option', () => {
    // L'autre sens : `kind: 'box'` doit rester la règle, et `form`/`checkbox` l'exception.
    const amounts = TAX_BOXES.filter((b) => b.kind === 'box').map((b) => b.code);
    expect(amounts).toEqual([
      '2DC',
      '2TS',
      '2TR',
      '8PL',
      '8VL',
      '3VG',
      '3VH',
      '3AN',
      '3BN',
      '2TT',
      '2CK',
      '2BH',
      '2TU',
    ]);
  });

  /**
   * `entry` seul ferait dire à l'écran « l'annexe la remplit » là où ce n'est vrai qu'en ligne, ou
   * pas établi du tout. Ces nuances sont la moitié de l'utilité de l'écran : elles se vérifient.
   */
  it('nuance le report exactement là où la source le nuance, et nulle part ailleurs', () => {
    const noted = TAX_BOXES.filter((b) => b.entryNote !== undefined).map((b) => b.code);
    expect(noted).toEqual(['8PL', '3VG', '3VH', '3AN', '3BN', '3CN', '2TT', '2BH', '2OP']);
    expect(taxBox('8PL')!.entryNote).toBe(
      'La notice 2047 millésime 2026 écrit que ce montant « doit être indiqué en 8PL, puis reporté dans la 2042 C » : il se calcule sur l’annexe, et c’est de là qu’il vient.',
    );
    for (const code of ['3VG', '3VH'])
      expect(taxBox(code)!.entryNote, code).toBe(
        'Le report automatique depuis la 2074 n’est affirmé par aucune source primaire relue ici : vérifiez la case après avoir validé l’annexe, et ne la saisissez que si elle est restée vide.',
      );
    expect(taxBox('2OP')!.entryNote).toBe(
      'Une case à cocher, sans montant, et une décision que cette application ne prend pas : elle porte sur l’ensemble du foyer, dont elle ne connaît ni les autres revenus ni le taux marginal. Distincte de la case 3CN, propre aux crypto-actifs.',
    );
  });

  it('rend `null` pour un code inconnu, jamais une entrée par défaut', () => {
    expect(taxBox('9ZZ')).toBeNull();
    expect(taxBox('')).toBeNull();
  });
});

describe('l’ordre du registre suit les dépendances du parcours', () => {
  const index = (code: string): number => TAX_BOXES.findIndex((b) => b.code === code);

  it('place chaque annexe avant les cases qu’elle alimente', () => {
    // C'est la raison d'être de l'ordre : remplir 2047 après avoir vérifié 2DC écraserait un
    // montant déjà juste, et saisir 3AN avant le 2086 ferait recopier une case qui se remplit seule.
    const dependencies: [string, string[]][] = [
      ['2047', ['2DC', '2TS', '2TR', '8PL', '8VL']],
      ['2074', ['3VG', '3VH']],
      ['2086', ['3AN', '3BN']],
    ];
    for (const [form, boxes] of dependencies)
      for (const box of boxes)
        expect(index(form), `${form} doit précéder ${box}`).toBeLessThan(index(box));
  });

  it('marque « reporté » toute case qu’une annexe remplit, jamais « à saisir »', () => {
    for (const code of ['2DC', '2TS', '2TR', '8PL', '8VL', '3VG', '3VH', '3AN', '3BN'])
      expect(taxBox(code)!.entry, code).toBe('carried');
  });

  /**
   * L'énoncé précédent ne citait que six des neuf cases `typed` — les annexes et les options —,
   * jamais 2074-CMV, 2CK ou 2TU : ni annexe ni option, mais une case sans report automatique, donc
   * elle aussi à la charge de l'utilisateur. L'adossement plus haut ne le croise pas non plus,
   * `entry` étant absent de la forme des registres locaux. D'où une liste EXHAUSTIVE (comme pour
   * `checkbox` et `prefilled` ci-dessus), pas une énumération partielle.
   */
  it('marque « à saisir » toute case sans report automatique — annexes, options, et le reste', () => {
    const typed = TAX_BOXES.filter((b) => b.entry === 'typed').map((b) => b.code);
    expect(typed).toEqual([
      '2047',
      '2074',
      '2074-CMV',
      '2086',
      '3CN',
      '2CK',
      '2TU',
      '2OP',
      '3916-bis',
    ]);
  });
});

describe('taxBoxCodes — une plage n’est pas un code', () => {
  it('déplie 2TU jusqu’à 2TY', () => {
    expect(taxBoxCodes(taxBox('2TU')!)).toEqual(['2TU', '2TV', '2TW', '2TX', '2TY']);
  });

  it('rend un seul code quand il n’y a pas de plage', () => {
    expect(taxBoxCodes(taxBox('3VG')!)).toEqual(['3VG']);
  });
});
