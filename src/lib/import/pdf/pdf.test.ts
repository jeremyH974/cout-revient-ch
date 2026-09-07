/**
 * Lecteur PDF minimal. Les documents sont fabriqués ici, octet par octet — comme `unzip.test.ts`
 * fabrique ses archives : c'est le seul moyen d'éprouver un format binaire sans embarquer un
 * fichier réel dans le dépôt.
 *
 * Le test qui compte le plus est celui de la **fin de ligne avant `endstream`**. Elle est présente
 * dans tout PDF réel, `DecompressionStream` la refuse comme un octet excédentaire, et sans elle un
 * portage précédent rendait 3 flux sur 32 — donc un document quasi vide, sans lever la moindre
 * erreur. Un lecteur muet est pire qu'un lecteur absent.
 */
import { describe, expect, it } from 'vitest';
import { PdfError, pdfTextRows } from './index';
import { toUnicodeMap } from './text';

/** Dégonfle en zlib, comme le fait un producteur de PDF pour un flux `/FlateDecode`. */
async function deflate(text: string): Promise<Uint8Array> {
  const source = new Blob([new TextEncoder().encode(text) as BlobPart]).stream();
  return new Uint8Array(
    await new Response(source.pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
  );
}

/** Assemble un document à partir de corps d'objets numérotés dans l'ordre. Aucune table `xref` : */
/** le lecteur balaie les objets, et un document sans table reste donc lisible. */
function pdf(bodies: readonly (string | Uint8Array)[]): ArrayBuffer {
  const parts: Uint8Array[] = [new TextEncoder().encode('%PDF-1.7\n')];
  bodies.forEach((body, i) => {
    parts.push(new TextEncoder().encode(`${i + 1} 0 obj\n`));
    parts.push(typeof body === 'string' ? new TextEncoder().encode(body) : body);
    parts.push(new TextEncoder().encode('\nendobj\n'));
  });
  parts.push(new TextEncoder().encode('%%EOF\n'));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

const plainStream = (content: string): string =>
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

async function flateStream(content: string): Promise<Uint8Array> {
  const packed = await deflate(content);
  const head = new TextEncoder().encode(
    `<< /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
  );
  // La fin de ligne AVANT `endstream` est celle qui piégeait la décompression.
  const tail = new TextEncoder().encode('\nendstream');
  const out = new Uint8Array(head.length + packed.length + tail.length);
  out.set(head, 0);
  out.set(packed, head.length);
  out.set(tail, head.length + packed.length);
  return out;
}

/** Police simple, sans table de correspondance : les octets valent les caractères. */
const WIN_ANSI = '<< /Type /Font /Subtype /Type1 /Encoding /WinAnsiEncoding >>';

const CMAP = [
  'begincmap',
  '1 beginbfchar',
  '<0001> <0041>',
  'endbfchar',
  '1 beginbfrange',
  '<0002> <0004> <0042>',
  'endbfrange',
  'endcmap',
].join('\n');

describe('toUnicodeMap', () => {
  it('lit les caractères isolés et les plages', () => {
    const map = toUnicodeMap(CMAP);
    expect(map.get(0x0001)).toBe('A');
    expect(map.get(0x0002)).toBe('B');
    expect(map.get(0x0004)).toBe('D');
    expect(map.get(0x0005)).toBeUndefined();
  });
});

describe('pdfTextRows', () => {
  it('lit un flux non compressé et rend le texte posé', async () => {
    const rows = await pdfTextRows(
      pdf([
        '<< /Font << /F1 2 0 R >> >>',
        WIN_ANSI,
        plainStream('BT /F1 12 Tf 1 0 0 1 10 700 Tm (Bonjour) Tj ET'),
      ]),
    );
    expect(rows).toEqual(['Bonjour']);
  });

  it('décompresse un flux `FlateDecode` malgré la fin de ligne qui précède `endstream`', async () => {
    const rows = await pdfTextRows(
      pdf([
        '<< /Font << /F1 2 0 R >> >>',
        WIN_ANSI,
        await flateStream('BT /F1 12 Tf 1 0 0 1 10 700 Tm (Compresse) Tj ET'),
      ]),
    );
    expect(rows).toEqual(['Compresse']);
  });

  it('réunit sur une ligne ce qui est à la même hauteur, et sépare le reste', async () => {
    const rows = await pdfTextRows(
      pdf([
        '<< /Font << /F1 2 0 R >> >>',
        WIN_ANSI,
        plainStream(
          [
            'BT /F1 12 Tf',
            '1 0 0 1 10 700 Tm (gauche) Tj',
            '1 0 0 1 90 700 Tm (droite) Tj',
            '1 0 0 1 10 680 Tm (dessous) Tj',
            'ET',
          ].join('\n'),
        ),
      ]),
    );
    expect(rows).toEqual(['gauche droite', 'dessous']);
  });

  it('avance d’un interligne sur `T*`, comme la norme l’impose', async () => {
    const rows = await pdfTextRows(
      pdf([
        '<< /Font << /F1 2 0 R >> >>',
        WIN_ANSI,
        plainStream(
          ['BT /F1 12 Tf 1 0 0 1 10 700 Tm 0 -20 TD (une) Tj T* (deux) Tj ET'].join('\n'),
        ),
      ]),
    );
    expect(rows).toEqual(['une', 'deux']);
  });

  it('décode une police `Identity-H` par sa table `ToUnicode`', async () => {
    const rows = await pdfTextRows(
      pdf([
        '<< /Font << /F1 2 0 R >> >>',
        '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 3 0 R >>',
        plainStream(CMAP),
        plainStream('BT /F1 12 Tf 1 0 0 1 10 700 Tm <000100020003> Tj ET'),
      ]),
    );
    expect(rows).toEqual(['ABC']);
  });

  it('rend l’espace que le producteur a écrit en crénage plutôt qu’en caractère', async () => {
    const rows = await pdfTextRows(
      pdf([
        '<< /Font << /F1 2 0 R >> >>',
        WIN_ANSI,
        plainStream('BT /F1 12 Tf 1 0 0 1 10 700 Tm [(deux) -400 (mots)] TJ ET'),
      ]),
    );
    expect(rows).toEqual(['deux mots']);
  });

  it('ne colle pas deux fragments qu’un crénage minime sépare', async () => {
    const rows = await pdfTextRows(
      pdf([
        '<< /Font << /F1 2 0 R >> >>',
        WIN_ANSI,
        plainStream('BT /F1 12 Tf 1 0 0 1 10 700 Tm [(ajust) -20 (e)] TJ ET'),
      ]),
    );
    expect(rows).toEqual(['ajuste']);
  });

  it('lit les échappements d’une chaîne littérale', async () => {
    const rows = await pdfTextRows(
      pdf([
        '<< /Font << /F1 2 0 R >> >>',
        WIN_ANSI,
        plainStream(`BT /F1 12 Tf 1 0 0 1 10 700 Tm (a${String.fromCharCode(92)}(b) Tj ET`),
      ]),
    );
    expect(rows).toEqual(['a(b']);
  });
});

describe('formes refusées, nommées plutôt que rendues vides', () => {
  it('refuse un document chiffré', async () => {
    await expect(pdfTextRows(pdf(['<< /Encrypt 9 0 R >>']))).rejects.toThrow(PdfError);
    await expect(pdfTextRows(pdf(['<< /Encrypt 9 0 R >>']))).rejects.toThrow(/chiffré/);
  });

  it('refuse un document à objets compressés', async () => {
    await expect(pdfTextRows(pdf(['<< /Type /ObjStm >>']))).rejects.toThrow(/ObjStm/);
  });

  it('refuse un fichier qui n’est pas un PDF', async () => {
    const bytes = new TextEncoder().encode('ceci est un texte, pas un PDF');
    await expect(pdfTextRows(bytes.buffer as ArrayBuffer)).rejects.toThrow(PdfError);
  });
});
