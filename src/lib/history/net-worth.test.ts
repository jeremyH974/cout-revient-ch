import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../domain/money';
import {
  cumulativeContributions,
  hasUnavailable,
  latestNetWorth,
  netWorthChange,
  netWorthPartChanges,
  netWorthSeries,
  reconcileNetWorth,
  roiOf,
  tradingEquityContribution,
  valueSeriesContribution,
  type Contribution,
  type Liability,
} from './net-worth';
import type { FlowPoint, ValuePoint } from './series';
import type { DayString } from './types';

const days = (...list: string[]): DayString[] => list as DayString[];

/** Flux datés (versé positif, retiré négatif) → apports nets cumulés, comme l'app les fournit. */
const contributedFrom = (
  ...flows: [string, string][]
): ((day: DayString) => ReturnType<typeof D>) =>
  cumulativeContributions(
    flows.map(([day, amount]): FlowPoint => ({ day: day as DayString, amountEur: D(amount) })),
  );

/** Apports constamment nuls : pour les cas où seule la valeur est examinée. */
const noContribution = (): ReturnType<typeof D> => ZERO;

/** Jour civil d'un instant, en UTC : suffisant et déterministe pour les tests. */
const dayOfMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const at = (iso: string): number => Date.parse(iso);

function vp(day: string, value: string, cost: string, missing: string[] = []): ValuePoint {
  return { day: day as DayString, value: D(value), cost: D(cost), missing: missing as never[] };
}

/** Contribution constante, sans dépendance externe : sert de témoin. */
function flat(
  id: string,
  value: string,
  contributed = '0',
  firstDay: string | null = null,
): Contribution {
  return {
    id,
    label: id,
    firstDay: firstDay as DayString | null,
    valueAt: () => ({ value: D(value), contributed: D(contributed), estimated: false }),
  };
}

describe('valeur nette = Σ contributions − Σ passifs', () => {
  it('somme les contributions et retranche les passifs', () => {
    const liability: Liability = { id: 'pret', label: 'Prêt', amountAt: () => D('300') };
    const points = netWorthSeries({
      contributions: [flat('a', '1000', '800'), flat('b', '500', '500')],
      liabilities: [liability],
      days: days('2026-08-01'),
    });
    expect(points[0]?.gross.toString()).toBe('1500');
    expect(points[0]?.liabilities.toString()).toBe('300');
    expect(points[0]?.net.toString()).toBe('1200');
    expect(points[0]?.contributed.toString()).toBe('1300');
  });

  it('sans passif déclaré, la valeur nette égale le brut — le terme P37 est neutre, pas absent', () => {
    const points = netWorthSeries({ contributions: [flat('a', '42')], days: days('2026-08-01') });
    expect(points[0]?.liabilities.toString()).toBe('0');
    expect(points[0]?.net.toString()).toBe(points[0]?.gross.toString());
  });

  it('avant son premier jour, une contribution est ABSENTE et non nulle par accident', () => {
    const points = netWorthSeries({
      contributions: [flat('tard', '900', '900', '2026-08-05')],
      days: days('2026-08-04', '2026-08-05'),
    });
    expect(points[0]?.gross.toString()).toBe('0');
    // Le compte n'existait pas : ce n'est ni une valeur manquante, ni une contribution indisponible.
    expect(points[0]?.unavailable).toEqual([]);
    expect(points[0]?.estimated).toEqual([]);
    expect(points[1]?.gross.toString()).toBe('900');
  });
});

describe('approché ou incomplet : la distinction qui sépare un chiffre juste d’un chiffre faux', () => {
  it('marque « estimated » une contribution portée à son coût, et la COMPTE quand même', () => {
    const points = netWorthSeries({
      contributions: [
        valueSeriesContribution(
          'invest',
          'Investissement',
          [vp('2026-08-01', '700', '700', ['zzz'])],
          noContribution,
        ),
      ],
      days: days('2026-08-01'),
    });
    expect(points[0]?.estimated).toEqual(['invest']);
    expect(points[0]?.gross.toString()).toBe('700');
    expect(hasUnavailable(points)).toBe(false);
  });

  it('marque « unavailable » une contribution non valorisable, et l’EXCLUT du total', () => {
    const broken: Contribution = {
      id: 'hl',
      label: 'Trading',
      firstDay: null,
      valueAt: () => null,
    };
    const points = netWorthSeries({
      contributions: [flat('invest', '1000'), broken],
      days: days('2026-08-01'),
    });
    expect(points[0]?.unavailable).toEqual(['hl']);
    // Le total est INCOMPLET, donc trop bas — pas approché. C'est pourquoi il doit se signaler.
    expect(points[0]?.gross.toString()).toBe('1000');
    expect(hasUnavailable(points)).toBe(true);
  });
});

