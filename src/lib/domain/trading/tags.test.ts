import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_LIST, MAX_TEXT } from '../../storage/schema';
import { emptyJournalEntry, type JournalEntry } from './journal';
import {
  MAX_TAGS,
  MAX_TAG_LABEL_LENGTH,
  addTag,
  normalizeTagLabel,
  removeTag,
  renameTag,
  tagKey,
  tagSuggestions,
  tagUsage,
} from './tags';

const entry = (tags: string[]): JournalEntry => ({ ...emptyJournalEntry('t'), tags });
const journalOf = (...tagLists: string[][]): Record<string, JournalEntry> => {
  const record: Record<string, JournalEntry> = {};
  tagLists.forEach((tags, i) => {
    record[`t${i}`] = entry(tags);
  });
  return record;
};

describe('plafonds — cohérence avec le schéma', () => {
  it('MAX_TAGS et MAX_TAG_LABEL_LENGTH valent MAX_LIST et MAX_TEXT du schéma (storage/schema.ts)', () => {
    expect(MAX_TAGS).toBe(MAX_LIST);
    expect(MAX_TAG_LABEL_LENGTH).toBe(MAX_TEXT);
  });
});

describe('normalizeTagLabel', () => {
  it('trim, espaces internes réduits à un seul, casse affichée conservée', () => {
    expect(normalizeTagLabel('  Breakout    Range  ')).toBe('Breakout Range');
  });

  it('tronque au plafond', () => {
    expect(normalizeTagLabel('x'.repeat(200))).toHaveLength(MAX_TAG_LABEL_LENGTH);
  });

  it('propriété : idempotente', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const once = normalizeTagLabel(s);
        expect(normalizeTagLabel(once)).toBe(once);
      }),
    );
  });
});

describe('tagKey', () => {
  it('insensible à la casse et aux accents : trois variantes, une seule clé', () => {
    const k = tagKey('Breakout');
    expect(tagKey('breakout')).toBe(k);
    expect(tagKey('BRÉAKOUT')).toBe(k);
    expect(tagKey('  bréakout  ')).toBe(k);
  });

  it('propriété : idempotente', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const once = tagKey(s);
        expect(tagKey(once)).toBe(once);
      }),
    );
  });
});

describe('addTag', () => {
  it('ignore une saisie vide ou blanche', () => {
    expect(addTag(['A'], '   ')).toEqual(['A']);
  });

  it('ne double jamais une clé déjà présente ; garde la première casse écrite', () => {
    const once = addTag([], 'Breakout');
    const twice = addTag(once, 'breakout');
    const thrice = addTag(twice, 'BRÉAKOUT');
    expect(thrice).toEqual(['Breakout']);
  });

  /*
   * CONTRE-ÉPREUVE (décision n° 75, règle du dépôt) : la garde de dédoublonnage d'`addTag`
   * (`if (tags.some((t) => tagKey(t) === key)) return [...tags];`) a été RETIRÉE le temps de la
   * vérifier. Le test ci-dessus est passé au ROUGE en nommant la faute :
   *   expected [ 'Breakout', 'breakout', 'BRÉAKOUT' ] to deeply equal [ 'Breakout' ]
   * (les trois variantes de casse/accent toutes ajoutées comme des tags distincts). La propriété
   * « jamais deux tags de même clé » plus bas n'a PAS rougi sur ce même run — fast-check n'a pas
   * généré de collision de clé par hasard dans ses ~100 tirages — ce qui montre que l'exemple ciblé
   * est ici le VRAI filet, la propriété restant une garantie générale complémentaire. La garde a
   * ensuite été restaurée et le test revérifié vert.
   */

  it('plafonne à MAX_TAGS : les premiers survivent, les suivants sont refusés', () => {
    let tags: string[] = [];
    for (let i = 0; i < MAX_TAGS + 5; i++) tags = addTag(tags, `tag${i}`);
    expect(tags).toHaveLength(MAX_TAGS);
    expect(tags[0]).toBe('tag0');
    expect(tags[MAX_TAGS - 1]).toBe(`tag${MAX_TAGS - 1}`);
  });

  it('propriété : jamais deux tags de même clé dans le résultat, jamais plus de MAX_TAGS', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 60 }),
        (raws) => {
          let tags: string[] = [];
          for (const raw of raws) tags = addTag(tags, raw);
          const keys = tags.map(tagKey);
          expect(new Set(keys).size).toBe(keys.length);
          expect(tags.length).toBeLessThanOrEqual(MAX_TAGS);
        },
      ),
    );
  });
});

