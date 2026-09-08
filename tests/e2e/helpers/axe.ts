/**
 * Audit axe partagé. Extrait d'`a11y.spec.ts` le jour où un écran a eu besoin d'être audité
 * **avec ses données** : la boucle de routes d'`a11y.spec.ts` visite les écrans à vide ou avec la
 * démo, or certains blocs — un anneau, un graphique — n'existent qu'une fois un import fait, et
 * n'étaient donc jamais vus par axe.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export async function expectNoViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact ?? '?'}) : ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(summary, `violations axe sur ${label}`).toEqual([]);
}
