import { expect, type Page } from '@playwright/test';

/**
 * Ouvre une section repliable des Réglages **comme l'utilisateur** : un clic sur son titre.
 *
 * Sur un écran large, les sections sont déjà dépliées (décision n° 185) et cet appel ne fait rien —
 * sauf pour la **zone dangereuse**, volontairement repliée sur tous les écrans : effacer toutes ses
 * données ne doit pas être à un seul geste. Tout parcours de test qui l'emprunte passe donc par
 * ici, exactement comme le propriétaire de l'application.
 */
export async function openSettingsSection(page: Page, id: string): Promise<void> {
  const details = page.locator(`details#${id}`);
  await expect(details).toBeVisible();
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open)))
    await details.locator('summary').first().click();
  await expect(details).toHaveJSProperty('open', true);
}
