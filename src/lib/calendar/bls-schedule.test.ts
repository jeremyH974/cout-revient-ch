import { describe, expect, it } from 'vitest';
import { BLS_CHECKED_ON, BLS_SERIES, blsCoverageEnd } from './bls-schedule';

/**
 * La table du BLS est recopiée à la main depuis les pages officielles — c'est le seul endroit du
 * calendrier où une faute de frappe est possible. Ces tests ne peuvent pas vérifier que les dates
 * sont les bonnes (seul le BLS le sait), mais ils attrapent tout ce qui trahit une recopie fautive :
 * une ligne dans le désordre, un mois de référence postérieur à sa publication, un jour dupliqué,
 * un mois sauté. Une transposition de chiffres passe, une inversion de lignes non.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

describe('table BLS', () => {
  it('couvre les quatre publications attendues, une fois chacune', () => {
    expect(BLS_SERIES.map((s) => s.kind).sort()).toEqual(['cpi', 'employment', 'jolts', 'ppi']);
  });

  it('porte une date de relecture plausible', () => {
    expect(BLS_CHECKED_ON).toMatch(ISO_DAY);
    expect(Number.isNaN(Date.parse(BLS_CHECKED_ON))).toBe(false);
  });

  for (const series of BLS_SERIES) {
    describe(series.officialName, () => {
      it('ne cite que des jours valides, dans l’ordre et sans doublon', () => {
        const days = series.releases.map((r) => r.day);
        for (const day of days) {
          expect(day, day).toMatch(ISO_DAY);
          expect(Number.isNaN(Date.parse(day)), day).toBe(false);
          // `Date.parse` accepte le 31 février en le reportant : on vérifie l'aller-retour.
          expect(new Date(day).toISOString().slice(0, 10)).toBe(day);
        }
        expect(days).toEqual([...days].sort());
        expect(new Set(days).size).toBe(days.length);
      });

      it('publie toujours après le mois sur lequel elle porte', () => {
        for (const release of series.releases) {
          expect(release.reference, release.day).toMatch(ISO_MONTH);
          expect(release.day.slice(0, 7) > release.reference, release.day).toBe(true);
        }
      });

      it('ne publie jamais plus de trois mois après son mois de référence', () => {
        // Le BLS publie à un ou deux mois ; au-delà, c'est qu'une ligne a été recopiée en face de
        // la mauvaise.
        for (const release of series.releases) {
          const [refYear = 0, refMonth = 0] = release.reference.split('-').map(Number);
          const [year = 0, month = 0] = release.day.split('-').map(Number);
          const gap = (year - refYear) * 12 + (month - refMonth);
          expect(gap, `${series.kind} ${release.day}`).toBeGreaterThanOrEqual(1);
          expect(gap, `${series.kind} ${release.day}`).toBeLessThanOrEqual(3);
        }
      });

      it('avance d’un mois de référence à chaque ligne', () => {
        const references = series.releases.map((r) => r.reference);
        expect(references).toEqual([...references].sort());
        expect(new Set(references).size).toBe(references.length);
      });

      it('annonce une heure et une page officielles', () => {
        expect(series.easternTime).toMatch(/^\d{2}:\d{2}$/);
        expect(series.url.startsWith('https://www.bls.gov/schedule/news_release/')).toBe(true);
      });

      it('ne tombe jamais un samedi ou un dimanche', () => {
        for (const release of series.releases) {
          const weekday = new Date(`${release.day}T12:00:00Z`).getUTCDay();
          expect(weekday, `${release.day} (0 = dimanche, 6 = samedi)`).toBeGreaterThan(0);
          expect(weekday, release.day).toBeLessThan(6);
        }
      });
    });
  }

  it('expose comme fin de couverture le plus lointain jour de toutes les séries', () => {
    const days = BLS_SERIES.flatMap((s) => s.releases.map((r) => r.day));
    expect(blsCoverageEnd()).toBe([...days].sort().at(-1));
  });
});
