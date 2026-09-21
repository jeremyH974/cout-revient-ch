/**
 * Ce que le rapport de patrimoine doit dire, et ce qu'il doit refuser de dire.
 *
 * Les cas ci-dessous ne vérifient pas des chiffres — `reconcileNetWorth` a ses propres tests, et ce
 * module ne calcule rien. Ils vérifient les **refus** : un total incomplet qui s'annonce incomplet,
 * une part sans résultat qui dit pourquoi, un multiple indéfini qui n'est pas écrit « 0 % », et un
 * périmètre vide qui se nomme au lieu de disparaître. C'est là que se joue l'honnêteté d'un document
 * qui circule détaché de l'application qui l'a produit.
 */
import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../domain/money';
import { fmtMoney, fmtPct, MASK } from '../format/fr';
import {
  latestNetWorth,
  netWorthSeries,
  reconcileNetWorth,
  type Contribution,
  type NetWorthReconciliation,
} from '../history/net-worth';
import type { DayString } from '../history/types';
import { buildGlobalReportModel, type GlobalReportOptions } from './global-report-model';
import { section, tableOf, type ReportKpi, type ReportModel } from './report-model';

const DAY = '2026-09-20';
const days = (...list: string[]): DayString[] => list as DayString[];
const eur = (amount: string, sign = false): string => fmtMoney(D(amount), 'EUR', { sign });

/** Producteur constant : la valeur et les apports suffisent à tous les cas de ce fichier. */
const flat = (id: string, label: string, value: string, contributed = '0'): Contribution => ({
  id,
  label,
  space: 'invest',
  firstDay: null,
  valueAt: () => ({ value: D(value), contributed: D(contributed), estimated: false }),
});

/** Producteur non valorisable : sa part vaut zéro et le total est incomplet (décision n° 97). */
const unvaluable = (id: string, label: string): Contribution => ({
  id,
  label,
  space: 'invest',
  firstDay: null,
  valueAt: () => null,
});

/** Valeur servie par une plateforme, mais qui ne se recoupe pas avec son grand livre. */
const unreconciled = (id: string, label: string, contributed: string): Contribution => ({
  id,
  label,
  space: 'invest',
  firstDay: null,
  valueAt: () => ({
    value: ZERO,
    contributed: D(contributed),
    estimated: false,
    unreconciled: true,
  }),
});

const reconcile = (...contributions: Contribution[]): NetWorthReconciliation =>
  reconcileNetWorth(latestNetWorth(netWorthSeries({ contributions, days: days(DAY) })))!;

const build = (r: NetWorthReconciliation, extra: Partial<GlobalReportOptions> = {}): ReportModel =>
  buildGlobalReportModel(r, {
    discreet: false,
    generatedAt: '2026-09-20T18:00:00.000Z',
    version: '0.1.0',
    timeZone: 'Europe/Paris',
    ...extra,
  });

const kpisOf = (m: ReportModel): ReportKpi[] => {
  const block = section(m, 'summary')?.block;
  return block?.kind === 'kpis' ? block.kpis : [];
};
const detailsOf = (m: ReportModel): ReportKpi[] => {
  const block = section(m, 'summary')?.block;
  return block?.kind === 'kpis' ? block.details : [];
};
const bulletsOf = (m: ReportModel): string[] => {
  const block = section(m, 'coverage')?.block;
  return block?.kind === 'bullets' ? [...block.items] : [];
};

/** Trois espaces, tous valorisés : le cas ordinaire. */
const threeSpaces = () =>
  reconcile(
    flat('invest', 'Investissement', '12000', '10000'),
    flat('0xabc', 'Trading', '3000', '4000'),
    flat('lending', 'Prêts', '2700', '2250'),
  );