describe('équité de trading rééchantillonnée au jour', () => {
  const usdPerDisplay = () => '1.25' as const;

  it('retient la CLÔTURE du jour quand la plateforme en donne plusieurs', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'Compte',
      history: [
        [at('2026-08-01T06:00:00Z'), '1000'],
        [at('2026-08-01T18:00:00Z'), '1500'],
      ],
      dayOfMs,
      usdPerDisplay,
    });
    // 1500 $ / 1,25 = 1200 € — et non le point de 6 h.
    expect(c.valueAt('2026-08-01' as DayString)?.value.toString()).toBe('1200');
  });

  it('reporte le dernier point connu à travers les trous de l’échantillonnage', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'Compte',
      history: [
        [at('2026-08-01T12:00:00Z'), '1000'],
        [at('2026-08-10T12:00:00Z'), '2000'],
      ],
      dayOfMs,
      usdPerDisplay,
    });
    expect(c.valueAt('2026-08-05' as DayString)?.value.toString()).toBe('800');
    expect(c.valueAt('2026-08-31' as DayString)?.value.toString()).toBe('1600');
  });

  it('n’existe pas avant son premier point : firstDay le dit', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'Compte',
      history: [[at('2026-08-10T12:00:00Z'), '2000']],
      dayOfMs,
      usdPerDisplay,
    });
    expect(c.firstDay).toBe('2026-08-10');
    const points = netWorthSeries({ contributions: [c], days: days('2026-08-09', '2026-08-10') });
    expect(points[0]?.gross.toString()).toBe('0');
    expect(points[1]?.gross.toString()).toBe('1600');
  });

  it('se déclare non valorisable plutôt que de convertir au hasard sans taux', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'Compte',
      history: [[at('2026-08-01T12:00:00Z'), '1000']],
      dayOfMs,
      usdPerDisplay: () => null,
    });
    expect(c.valueAt('2026-08-01' as DayString)).toBeNull();
  });

  it('refuse un taux nul ou négatif au lieu de diviser par zéro', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'Compte',
      history: [[at('2026-08-01T12:00:00Z'), '1000']],
      dayOfMs,
      usdPerDisplay: () => '0',
    });
    expect(c.valueAt('2026-08-01' as DayString)).toBeNull();
  });

  it('laisse l’instantané « live » remplacer la dernière clôture servie par la plateforme', () => {
    // `portfolio` et l'instantané viennent de points d'entrée DIFFÉRENTS, non synchronisés. Sans
    // ce remplacement, le dernier point de la courbe ne pourrait pas égaler le total du bandeau
    // de la Vue d'ensemble — et deux chiffres qui devraient être le même divergeraient à l'écran.
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'C',
      history: [[at('2026-08-01T12:00:00Z'), '1000']],
      dayOfMs,
      usdPerDisplay: () => '1',
      live: { day: '2026-08-01' as DayString, usd: '1337' },
    });
    expect(c.valueAt('2026-08-01' as DayString)?.value.toString()).toBe('1337');
  });

  it('accepte un « live » postérieur au dernier point servi, et avance le dernier jour', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'C',
      history: [[at('2026-08-01T12:00:00Z'), '1000']],
      dayOfMs,
      usdPerDisplay: () => '1',
      live: { day: '2026-08-03' as DayString, usd: '1500' },
    });
    expect(c.valueAt('2026-08-03' as DayString)?.value.toString()).toBe('1500');
  });

  it('suit la devise d’AFFICHAGE, pas l’euro par principe', () => {
    // Piège réel : `pricesFor` convertit déjà les cours du côté Investissement dans la devise
    // d'affichage. En dollars, la contribution du trading ne doit donc PAS être divisée — sans
    // quoi les deux moitiés de la courbe ne sont plus dans la même unité et on additionne des
    // pommes et des poires, sans qu'aucun total ne paraisse aberrant.
    const history: [number, string][] = [[at('2026-08-01T12:00:00Z'), '1000']];
    const inEur = tradingEquityContribution({
      id: 'hl',
      label: 'C',
      history,
      dayOfMs,
      usdPerDisplay: () => '1.25',
    });
    const inUsd = tradingEquityContribution({
      id: 'hl',
      label: 'C',
      history,
      dayOfMs,
      usdPerDisplay: () => '1',
    });
    expect(inEur.valueAt('2026-08-01' as DayString)?.value.toString()).toBe('800');
    expect(inUsd.valueAt('2026-08-01' as DayString)?.value.toString()).toBe('1000');
  });

  it('consolide DEUX comptes aux horodatages disjoints — ce que la plateforme ne sait pas faire', () => {
    // C'est la raison pour laquelle `Trading.svelte` ne trace sa courbe que s'il n'y a qu'un
    // compte : les séries de la plateforme n'ont pas les mêmes instants. Ramenées au jour, elles
    // s'additionnent.
    const a = tradingEquityContribution({
      id: 'a',
      label: 'A',
      history: [
        [at('2026-08-01T03:17:00Z'), '1000'],
        [at('2026-08-04T21:43:00Z'), '1250'],
      ],
      dayOfMs,
      usdPerDisplay,
    });
    const b = tradingEquityContribution({
      id: 'b',
      label: 'B',
      history: [
        [at('2026-08-02T11:02:00Z'), '500'],
        [at('2026-08-05T07:29:00Z'), '750'],
      ],
      dayOfMs,
      usdPerDisplay,
    });
    const points = netWorthSeries({
      contributions: [a, b],
      days: days('2026-08-01', '2026-08-02', '2026-08-04', '2026-08-05'),
    });
    expect(points.map((p) => p.gross.toString())).toEqual([
      '800', // A seul (1000 $), B n'existe pas encore
      '1200', // A reporté (800) + B (400)
      '1400', // A à 1250 $ (1000) + B reporté (400)
      '1600', // A reporté (1000) + B à 750 $ (600)
    ]);
    expect(points.every((p) => p.unavailable.length === 0)).toBe(true);
  });
});