describe('removeTag', () => {
  it('retire quelle que soit la variante de casse/accent passée', () => {
    const tags = addTag(addTag([], 'Breakout'), 'Retour');
    expect(removeTag(tags, 'BRÉAKOUT')).toEqual(['Retour']);
    expect(removeTag(tags, tagKey('Breakout'))).toEqual(['Retour']);
  });

  it('clé absente : tableau de même contenu, nouvelle référence (immuable)', () => {
    const tags = ['Retour'];
    const result = removeTag(tags, 'inconnu');
    expect(result).toEqual(tags);
    expect(result).not.toBe(tags);
  });
});

describe('tagUsage', () => {
  it('clé, libellé le plus fréquent, compte total (toutes casses confondues)', () => {
    const journal = journalOf(['btc'], ['BTC'], ['btc'], ['Retour sur moyenne']);
    const usage = tagUsage(journal);
    expect(usage.find((u) => u.key === 'btc')).toEqual({ key: 'btc', label: 'btc', count: 3 });
    expect(usage.find((u) => u.key === 'retour sur moyenne')?.count).toBe(1);
  });

  it('propriété : la somme des comptes égale le nombre total d’occurrences de tags', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 8 }), {
          maxLength: 15,
        }),
        (tagLists) => {
          const journal = journalOf(...tagLists);
          const usage = tagUsage(journal);
          const totalOccurrences = tagLists.reduce((n, tags) => n + tags.length, 0);
          const totalCounted = usage.reduce((n, u) => n + u.count, 0);
          expect(totalCounted).toBe(totalOccurrences);
        },
      ),
    );
  });

  it('égalité stricte de casse/accent à compte égal : la clé alphabétiquement première l’emporte', () => {
    // Comptes réellement À ÉGALITÉ (1 chacun) : seule la branche de départage peut décider.
    // 'ZZZ' inséré en premier (devient le candidat initial), 'zzz' en second doit le supplanter.
    const journal = journalOf(['ZZZ'], ['zzz']);
    expect(tagUsage(journal)).toEqual([{ key: 'zzz', label: 'zzz', count: 2 }]);
  });

  it('à compte différent (même clé), la casse la plus fréquente l’emporte même alphabétiquement après', () => {
    // Deux CASSES de la MÊME clé ('zzz') : 'ZZZ' (3 occurrences) doit rester le libellé retenu même
    // si 'zzz' (1 occurrence) le précède alphabétiquement — le départage alphabétique ne s'applique
    // qu'à ÉGALITÉ de compte, jamais pour renverser un compte plus élevé.
    const journal = journalOf(['ZZZ'], ['ZZZ'], ['ZZZ'], ['zzz']);
    expect(tagUsage(journal)).toEqual([{ key: 'zzz', label: 'ZZZ', count: 4 }]);
  });

  it('deux libellés canoniquement égaux (NFC/NFD) mais distincts : le départage tient à égalité stricte', () => {
    // 'café' précomposé (NFC, 4 unités UTF-16) et « café » décomposé (NFD, e + accent combinant,
    // 5 unités) sont deux chaînes JS DIFFÉRENTES dont `localeCompare('fr')` renvoie exactement 0 —
    // le seul moyen d'exercer `< 0` par opposition à `<= 0` sur le départage.
    const nfc = 'café';
    const nfd = 'café';
    expect(nfc).not.toBe(nfd);
    expect(nfc.localeCompare(nfd, 'fr')).toBe(0);
    const journal = journalOf([nfc], [nfd]);
    // Comparaison EXACTEMENT à égalité (0) : la condition stricte `< 0` ne bascule donc jamais,
    // et le PREMIER libellé inséré (nfc) doit rester retenu. `<= 0` basculerait à tort vers nfd.
    expect(tagUsage(journal)).toEqual([{ key: tagKey(nfc), label: nfc, count: 2 }]);
  });

  it('trié par fréquence décroissante — et NON alphabétique ni par ordre d’insertion', () => {
    // Deux pièges à la fois : l'ordre d'insertion ('Alpha' en premier, 'Zulu' en dernier) ne doit
    // PAS survivre (un tri absent laisserait l'ordre d'insertion), et le compte l'emporte sur
    // l'alphabet (le plus fréquent, 'Zulu', est alphabétiquement DERNIER). Seul un vrai tri par
    // compte décroissant produit l'attendu ['Zulu', 'Mike', 'Alpha'].
    const journal = journalOf(['Alpha'], ['Mike'], ['Zulu'], ['Mike'], ['Zulu'], ['Zulu']);
    expect(tagUsage(journal).map((u) => u.label)).toEqual(['Zulu', 'Mike', 'Alpha']);
  });
});

