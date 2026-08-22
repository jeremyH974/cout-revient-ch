import { describe, expect, it } from 'vitest';
import { checkBalances } from './integrity';

const rec = (key: string, asset: string, qty: string, balance: string, at: string) => ({
  rowKey: key,
  asset,
  signedQty: qty,
  balance,
  at,
});

describe('contrôle de solde', () => {
  it('retrouve un ordre de règlement que le glouton manquerait (retour arrière)', () => {
    // Ordre réel : X(10→12), Y(12→10), Z(10→15) ; l'export horodate Z avant X.
    const records = [
      rec('o', 'a', '10', '10', '2026-01-01T09:00:00'),
      rec('z', 'a', '5', '15', '2026-01-02T10:00:00'),
      rec('x', 'a', '2', '12', '2026-01-02T10:00:01'),
      rec('y', 'a', '-2', '10', '2026-01-02T10:00:02'),
    ];
    const result = checkBalances(records, { a: '15' })['a']!;
    expect(result.status).toBe('ok');
    expect(result.reorderedDays).toEqual(['2026-01-02']);
  });

  it("détecte un export tronqué et l'accepte quand un solde d'ouverture le couvre", () => {
    const records = [rec('x', 'a', '1', '3', '2026-01-01T09:00:00')];
    expect(checkBalances(records, { a: '1' })['a']?.status).toBe('opening-balance-missing');
    expect(checkBalances(records, { a: '3' })['a']?.status).toBe('ok');
  });

  it('signale un écart de solde', () => {
    const records = [
      rec('x', 'a', '1', '1', '2026-01-01T09:00:00'),
      rec('y', 'a', '1', '3', '2026-01-02T09:00:00'),
    ];
    expect(checkBalances(records, { a: '2' })['a']?.status).toBe('balance-mismatch');
  });
});
