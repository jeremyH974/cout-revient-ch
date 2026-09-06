import { describe, expect, it } from 'vitest';
import { decodeXmlText, elements, joinText } from './xml';

describe('scanner XML', () => {
  it('décode les entités nommées et numériques', () => {
    expect(decodeXmlText('a &amp; b')).toBe('a & b');
    expect(decodeXmlText('&lt;t&gt; &quot;x&quot; &apos;y&apos;')).toBe('<t> "x" \'y\'');
    expect(decodeXmlText('Montant&#10; en (USD)')).toBe('Montant\n en (USD)');
    expect(decodeXmlText('&#x41;&#x42;')).toBe('AB');
    expect(decodeXmlText('&inconnue; reste')).toBe('&inconnue; reste');
  });

  it('trouve un élément quel que soit son préfixe d’espace de noms', () => {
    // Le relevé eToro écrit `<x:sheet>`, Excel écrit `<sheet>` : les deux doivent marcher, sans
    // quoi le classeur serait lu comme vide, en silence.
    expect(elements('<sheet name="A"/>', 'sheet')[0]?.attrs['name']).toBe('A');
    expect(elements('<x:sheet name="B"/>', 'sheet')[0]?.attrs['name']).toBe('B');
    expect(elements('<x:sheets><x:sheet name="C"/></x:sheets>', 'sheet')).toHaveLength(1);
  });

  it('ne confond pas un élément avec un autre dont il est le préfixe', () => {
    const xml = '<cols><col min="1"/></cols><c r="A1"><v>7</v></c>';
    expect(elements(xml, 'c')).toHaveLength(1);
    expect(elements(xml, 'c')[0]?.attrs['r']).toBe('A1');
  });

  it('lit les attributs entre guillemets simples et les balises auto-fermantes', () => {
    const els = elements("<x:c r='B2' t='s'/><x:c r=\"C2\"><x:v>3</x:v></x:c>", 'c');
    expect(els.map((e) => e.attrs['r'])).toEqual(['B2', 'C2']);
    expect(els[0]?.inner).toBe('');
    expect(els[1]?.inner).toBe('<x:v>3</x:v>');
  });

  it('recolle une chaîne partagée fragmentée en plusieurs `t`', () => {
    expect(joinText('<x:r><x:t>Posi</x:t></x:r><x:r><x:t>tions</x:t></x:r>')).toBe('Positions');
    expect(joinText('<t>simple</t>')).toBe('simple');
  });

  it('s’arrête proprement sur un document tronqué au lieu de boucler', () => {
    expect(elements('<row r="1"><c r="A1">', 'row')).toEqual([]);
    expect(elements('<sheet name="X"', 'sheet')).toEqual([]);
  });
});
