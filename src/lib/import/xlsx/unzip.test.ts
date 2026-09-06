import { describe, expect, it } from 'vitest';
import { unzipText, ZipError } from './unzip';

interface Entry {
  name: string;
  data: Uint8Array;
  method: number;
}

/** Dégonfle un texte comme le fait un tableur : c'est le chemin qu'emprunte un vrai relevé. */
async function deflateRaw(text: string): Promise<Uint8Array> {
  const source = new Blob([new TextEncoder().encode(text) as BlobPart]).stream();
  const stream = source.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Archive minimale, méthode de compression choisie par entrée. Le CRC reste nul : non vérifié. */
function makeZip(entries: Entry[], options: { zip64?: boolean } = {}): ArrayBuffer {
  const enc = new TextEncoder();
  const named = entries.map((e) => ({ ...e, raw: enc.encode(e.name) }));
  const total = named.reduce((n, e) => n + 76 + e.raw.length * 2 + e.data.length, 22);
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const offsets: number[] = [];
  let at = 0;
  for (const entry of named) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 8, entry.method, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint16(at + 26, entry.raw.length, true);
    bytes.set(entry.raw, at + 30);
    bytes.set(entry.data, at + 30 + entry.raw.length);
    at += 30 + entry.raw.length + entry.data.length;
  }
  const directoryAt = at;
  named.forEach((entry, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 10, entry.method, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint16(at + 28, entry.raw.length, true);
    view.setUint32(at + 42, offsets[i]!, true);
    bytes.set(entry.raw, at + 46);
    at += 46 + entry.raw.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 10, named.length, true);
  view.setUint32(at + 16, options.zip64 ? 0xffffffff : directoryAt, true);
  return buffer.slice(0, at + 22);
}

const stored = (name: string, text: string): Entry => ({
  name,
  data: new TextEncoder().encode(text),
  method: 0,
});

describe('lecture d’archive', () => {
  it('lit une entrée stockée', async () => {
    const parts = await unzipText(makeZip([stored('a.xml', '<x/>')]));
    expect(parts.get('a.xml')).toBe('<x/>');
  });

  it('lit une entrée dégonflée — le chemin qu’emprunte un vrai relevé', async () => {
    const text = '<x:worksheet><x:row r="1"/></x:worksheet>'.repeat(40);
    const entry: Entry = {
      name: 'xl/worksheets/sheet1.xml',
      data: await deflateRaw(text),
      method: 8,
    };
    expect(entry.data.length).toBeLessThan(text.length);
    const parts = await unzipText(makeZip([entry]));
    expect(parts.get('xl/worksheets/sheet1.xml')).toBe(text);
  });

  it('refuse une compression qu’il ne sait pas défaire, en la nommant', async () => {
    const entry: Entry = { name: 'a.xml', data: new Uint8Array([1, 2, 3]), method: 12 };
    await expect(unzipText(makeZip([entry]))).rejects.toThrow('12');
  });

  it('refuse une archive ZIP64 plutôt que de lire à côté', async () => {
    const zip = makeZip([stored('a.xml', '<x/>')], { zip64: true });
    await expect(unzipText(zip)).rejects.toBeInstanceOf(ZipError);
  });

  it('refuse un fichier sans fin d’archive', async () => {
    const junk = new TextEncoder().encode('pas une archive du tout, vraiment pas').buffer;
    await expect(unzipText(junk as ArrayBuffer)).rejects.toThrow(/fin d.archive/);
  });
});