describe('buildGlobalReportModel', () => {
  it('donne au rapport sa propre séquence de sections, sans toucher aux rendus', () => {
    const m = build(threeSpaces());
    expect(m.sections.map((s) => s.id)).toEqual([
      'summary',
      'contribution',
      'coverage',
      'methodology',
    ]);
    // Les six formes de `ReportBlock` suffisent : aucune n'est inventée pour ce périmètre.
    expect([...new Set(m.sections.map((s) => s.block.kind))].sort()).toEqual([
      'bullets',
      'kpis',
      'paragraphs',
      'table',
    ]);
  });

  /**
   * **Le bandeau EST le pont.** Apports nets, puis résultat, puis patrimoine : lus de gauche à
   * droite, les trois chiffres sont l'identité elle-même. Les intervertir en ferait trois nombres
   * sans lien, et c'est le seul endroit du rapport où l'ordre porte du sens.
   */
  it('pose le pont dans l’ordre de l’identité, le multiple en dernier', () => {
    const m = build(threeSpaces());
    expect(kpisOf(m).map((k) => k.label)).toEqual([
      'Apports nets',
      'Résultat',
      'Patrimoine',
      'Résultat ÷ apports',
    ]);
    expect(kpisOf(m).map((k) => k.value)).toEqual([
      eur('16250'),
      eur('1450', true),
      eur('17700'),
      fmtPct(D('1450').div(D('16250'))),
    ]);
    expect(section(m, 'summary')?.lead).toContain('Apports nets + résultat = patrimoine');
  });

  it('refait le total en pied de tableau, et la part de chacun', () => {
    const table = tableOf(build(threeSpaces()), 'contribution')!;
    expect(table.rows).toHaveLength(3);
    expect(table.rows.map((row) => row[0]?.text)).toEqual(['Investissement', 'Trading', 'Prêts']);
    expect(table.total?.map((c) => c.text)).toEqual([
      'Patrimoine',
      eur('17700'),
      eur('16250'),
      eur('1450', true),
      fmtPct(D('1'), { sign: false }),
    ]);
  });

  /**
   * **Une part non valorisable ne s'écrit pas « 0 € ».** C'est le mensonge le plus discret qu'un
   * consolidé puisse faire, et la raison d'être de la décision n° 97 : le document doit dire que le
   * total est incomplet, nommer la part, et refuser d'en tirer un résultat.
   */
  it('n’écrit pas zéro devant une part qu’il n’a pas pu valoriser', () => {
    const m = build(
      reconcile(flat('invest', 'Investissement', '9000', '8000'), unvaluable('lending', 'Prêts')),
    );
    const row = tableOf(m, 'contribution')!.rows[1]!;
    expect(row[0]?.text).toBe('Prêts');
    expect(row[0]?.sub).toBe('non valorisable');
    // La colonne Résultat se TAIT — elle n'affiche pas un gain nul.
    expect(row[3]?.text).toBe('—');
    const said = bulletsOf(m).join(' ');
    expect(said).toContain('Prêts');
    expect(said).toContain('INCOMPLET');
    expect(said).toContain('ne comptent pas pour zéro');
    expect(m.cover.notes.join(' ')).toContain('INCOMPLET');
  });

  it('affiche la valeur d’une part non recoupée, et refuse son résultat', () => {
    const m = build(
      reconcile(
        flat('invest', 'Investissement', '9000', '8000'),
        unreconciled('0xabc', 'Trading', '5000'),
      ),
    );
    const row = tableOf(m, 'contribution')!.rows[1]!;
    expect(row[0]?.sub).toBe('ne se recoupe pas');
    expect(row[2]?.text).toBe(eur('5000'));
    expect(row[3]?.text).toBe('—');
    expect(bulletsOf(m).join(' ')).toContain('aucun résultat n’en est déduit');
    expect(m.cover.notes.join(' ')).toContain('hérite le doute');
  });

  /**
   * **Un périmètre vide se nomme.** Dans un consolidé, une ligne qui disparaît se lit comme une
   * ligne à zéro : les deux ne veulent pas dire la même chose, et seule la seconde est une donnée.
   */
  it('nomme un périmètre sans donnée plutôt que de le faire disparaître', () => {
    const m = build(threeSpaces(), { emptyScopes: ['Trading'] });
    const bullet = bulletsOf(m).find((b) => b.startsWith('Trading'));
    expect(bullet, 'aucune puce ne nomme le périmètre vide').toBeDefined();
    expect(bullet).toContain('aucune donnée');
    expect(bullet).toContain('pas une omission');
  });

  /**
   * **Sans apport, le multiple n'est pas défini.** L'écrire « 0 % » serait faux : un dénominateur
   * nul ne donne pas zéro, il ne donne rien. C'est le piège documenté de ce type de ratio.
   */
  it('laisse le multiple indéfini quand rien n’a été versé, au lieu de l’écrire nul', () => {
    const m = build(reconcile(flat('invest', 'Investissement', '100')));
    const kpi = kpisOf(m).find((k) => k.label === 'Résultat ÷ apports')!;
    expect(kpi.value).toBe('—');
    expect(kpi.tone).toBe('neutral');
    expect(kpi.hint).toContain('n’est pas défini');
  });

  it('compte les parts qui ne rendent aucun résultat', () => {
    const m = build(
      reconcile(
        flat('invest', 'Investissement', '9000', '8000'),
        unvaluable('lending', 'Prêts'),
        unreconciled('0xabc', 'Trading', '5000'),
      ),
    );
    const detail = detailsOf(m).find((d) => d.label === 'Parts sans résultat')!;
    expect(detail.value).toBe('2');
  });

  it('masque les montants en mode discret, et garde les parts lisibles', () => {
    const m = build(threeSpaces(), { discreet: true });
    expect(kpisOf(m).find((k) => k.label === 'Patrimoine')?.value).toBe(MASK);
    // Une part est un pourcentage, pas un montant : la masquer ne protégerait rien.
    expect(tableOf(m, 'contribution')!.total?.[4]?.text).toBe(fmtPct(D('1'), { sign: false }));
  });

  /**
   * **Ce rapport ne nomme aucune plateforme.** L'avertissement du rapport d'investissement cite
   * Coinhouse — légitime là-bas, faux ici : ce document couvre aussi le trading et les prêts. Le
   * réemployer tel quel était l'erreur facile, puisque le type `ReportModel` est le même.
   */
  it('ne reprend pas l’avertissement du rapport d’investissement', () => {
    const m = build(threeSpaces());
    expect(JSON.stringify(m)).not.toContain('Coinhouse');
    expect(m.cover.disclaimer).toContain('Outil indépendant');
  });

  it('dit en méthodologie que le multiple ne se compare pas au rendement hors apports', () => {
    const block = section(build(threeSpaces()), 'methodology')?.block;
    const text = block?.kind === 'paragraphs' ? block.items.map((p) => p.text).join(' ') : '';
    expect(text).toContain('TWR');
    expect(text).toContain('insensible à la durée');
    // « contribution » et non « attribution » : le mot est un choix, pas un synonyme.
    expect(text).toContain('Ce n’est pas une attribution');
  });
});
