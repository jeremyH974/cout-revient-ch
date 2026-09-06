/**
 * Lecture d'un contrat. Les lignes sont écrites à la main — inventées, jamais tirées d'un contrat
 * réel (décision n° 17) — mais elles reproduisent la forme observée : trois dates par échéance,
 * montants suivis d'un « € », et la phrase qui nomme la base de calcul.
 */
import { describe, expect, it } from 'vitest';
import { parseBienPreterContract } from './contract';

const HEADER = [
  "Article 3 Le taux d'intérêts conventionnel applicable au prêt est de 12 % par an.",
  'Le présent prêt est consenti pour une durée de 3 mois, qui commencera à courir à compter',
  "prêtée, les intérêts au taux fixe annuel de 12 %. Ces intérêts sont calculés sur la base d'une",
  'année civile.',
];

/** Une ligne d'annexe : date de facture, date de prélèvement, échéance, puis les trois montants. */
const row = (n: number, principal: string, interest: string, left: string): string =>
  `0${n}/09/2026 0${n}/10/2026 0${n}/11/2026 ${principal} € ${interest} € ${left} €`;

describe('parseBienPreterContract', () => {
  it('lit le taux en fraction, la durée et la convention de jours', () => {
    const c = parseBienPreterContract([...HEADER, row(1, '0.00', '10.00', '1000.00')])!;
    expect(c.rate).toBe('0.12');
    expect(c.months).toBe(3);
    expect(c.dayCount).toBe('act/365');
  });

  it('retient la TROISIÈME date : l’échéance, pas la facture ni le prélèvement', () => {
    const c = parseBienPreterContract([...HEADER, row(1, '0.00', '10.00', '1000.00')])!;
    expect(c.schedule[0]!.due).toBe('2026-11-01T00:00:00');
  });

  it('prend la dernière échéance pour échéance du prêt', () => {
    const c = parseBienPreterContract([
      ...HEADER,
      row(1, '0.00', '10.00', '1000.00'),
      row(3, '1000.00', '10.00', '0.00'),
      row(2, '0.00', '10.00', '1000.00'),
    ])!;
    expect(c.schedule).toHaveLength(3);
    expect(c.maturity).toBe('2026-11-03T00:00:00'); // trié, quel que soit l'ordre de lecture
  });

  it('reconnaît un in fine : aucun capital avant la dernière échéance', () => {
    const c = parseBienPreterContract([
      ...HEADER,
      row(1, '0.00', '10.00', '1000.00'),
      row(2, '0.00', '10.00', '1000.00'),
      row(3, '1000.00', '10.00', '0.00'),
    ])!;
    expect(c.amortisation).toBe('in-fine');
  });

  it('reconnaît un amortissement linéaire', () => {
    const c = parseBienPreterContract([
      ...HEADER,
      row(1, '100.00', '10.00', '200.00'),
      row(2, '100.00', '7.00', '100.00'),
      row(3, '100.00', '3.00', '0.00'),
    ])!;
    expect(c.amortisation).toBe('linear');
  });

  it('reconnaît des annuités constantes', () => {
    const c = parseBienPreterContract([
      ...HEADER,
      row(1, '90.00', '20.00', '210.00'),
      row(2, '100.00', '10.00', '110.00'),
      row(3, '110.00', '0.00', '0.00'),
    ])!;
    expect(c.amortisation).toBe('constant');
  });

  it('laisse la convention en `unknown` plutôt que de la rapprocher d’une voisine', () => {
    const c = parseBienPreterContract([
      "Article 3 Le taux d'intérêts conventionnel applicable au prêt est de 9,5 % par an.",
      "Ces intérêts sont calculés sur la base d'une base singulière.",
    ])!;
    expect(c.rate).toBe('0.095');
    expect(c.dayCount).toBe('unknown');
    expect(c.months).toBeNull();
  });

  it('ne rend rien quand le document ne porte aucun taux', () => {
    expect(parseBienPreterContract(['Conditions générales', 'Article 1 Définitions'])).toBeNull();
  });

  it('ignore une ligne d’annexe incomplète au lieu de la deviner', () => {
    const c = parseBienPreterContract([
      ...HEADER,
      '01/09/2026 01/10/2026 10.00 € 1000.00 €', // deux dates seulement
      row(2, '0.00', '10.00', '1000.00'),
    ])!;
    expect(c.schedule).toHaveLength(1);
  });
});