describe('propriétés', () => {
  it('un apport déplace la courbe d’apports EXACTEMENT de son montant, et le gain ne bouge pas', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (cents) => {
        const deposit = D(String(cents)).div(D('100'));
        const before = netWorthSeries({
          contributions: [
            valueSeriesContribution(
              'i',
              'I',
              [vp('2026-08-01', '1000', '900')],
              contributedFrom(['2026-08-01', '900']),
            ),
          ],
          days: days('2026-08-01'),
        });
        const after = netWorthSeries({
          contributions: [
            valueSeriesContribution(
              'i',
              'I',
              [vp('2026-08-01', D('1000').plus(deposit).toString(), '900')],
              contributedFrom(['2026-08-01', '900'], ['2026-08-01', deposit.toString()]),
            ),
          ],
          days: days('2026-08-01'),
        });
        const movedContributions = after[0]!.contributed.minus(before[0]!.contributed);
        const movedNet = after[0]!.net.minus(before[0]!.net);
        // Un virement bouge les deux courbes ensemble : le gain (l'écart) reste identique. C'est
        // toute la raison d'être de la courbe de référence.
        const gainBefore = before[0]!.net.minus(before[0]!.contributed);
        const gainAfter = after[0]!.net.minus(after[0]!.contributed);
        return movedContributions.eq(deposit) && movedNet.eq(deposit) && gainAfter.eq(gainBefore);
      }),
      { numRuns: 60 },
    );
  });

  it('la valeur nette ne dépend pas de l’ordre des contributions', () => {
    const a = flat('a', '123.45', '100');
    const b = flat('b', '67.89', '50');
    const c = flat('c', '0.01', '0');
    const one = netWorthSeries({ contributions: [a, b, c], days: days('2026-08-01') });
    const other = netWorthSeries({ contributions: [c, a, b], days: days('2026-08-01') });
    expect(one[0]?.net.toString()).toBe(other[0]?.net.toString());
  });

  it('sans contribution, tout vaut zéro plutôt que d’échouer', () => {
    const points = netWorthSeries({ contributions: [], days: days('2026-08-01') });
    expect(points[0]?.net.toString()).toBe('0');
    expect(points[0]?.gross.eq(ZERO)).toBe(true);
    expect(latestNetWorth([])).toBeNull();
  });

  it('latestNetWorth rend le dernier point : c’est lui que la Vue d’ensemble doit égaler', () => {
    const points = netWorthSeries({
      contributions: [
        valueSeriesContribution(
          'i',
          'I',
          [vp('2026-08-01', '10', '10'), vp('2026-08-02', '20', '10')],
          contributedFrom(['2026-08-01', '10']),
        ),
      ],
      days: days('2026-08-01', '2026-08-02'),
    });
    expect(latestNetWorth(points)?.day).toBe('2026-08-02');
    expect(latestNetWorth(points)?.net.toString()).toBe('20');
  });
});