describe('tagSuggestions', () => {
  it('préfixe de clé d’abord, puis simple contenance — et jamais un tag hors sujet', () => {
    const journal = journalOf(['Setup A'], ['Setup A'], ['Great Setup'], ['Hors sujet']);
    const results = tagSuggestions(journal, 'setup', [], 10);
    // « Hors sujet » ne contient « setup » ni en préfixe ni en contenance : sa présence trahirait
    // un filtre court-circuité (retour de la liste entière triée, sans filtrage réel).
    expect(results.map((u) => u.label)).toEqual(['Setup A', 'Great Setup']);
  });

  it('au sein du groupe préfixe, trié par fréquence — et non par alphabet (trois clés)', () => {
    // Même principe anti-corrélé que pour `tagUsage` : le plus fréquent (`setupZ`) est
    // alphabétiquement DERNIER, pour qu'un tri qui glisserait vers l'alphabet se voie.
    const journal = journalOf(
      ['setupZ'],
      ['setupZ'],
      ['setupZ'],
      ['setupM'],
      ['setupM'],
      ['setupA'],
    );
    const results = tagSuggestions(journal, 'setup', [], 10);
    expect(results.map((u) => u.key)).toEqual(['setupz', 'setupm', 'setupa']);
  });

  it('exclut les tags déjà choisis, comparés par clé', () => {
    const journal = journalOf(['Breakout'], ['Retour']);
    const results = tagSuggestions(journal, '', ['breakout'], 10);
    expect(results.map((u) => u.key)).toEqual(['retour']);
  });

  it('limite le nombre de résultats renvoyés, saisie vide ET saisie non vide', () => {
    const journal = journalOf(['A'], ['B'], ['C'], ['D']);
    expect(tagSuggestions(journal, '', [], 2)).toHaveLength(2);
    // Saisie non vide : passe par la branche préfixe/contenance (ligne distincte du raccourci
    // « saisie vide »), qui a sa propre troncature à `limite`.
    const prefixed = journalOf(['pref1'], ['pref2'], ['pref3']);
    expect(tagSuggestions(prefixed, 'pref', [], 2)).toHaveLength(2);
  });

  it('saisie vide : triées par fréquence décroissante', () => {
    const journal = journalOf(['Rare'], ['Frequent'], ['Frequent'], ['Frequent']);
    const results = tagSuggestions(journal, '', [], 10);
    expect(results[0]?.label).toBe('Frequent');
  });
});

describe('renameTag', () => {
  it('remplace partout ; les entrées non concernées gardent leur référence d’origine', () => {
    const untouched = entry(['Autre']);
    const journal = { a: entry(['Breakout']), b: entry(['Retour', 'Breakout']), c: untouched };
    const result = renameTag(journal, 'breakout', 'Cassure nette');
    expect(result['a']?.tags).toEqual(['Cassure nette']);
    expect(result['b']?.tags).toEqual(['Retour', 'Cassure nette']);
    expect(result['c']).toBe(untouched);
  });

  it('fusionne quand le nom cible existe déjà dans la même entrée', () => {
    const journal = { a: entry(['BO', 'Breakout']) };
    const result = renameTag(journal, 'bo', 'Breakout');
    expect(result['a']?.tags).toEqual(['Breakout']);
  });

  it('nouveau libellé vide : retire le tag (symétrique d’addTag, qui ignore déjà une saisie vide)', () => {
    const journal = { a: entry(['Breakout', 'Retour']) };
    const result = renameTag(journal, 'breakout', '   ');
    expect(result['a']?.tags).toEqual(['Retour']);
  });

  it('propriété : idempotente — rejouer le même renommage sur le résultat ne change plus rien', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 5 }), {
          maxLength: 6,
        }),
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        (tagLists, sourceRaw, newLabel) => {
          const journal = journalOf(...tagLists);
          const sourceKey = tagKey(sourceRaw);
          const once = renameTag(journal, sourceKey, newLabel);
          const twice = renameTag(once, sourceKey, newLabel);
          expect(twice).toEqual(once);
        },
      ),
    );
  });
});
