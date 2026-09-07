/**
 * Moteur Prêts : conventions de décompte, dérivation du statut (jamais stocké), séparation du
 * défaut et de l'irrécouvrabilité, concentration à deux niveaux, et l'invariant d'encours.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeLending, dayCountFraction } from './compute';
import { lendingPerformance } from './performance';
import type { Loan, LoanEvent } from './types';

const loan = (over: Partial<Loan> = {}): Loan => ({
  id: 'bp:1',
  accountId: 'acc:bp',
  platform: 'bienpreter',
  borrower: 'ACME SAS',
  label: 'Facture ACME 2026-03',
  principal: '1000',
  rate: '0.12',
  dayCount: 'act/365',
  amortisation: 'in-fine',
  subscribedAt: '2026-01-01T00:00:00',
  maturity: '2026-07-01T00:00:00',
  currency: 'eur',
  sector: null,
  ...over,
});

const subscribe = (at: string, amount: string, loanId = 'bp:1'): LoanEvent => ({
  id: `e:sub:${loanId}:${at}`,
  loanId,
  at,
  kind: 'subscription',
  amount,
});

const repay = (
  at: string,
  principal: string,
  interest: string,
  withheld = '0',
  loanId = 'bp:1',
): LoanEvent => ({
  id: `e:rep:${loanId}:${at}`,
  loanId,
  at,
  kind: 'repayment',
  principal,
  interest,
  withheld,
});

const num = (value: string | null): number => Number(value ?? 'NaN');

describe('dayCountFraction', () => {
  it('compte les jours réels sur 365 et sur 360', () => {
    expect(
      num(dayCountFraction('act/365', '2026-01-01', '2026-01-31')?.toString() ?? null),
    ).toBeCloseTo(30 / 365, 12);
    expect(
      num(dayCountFraction('act/360', '2026-01-01', '2026-01-31')?.toString() ?? null),
    ).toBeCloseTo(30 / 360, 12);
  });

  it('applique la règle 30/360 quand le mois de départ compte 31 jours', () => {
    // d1 ramené à 30, donc 28 − 30 = −2 sur un mois plein de 30 jours.
    expect(
      num(dayCountFraction('30/360', '2026-01-31', '2026-02-28')?.toString() ?? null),
    ).toBeCloseTo(28 / 360, 12);
  });

  it('ne renvoie rien plutôt qu’un chiffre faux quand la convention est inconnue', () => {
    expect(dayCountFraction('unknown', '2026-01-01', '2026-12-31')).toBeNull();
  });

  it('ne compte jamais un couru négatif', () => {
    expect(dayCountFraction('act/365', '2026-06-01', '2026-01-01')?.toString()).toBe('0');
  });
});

describe('computeLending — cycle de vie', () => {
  it('suit un in fine jusqu’au remboursement final et le déclare soldé', () => {
    const report = computeLending({
      loans: [loan()],
      events: [
        subscribe('2026-01-01T10:00:00', '1000'),
        repay('2026-07-01T10:00:00', '1000', '60'),
      ],
      asOf: '2026-07-02',
    });
    const line = report.loans[0]!;
    expect(line.status).toBe('repaid');
    expect(line.outstanding).toBe('0');
    expect(line.interestReceived).toBe('60');
    expect(line.accruedInterest).toBe('0');
    expect(line.daysLate).toBeNull();
  });

  it('fait décroître l’encours à chaque échéance d’un amortissable', () => {
    const report = computeLending({
      loans: [loan({ amortisation: 'linear' })],
      events: [
        subscribe('2026-01-01T10:00:00', '1000'),
        repay('2026-02-01T10:00:00', '250', '10'),
        repay('2026-03-01T10:00:00', '250', '7.5'),
      ],
      asOf: '2026-03-02',
    });
    expect(report.loans[0]!.outstanding).toBe('500');
    expect(report.loans[0]!.principalRepaid).toBe('500');
    expect(report.loans[0]!.status).toBe('performing');
  });

  it('calcule l’intérêt couru sur l’encours depuis le dernier intérêt encaissé', () => {
    const report = computeLending({
      loans: [loan()],
      events: [subscribe('2026-01-01T10:00:00', '1000')],
      asOf: '2026-01-31',
    });
    // 1000 × 12 % × 30/365
    expect(num(report.loans[0]!.accruedInterest)).toBeCloseTo((1000 * 0.12 * 30) / 365, 10);
  });

  it('n’invente aucun intérêt couru quand la convention est inconnue, et le dit', () => {
    const report = computeLending({
      loans: [loan({ dayCount: 'unknown' })],
      events: [subscribe('2026-01-01T10:00:00', '1000')],
      asOf: '2026-01-31',
    });
    expect(report.loans[0]!.accruedInterest).toBeNull();
    expect(report.totals.accrualUnavailable).toBe(1);
    // La valeur reste l'encours seul : sous-estimée, jamais inventée.
    expect(report.totals.value).toBe('1000');
  });
});

describe('computeLending — le statut se dérive, il ne se stocke pas', () => {
  it('déduit le retard de l’échéance dépassée, sans aucun événement `late`', () => {
    const report = computeLending({
      loans: [loan({ maturity: '2026-07-01T00:00:00' })],
      events: [subscribe('2026-01-01T10:00:00', '1000')],
      asOf: '2026-07-31',
    });
    expect(report.loans[0]!.status).toBe('late');
    expect(report.loans[0]!.daysLate).toBe(30);
  });

  it('cesse de compter un retard dès que l’encours est soldé', () => {
    const report = computeLending({
      loans: [loan()],
      events: [
        subscribe('2026-01-01T10:00:00', '1000'),
        repay('2026-07-20T10:00:00', '1000', '70'),
      ],
      asOf: '2026-07-31',
    });
    expect(report.loans[0]!.daysLate).toBeNull();
    expect(report.loans[0]!.status).toBe('repaid');
  });

  it('distingue le défaut constaté de la créance définitivement irrécouvrable', () => {
    const events: LoanEvent[] = [
      subscribe('2026-01-01T10:00:00', '1000'),
      repay('2026-04-01T10:00:00', '300', '30'),
      {
        id: 'e:def',
        loanId: 'bp:1',
        at: '2026-08-01T00:00:00',
        kind: 'default',
        outstandingAtDefault: '700',
      },
    ];
    const defaulted = computeLending({ loans: [loan()], events, asOf: '2026-09-01' });
    expect(defaulted.loans[0]!.status).toBe('defaulted');
    expect(defaulted.loans[0]!.outstanding).toBe('700');
    expect(defaulted.loans[0]!.writtenOff).toBe('0');
    // Un prêt en défaut n'accumule plus d'intérêts : ce serait une fiction optimiste.
    expect(defaulted.loans[0]!.accruedInterest).toBe('0');

    const written = computeLending({
      loans: [loan()],
      events: [
        ...events,
        {
          id: 'e:wo',
          loanId: 'bp:1',
          at: '2027-02-01T00:00:00',
          kind: 'write-off',
          proof: 'failed-proceedings',
        },
      ],
      asOf: '2027-03-01',
    });
    expect(written.loans[0]!.status).toBe('written-off');
    expect(written.loans[0]!.writtenOff).toBe('700');
    expect(written.loans[0]!.outstanding).toBe('0');
  });

  it('solde un prêt cédé sur le marché secondaire sans inventer de ventilation', () => {
    const report = computeLending({
      loans: [loan()],
      events: [
        subscribe('2026-01-01T10:00:00', '1000'),
        {
          id: 'e:sale',
          loanId: 'bp:1',
          at: '2026-05-01T00:00:00',
          kind: 'secondary-sale',
          proceeds: '980',
        },
      ],
      asOf: '2026-06-01',
    });
    expect(report.loans[0]!.status).toBe('sold');
    expect(report.loans[0]!.outstanding).toBe('0');
    expect(report.loans[0]!.saleProceeds).toBe('980');
    expect(report.loans[0]!.interestReceived).toBe('0');
  });

  it('signale un événement orphelin au lieu de l’ignorer', () => {
    const report = computeLending({
      loans: [loan()],
      events: [subscribe('2026-01-01T10:00:00', '500', 'bp:inconnu')],
      asOf: '2026-02-01',
    });
    expect(report.orphanEvents).toEqual(['e:sub:bp:inconnu:2026-01-01T10:00:00']);
    expect(report.loans[0]!.status).toBe('pending');
  });
});

describe('computeLending — concentration à deux niveaux', () => {
  it('mesure l’emprunteur ET la plateforme, parce que ce sont deux risques différents', () => {
    const report = computeLending({
      loans: [
        loan({ id: 'a', borrower: 'ACME', platform: 'bienpreter' }),
        loan({ id: 'b', borrower: 'BETA', platform: 'bienpreter' }),
      ],
      events: [
        subscribe('2026-01-01T10:00:00', '1000', 'a'),
        subscribe('2026-01-01T10:00:00', '1000', 'b'),
      ],
      asOf: '2026-02-01',
    });
    // Deux emprunteurs équipondérés : HHI = 0,5, soit 2 lignes effectives.
    expect(num(report.concentration.byBorrower.index)).toBeCloseTo(0.5, 12);
    expect(num(report.concentration.byBorrower.effectiveCount)).toBeCloseTo(2, 12);
    // Une seule plateforme : concentration maximale, que le HHI par emprunteur ne voit pas.
    expect(num(report.concentration.byPlatform.index)).toBeCloseTo(1, 12);
  });

  it('ne compte que l’encours vivant', () => {
    const report = computeLending({
      loans: [loan({ id: 'a', borrower: 'ACME' }), loan({ id: 'b', borrower: 'BETA' })],
      events: [
        subscribe('2026-01-01T10:00:00', '1000', 'a'),
        subscribe('2026-01-01T10:00:00', '1000', 'b'),
        repay('2026-02-01T10:00:00', '1000', '20', '0', 'b'),
      ],
      asOf: '2026-03-01',
    });
    expect(report.concentration.byBorrower.top).toHaveLength(1);
    expect(report.concentration.byBorrower.top[0]!.key).toBe('ACME');
  });
});

describe('lendingPerformance', () => {
  it('donne un TRI brut supérieur au net dès qu’il y a prélèvement à la source', () => {
    const input = {
      loans: [loan()],
      events: [
        subscribe('2026-01-01T00:00:00', '1000'),
        repay('2026-12-31T00:00:00', '1000', '120', '37.68'),
      ],
      asOf: '2026-12-31',
    };
    const perf = lendingPerformance(input, computeLending(input));
    expect(perf.gross.ok).toBe(true);
    expect(perf.net.ok).toBe(true);
    if (!perf.gross.ok || !perf.net.ok) return;
    expect(Number(perf.gross.rate.toString())).toBeGreaterThan(Number(perf.net.rate.toString()));
    expect(Number(perf.gross.rate.toString())).toBeCloseTo(0.12, 3);
  });

  it('refuse d’annualiser un portefeuille sans flux de signe opposé', () => {
    const input = {
      loans: [loan()],
      events: [subscribe('2026-01-01T00:00:00', '1000')],
      asOf: '2026-01-02',
    };
    const perf = lendingPerformance(input, computeLending(input));
    expect(perf.gross.ok).toBe(false);
  });
});

describe('invariant d’encours', () => {
  it('vérifie `versé = capital remboursé + passé en perte + encours` sur des suites aléatoires', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 0, maxLength: 8 }),
        fc.boolean(),
        (principal, parts, writeOff) => {
          // Des remboursements partiels dont la somme ne dépasse jamais le capital versé.
          let left = principal;
          const events: LoanEvent[] = [subscribe('2026-01-01T00:00:00', String(principal))];
          parts.forEach((pct, i) => {
            const amount = Math.floor((left * pct) / 100);
            left -= amount;
            if (amount > 0) {
              events.push(repay(`2026-0${(i % 8) + 2}-01T00:00:00`, String(amount), '1'));
            }
          });
          if (writeOff) {
            events.push({
              id: 'e:wo',
              loanId: 'bp:1',
              at: '2027-01-01T00:00:00',
              kind: 'write-off',
              proof: 'failed-proceedings',
            });
          }
          const line = computeLending({ loans: [loan()], events, asOf: '2027-06-01' }).loans[0]!;
          const sum =
            Number(line.principalRepaid) + Number(line.writtenOff) + Number(line.outstanding);
          expect(sum).toBeCloseTo(Number(line.disbursed), 9);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('recouvrement après passage en perte', () => {
  it('reprend sur la perte au lieu de gonfler le capital remboursé', () => {
    const report = computeLending({
      loans: [loan()],
      events: [
        subscribe('2026-01-01T00:00:00', '1000'),
        repay('2026-04-01T00:00:00', '300', '30'),
        {
          id: 'e:wo',
          loanId: 'bp:1',
          at: '2027-01-01T00:00:00',
          kind: 'write-off',
          proof: 'failed-proceedings',
        },
        {
          id: 'e:rec',
          loanId: 'bp:1',
          at: '2027-06-01T00:00:00',
          kind: 'recovery',
          principal: '200',
          interest: '0',
          withheld: '0',
        },
      ],
      asOf: '2027-12-31',
    });
    const line = report.loans[0]!;
    expect(line.principalRepaid).toBe('500');
    expect(line.writtenOff).toBe('500'); // 700 constatés, 200 recouvrés
    expect(line.outstanding).toBe('0');
    // L'invariant tient : 500 + 500 + 0 = 1000.
    expect(Number(line.principalRepaid) + Number(line.writtenOff) + Number(line.outstanding)).toBe(
      Number(line.disbursed),
    );
  });
});

describe('retard lu dans l’échéancier du contrat', () => {
  const withSchedule = (rows: { due: string; principal: string; interest: string }[]) =>
    loan({
      maturity: null,
      schedule: rows.map((r) => ({ ...r, outstanding: '0' })),
    });

  it('déclare en retard dès qu’une échéance passée n’est pas couverte', () => {
    const report = computeLending({
      loans: [
        withSchedule([
          { due: '2026-02-01T00:00:00', principal: '0', interest: '10' },
          { due: '2026-03-01T00:00:00', principal: '0', interest: '10' },
        ]),
      ],
      events: [subscribe('2026-01-01T00:00:00', '1000'), repay('2026-02-01T00:00:00', '0', '10')],
      asOf: '2026-03-11',
    });
    // La deuxième échéance était due le 1er mars et n'a pas été encaissée.
    expect(report.loans[0]!.status).toBe('late');
    expect(report.loans[0]!.daysLate).toBe(10);
  });

  it('ne déclare aucun retard tant que rien n’est encore dû', () => {
    const report = computeLending({
      loans: [withSchedule([{ due: '2026-06-01T00:00:00', principal: '1000', interest: '10' }])],
      events: [subscribe('2026-01-01T00:00:00', '1000')],
      asOf: '2026-03-01',
    });
    expect(report.loans[0]!.daysLate).toBeNull();
    expect(report.loans[0]!.status).toBe('performing');
  });

  it('ne punit pas un emprunteur en avance : le reçu dépasse l’attendu', () => {
    const report = computeLending({
      loans: [
        withSchedule([
          { due: '2026-02-01T00:00:00', principal: '0', interest: '10' },
          { due: '2026-03-01T00:00:00', principal: '0', interest: '10' },
        ]),
      ],
      events: [subscribe('2026-01-01T00:00:00', '1000'), repay('2026-02-01T00:00:00', '0', '25')],
      asOf: '2026-03-11',
    });
    expect(report.loans[0]!.daysLate).toBeNull();
  });

  it('tolère l’arrondi au centime des annexes', () => {
    const report = computeLending({
      loans: [withSchedule([{ due: '2026-02-01T00:00:00', principal: '0', interest: '10' }])],
      events: [
        subscribe('2026-01-01T00:00:00', '1000'),
        repay('2026-02-01T00:00:00', '0', '9.995'),
      ],
      asOf: '2026-03-01',
    });
    expect(report.loans[0]!.daysLate).toBeNull();
  });
});
