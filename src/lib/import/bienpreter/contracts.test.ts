/**
 * Archive de contrats : lecture, puis report des termes sur les prêts. Les documents sont
 * fabriqués ici — un PDF minimal dans une archive minimale — pour éprouver la chaîne entière sans
 * qu'aucun fichier réel n'entre dans le dépôt.
 */
import { describe, expect, it } from 'vitest';
import type { Loan } from '../../domain/lending/types';
import { applyContracts, readContractsArchive } from './contracts';
import type { BienPreterContract } from './contract';

const loan = (id: string, over: Partial<Loan> = {}): Loan => ({
  id,
  accountId: 'lend:bienpreter',
  platform: 'bienpreter',
  borrower: 'ACME',
  label: 'Facture',
  principal: '1000',
  rate: '0',
  dayCount: 'unknown',
  amortisation: 'unknown',
  subscribedAt: '2026-01-01T00:00:00',
  maturity: null,
  currency: 'eur',
  sector: null,
  ...over,
});

const contract = (over: Partial<BienPreterContract> = {}): BienPreterContract => ({
  rate: '0.15',
  months: 12,
  dayCount: 'act/365',
  amortisation: 'in-fine',
  maturity: '2027-01-01T00:00:00',
  schedule: [{ due: '2027-01-01T00:00:00', principal: '1000', interest: '150', outstanding: '0' }],
  ...over,
});

describe('applyContracts', () => {
  it('reporte les termes sur le prêt qui porte le même numéro', () => {
    const { loans, applied, unmatched } = applyContracts(
      { 'bp:C-1': loan('bp:C-1') },
      new Map([['C-1', contract()]]),
    );
    expect(applied).toBe(1);
    expect(unmatched).toEqual([]);
    expect(loans['bp:C-1']!.rate).toBe('0.15');
    expect(loans['bp:C-1']!.dayCount).toBe('act/365');
    expect(loans['bp:C-1']!.amortisation).toBe('in-fine');
    expect(loans['bp:C-1']!.maturity).toBe('2027-01-01T00:00:00');
    expect(loans['bp:C-1']!.schedule).toHaveLength(1);
  });

  it('ne touche ni au capital souscrit ni à l’emprunteur : ils viennent du relevé', () => {
    const { loans } = applyContracts(
      { 'bp:C-1': loan('bp:C-1', { principal: '2500', borrower: 'BETA' }) },
      new Map([['C-1', contract()]]),
    );
    expect(loans['bp:C-1']!.principal).toBe('2500');
    expect(loans['bp:C-1']!.borrower).toBe('BETA');
  });

  it('signale un contrat sans prêt au lieu de le rapprocher du plus ressemblant', () => {
    const { applied, unmatched, loans } = applyContracts(
      { 'bp:C-1': loan('bp:C-1') },
      new Map([['C-9', contract()]]),
    );
    expect(applied).toBe(0);
    expect(unmatched).toEqual(['C-9']);
    expect(loans['bp:C-1']!.dayCount).toBe('unknown');
  });

  it('laisse en `unknown` les prêts qu’aucun contrat ne couvre', () => {
    const { loans } = applyContracts(
      { 'bp:C-1': loan('bp:C-1'), 'bp:C-2': loan('bp:C-2') },
      new Map([['C-1', contract()]]),
    );
    expect(loans['bp:C-1']!.dayCount).toBe('act/365');
    expect(loans['bp:C-2']!.dayCount).toBe('unknown');
    expect(loans['bp:C-2']!.schedule).toBeUndefined();
  });

  it('n’écrase pas une échéance connue par l’absence d’échéancier', () => {
    const { loans } = applyContracts(
      { 'bp:C-1': loan('bp:C-1', { maturity: '2026-12-01T00:00:00' }) },
      new Map([['C-1', contract({ maturity: null, schedule: [] })]]),
    );
    expect(loans['bp:C-1']!.maturity).toBe('2026-12-01T00:00:00');
  });
});

// --- Archive minimale : un PDF non compressé, une entrée stockée telle quelle ------------------

/** Encode en latin-1 : un PDF WinAnsi code un octet par caractère, pas de l'UTF-8. */
function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function pdfBytes(lines: readonly string[]): Uint8Array {
  const content = latin1(`BT /F1 12 Tf 1 0 0 1 10 700 Tm (${lines.join(') Tj (')}) Tj ET`);
  const head = latin1(
    [
      '%PDF-1.7',
      '1 0 obj',
      '<< /Font << /F1 2 0 R >> >>',
      'endobj',
      '2 0 obj',
      '<< /Type /Font /Subtype /Type1 /Encoding /WinAnsiEncoding >>',
      'endobj',
      '3 0 obj',
      `<< /Length ${content.length} >>`,
      'stream',
      '',
    ].join('\n'),
  );
  const tail = latin1('\nendstream\nendobj\n%%EOF\n');
  const out = new Uint8Array(head.length + content.length + tail.length);
  out.set(head, 0);
  out.set(content, head.length);
  out.set(tail, head.length + content.length);
  return out;
}

/** Archive « stockée » (méthode 0), CRC laissé nul : le lecteur ne le vérifie pas. */
function zipOf(entries: { name: string; data: Uint8Array }[]): ArrayBuffer {
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
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, entry.raw.length, true);
    bytes.set(entry.raw, at + 30);
    bytes.set(entry.data, at + 30 + entry.raw.length);
    at += 30 + entry.raw.length + entry.data.length;
  }
  const directoryAt = at;
  named.forEach((entry, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, entry.raw.length, true);
    view.setUint32(at + 42, offsets[i]!, true);
    bytes.set(entry.raw, at + 46);
    at += 46 + entry.raw.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, named.length, true);
  view.setUint16(at + 10, named.length, true);
  view.setUint32(at + 12, directoryAt === 0 ? 0 : at - directoryAt, true);
  view.setUint32(at + 16, directoryAt, true);
  return buffer;
}

const TERMS = "Le taux d'intérêts conventionnel applicable au prêt est de 11 % par an.";

describe('readContractsArchive', () => {
  it('lit un contrat de l’archive et l’indexe par son numéro de fichier', async () => {
    const { contracts, rejected } = await readContractsArchive(
      zipOf([{ name: 'C-42.pdf', data: pdfBytes([TERMS]) }]),
    );
    expect(rejected).toEqual([]);
    expect([...contracts.keys()]).toEqual(['C-42']);
    expect(contracts.get('C-42')!.rate).toBe('0.11');
  });

  it('signale le fichier illisible sans renoncer aux autres', async () => {
    const { contracts, rejected } = await readContractsArchive(
      zipOf([
        { name: 'C-42.pdf', data: pdfBytes([TERMS]) },
        { name: 'C-99.pdf', data: new TextEncoder().encode('ceci n’est pas un PDF') },
      ]),
    );
    expect([...contracts.keys()]).toEqual(['C-42']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.name).toBe('C-99.pdf');
  });

  it('ignore sans bruit ce qui n’est pas un PDF', async () => {
    const { contracts, rejected } = await readContractsArchive(
      zipOf([
        { name: 'lisez-moi.txt', data: new TextEncoder().encode('bonjour') },
        { name: 'C-42.pdf', data: pdfBytes([TERMS]) },
      ]),
    );
    expect([...contracts.keys()]).toEqual(['C-42']);
    expect(rejected).toEqual([]);
  });
});