describe('apports nets : de l’argent qui entre, jamais l’assiette de coût', () => {
  it('cumule les flux dans l’ordre et reporte le dernier cumul aux jours sans mouvement', () => {
    const at = contributedFrom(['2026-08-01', '1000'], ['2026-08-10', '-400']);
    expect(at('2026-07-31' as DayString).toString()).toBe('0');
    expect(at('2026-08-01' as DayString).toString()).toBe('1000');
    expect(at('2026-08-05' as DayString).toString()).toBe('1000');
    expect(at('2026-08-10' as DayString).toString()).toBe('600');
    expect(at('2026-12-31' as DayString).toString()).toBe('600');
  });

  it('additionne plusieurs flux d’un même jour', () => {
    const at = contributedFrom(['2026-08-01', '100'], ['2026-08-01', '50']);
    expect(at('2026-08-01' as DayString).toString()).toBe('150');
  });

  it('ne confond PAS les apports avec l’assiette de coût après une vente à perte', () => {
    // Le piège que ce module existe pour éviter : 1 000 € versés, revendus 600 € et rachetés.
    // L'assiette de coût retombe à 600 € et ferait apparaître un gain nul ; les apports, eux,
    // restent à 1 000 € et laissent voir la moins-value de 400 €.
    const points = netWorthSeries({
      contributions: [
        valueSeriesContribution(
          'i',
          'I',
          [vp('2026-08-01', '1000', '1000'), vp('2026-08-02', '600', '600')],
          contributedFrom(['2026-08-01', '1000']),
        ),
      ],
      days: days('2026-08-01', '2026-08-02'),
    });
    expect(points[1]?.contributed.toString()).toBe('1000');
    expect(points[1]?.net.minus(points[1]!.contributed).toString()).toBe('-400');
  });
});

describe('variation de période, apports neutralisés', () => {
  const series = (...rows: [string, string, string][]) =>
    netWorthSeries({
      contributions: [
        {
          id: 'x',
          label: 'X',
          firstDay: null,
          valueAt: (day) => {
            const row = rows.find(([d]) => d === day);
            return row === undefined
              ? null
              : { value: D(row[1]), contributed: D(row[2]), estimated: false };
          },
        },
      ],
      days: days(...rows.map(([d]) => d)),
    });

  it('sépare ce qui a été versé de ce qui a été gagné', () => {
    // 1 000 € au départ, 500 € versés le 15, 1 700 € à l'arrivée : 200 € de gain, pas 700.
    const change = netWorthChange(
      series(
        ['2026-08-01', '1000', '1000'],
        ['2026-08-15', '1500', '1500'],
        ['2026-08-31', '1700', '1500'],
      ),
    );
    expect(change?.netFlows.toString()).toBe('500');
    expect(change?.gain.toString()).toBe('200');
    expect(change?.startValue.toString()).toBe('1000');
    expect(change?.endValue.toString()).toBe('1700');
  });

  it('un dépôt seul ne produit AUCUN gain — le piège du solde de compte', () => {
    const change = netWorthChange(
      series(['2026-08-01', '1000', '1000'], ['2026-08-31', '2000', '2000']),
    );
    expect(change?.gain.toString()).toBe('0');
    expect(change?.pct?.toString()).toBe('0');
  });

  it('depuis l’origine, le gain vaut exactement « valeur nette − apports nets »', () => {
    const points = series(
      ['2026-08-01', '1000', '1000'],
      ['2026-08-15', '1500', '1500'],
      ['2026-08-31', '1700', '1500'],
    );
    const change = netWorthChange(points, { fromInception: true })!;
    const last = latestNetWorth(points)!;
    expect(change.startValue.toString()).toBe('0');
    expect(change.gain.toString()).toBe(last.net.minus(last.contributed).toString());
    expect(change.endContributed.toString()).toBe('1500');
  });

  it('signale une fenêtre incomplète plutôt que de rendre une variation trop basse en silence', () => {
    const points = netWorthSeries({
      contributions: [
        flat('ok', '100'),
        { id: 'ko', label: 'KO', firstDay: null, valueAt: () => null },
      ],
      days: days('2026-08-01', '2026-08-02'),
    });
    expect(netWorthChange(points)?.incomplete).toBe(true);
  });

  it('rend null sur une série vide au lieu d’inventer une variation', () => {
    expect(netWorthChange([])).toBeNull();
  });
});

describe('réconciliation : apports + gain = patrimoine, et la somme des parts refait le tout', () => {
  const twoSpaces = () =>
    netWorthSeries({
      contributions: [
        valueSeriesContribution(
          'invest',
          'Investissement',
          [vp('2026-08-31', '16167.76', '18137.39')],
          contributedFrom(['2026-08-01', '23000'], ['2026-08-15', '-5570.31']),
        ),
        flat('hl', '5171.70', '5570.31'),
      ],
      days: days('2026-08-31'),
    });

  it('décompose le gain producteur par producteur', () => {
    const r = reconcileNetWorth(latestNetWorth(twoSpaces()))!;
    expect(r.net.toString()).toBe('21339.46');
    expect(r.contributed.toString()).toBe('23000');
    expect(r.gain.toString()).toBe('-1660.54');
    expect(r.lines.map((l) => [l.id, l.gain.toString()])).toEqual([
      // 23 000 versés, 5 570,31 partis au trading : 17 429,69 apportés à l'investissement pour
      // 16 167,76 de valeur. Le capital envoyé au trading n'est pas un retrait du patrimoine —
      // il réapparaît en apport de l'autre côté, et les deux lignes se recoupent au centime.
      ['invest', '-1261.93'],
      ['hl', '-398.61'],
    ]);
  });

  it('la somme des parts égale le total — l’identité que l’auto-vérification contrôle', () => {
    const r = reconcileNetWorth(latestNetWorth(twoSpaces()))!;
    const sumValue = r.lines.reduce((acc, l) => acc.plus(l.value), ZERO);
    const sumContributed = r.lines.reduce((acc, l) => acc.plus(l.contributed), ZERO);
    const sumGain = r.lines.reduce((acc, l) => acc.plus(l.gain), ZERO);
    expect(sumValue.toString()).toBe(r.net.toString());
    expect(sumContributed.toString()).toBe(r.contributed.toString());
    expect(sumGain.toString()).toBe(r.gain.toString());
  });

  it('garde une ligne pour une part non valorisable, à zéro, et déclare le total incomplet', () => {
    const points = netWorthSeries({
      contributions: [
        flat('ok', '100', '80'),
        { id: 'ko', label: 'KO', firstDay: null, valueAt: () => null },
      ],
      days: days('2026-08-01'),
    });
    const r = reconcileNetWorth(latestNetWorth(points))!;
    expect(r.incomplete).toBe(true);
    expect(r.lines.map((l) => [l.id, l.unavailable])).toEqual([
      ['ok', false],
      ['ko', true],
    ]);
  });

  it('rend null sans point plutôt qu’une réconciliation vide', () => {
    expect(reconcileNetWorth(null)).toBeNull();
  });
});

describe('variation par espace : recevoir du capital n’est pas en produire', () => {
  /** Investissement qui envoie 500 au trading ; le trading les reçoit et en perd 50. */
  const points = () =>
    netWorthSeries({
      contributions: [
        {
          id: 'invest',
          label: 'Investissement',
          firstDay: null,
          valueAt: (day) =>
            day === '2026-08-01'
              ? { value: D('1000'), contributed: D('1000'), estimated: false }
              : { value: D('500'), contributed: D('500'), estimated: false },
        },
        {
          id: 'hl',
          label: 'Trading',
          firstDay: null,
          valueAt: (day) =>
            day === '2026-08-01'
              ? { value: ZERO, contributed: ZERO, estimated: false }
              : { value: D('450'), contributed: D('500'), estimated: false },
        },
      ],
      days: days('2026-08-01', '2026-08-31'),
    });

  it('impute le capital reçu aux apports, jamais au gain', () => {
    const changes = netWorthPartChanges(points());
    expect(changes.map((c) => [c.id, c.contributions.toString(), c.gain.toString()])).toEqual([
      // L'investissement a « retiré » 500 : sa valeur baisse d'autant, il n'a rien perdu.
      ['invest', '-500', '0'],
      // Le trading a reçu 500 et en rend 450 : sa valeur monte de 450 et il a perdu 50.
      ['hl', '500', '-50'],
    ]);
  });

  it('la somme des gains par espace égale le gain total', () => {
    const list = points();
    const total = netWorthChange(list)!;
    const sum = netWorthPartChanges(list).reduce((acc, c) => acc.plus(c.gain), ZERO);
    expect(sum.toString()).toBe(total.gain.toString());
  });

  it('depuis l’origine, chaque espace part de zéro', () => {
    const changes = netWorthPartChanges(points(), { fromInception: true });
    expect(changes.map((c) => c.startValue.toString())).toEqual(['0', '0']);
    expect(changes.map((c) => c.gain.toString())).toEqual(['0', '-50']);
  });

  it('rend une liste vide sur une série vide', () => {
    expect(netWorthPartChanges([])).toEqual([]);
  });
});

describe('le pourcentage : rapporté aux apports pour le bilan, à la Dietz pour la fenêtre', () => {
  it('chaque ligne de la réconciliation porte son ROI, et le total le sien', () => {
    const points = netWorthSeries({
      contributions: [flat('a', '120', '100'), flat('b', '40', '100')],
      days: days('2026-08-31'),
    });
    const r = reconcileNetWorth(latestNetWorth(points))!;
    // a : +20 sur 100 versés = +20 % ; b : −60 sur 100 = −60 % ; total : −40 sur 200 = −20 %.
    expect(r.lines.map((l) => [l.id, l.roi?.toString() ?? null])).toEqual([
      ['a', '0.2'],
      ['b', '-0.6'],
    ]);
    expect(r.roi?.toString()).toBe('-0.2');
  });

  it('rien de versé : pas de pourcentage plutôt qu’une division de complaisance', () => {
    const points = netWorthSeries({
      contributions: [flat('don', '500', '0')],
      days: days('2026-08-31'),
    });
    const r = reconcileNetWorth(latestNetWorth(points))!;
    expect(r.roi).toBeNull();
    expect(r.lines[0]!.roi).toBeNull();
    expect(roiOf(D('10'), ZERO)).toBeNull();
    expect(roiOf(D('10'), D('-5'))).toBeNull();
  });

  it('un espace seul : son pourcentage EST celui du total, pas une seconde arithmétique', () => {
    const points = netWorthSeries({
      contributions: [
        {
          id: 'seul',
          label: 'Seul',
          firstDay: null,
          valueAt: (day) =>
            day === '2026-08-01'
              ? { value: D('1000'), contributed: D('1000'), estimated: false }
              : day === '2026-08-15'
                ? { value: D('1400'), contributed: D('1200'), estimated: false }
                : { value: D('1300'), contributed: D('1200'), estimated: false },
        },
      ],
      days: days('2026-08-01', '2026-08-15', '2026-08-31'),
    });
    for (const fromInception of [false, true]) {
      const total = netWorthChange(points, { fromInception })!;
      const [part] = netWorthPartChanges(points, { fromInception });
      expect(part!.gain.toString()).toBe(total.gain.toString());
      expect(part!.pct?.toString() ?? null).toBe(total.pct?.toString() ?? null);
    }
  });

  it('un apport le dernier jour ne pèse rien : base nulle, donc pas de pourcentage', () => {
    const points = netWorthSeries({
      contributions: [
        {
          id: 'tardif',
          label: 'Tardif',
          firstDay: null,
          valueAt: (day) =>
            day === '2026-08-31'
              ? { value: D('450'), contributed: D('500'), estimated: false }
              : { value: ZERO, contributed: ZERO, estimated: false },
        },
      ],
      days: days('2026-08-01', '2026-08-31'),
    });
    const [part] = netWorthPartChanges(points);
    expect(part!.gain.toString()).toBe('-50');
    expect(part!.pct).toBeNull();
  });

  it('deux espaces : chacun son pourcentage, sur son propre capital moyen', () => {
    const points = netWorthSeries({
      contributions: [
        flat('invest', '900', '1000'),
        {
          id: 'hl',
          label: 'Trading',
          firstDay: null,
          valueAt: (day) =>
            day === '2026-08-01'
              ? { value: D('200'), contributed: D('200'), estimated: false }
              : { value: D('260'), contributed: D('200'), estimated: false },
        },
      ],
      days: days('2026-08-01', '2026-08-31'),
    });
    const changes = netWorthPartChanges(points);
    // L'investissement ne bouge pas (0 sur 1 000 de base) ; le trading gagne 60 sur 200 = +30 %.
    expect(changes.map((c) => [c.id, c.pct?.toString() ?? null])).toEqual([
      ['invest', '0'],
      ['hl', '0.3'],
    ]);
  });
});
