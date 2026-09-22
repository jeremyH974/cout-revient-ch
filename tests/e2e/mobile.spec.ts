import { expect, test } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('mobile : cartes, libellé « Réalisé » et navigation basse', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await openDemo(page);

  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav).toBeVisible();
  for (const label of ["Vue d'ensemble", 'Investissement', 'Trading', 'Plus']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  const box = await nav.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);

  await expect(page.locator('.head')).toBeHidden();
  const firstRow = page.getByRole('list', { name: 'Positions' }).getByRole('listitem').first();
  await expect(firstRow.getByText('Réalisé', { exact: true })).toBeVisible();
});

test('mobile : aucune page ne déborde horizontalement (pas de dézoom du navigateur)', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await openDemo(page);
  const problems: string[] = [];
  for (const route of [
    '#/',
    '#/invest',
    '#/invest/titles',
    '#/trading',
    '#/trading/seuil',
    '#/more',
    '#/market',
    '#/asset/btc',
    '#/asset/pepe',
    '#/import',
    '#/add',
    '#/settings',
    '#/help',
    '#/privacy',
    '#/report',
  ]) {
    await page.goto(route);
    await expect(page.getByRole('main')).toBeVisible();
    // Les éléments qui dépassent sont listés pour que le rapport de CI désigne le coupable.
    const metrics = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const culprits: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0 && r.width < vw * 1.6) {
          culprits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
        }
      }
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: vw,
        innerWidth: window.innerWidth,
        visualWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
        culprits: culprits.slice(0, 6),
      };
    });
    if (
      metrics.innerWidth !== metrics.visualWidth ||
      metrics.scrollWidth > metrics.clientWidth + 1
    ) {
      problems.push(
        `${route} : largeur ${metrics.innerWidth}/${metrics.visualWidth}, défilement ${metrics.scrollWidth} — ${metrics.culprits.join(', ') || 'aucun élément isolé'}`,
      );
    }
  }
  expect(problems, 'pages qui débordent sur mobile').toEqual([]);
});

/**
 * La barre d'onglets Trading tient sur UNE SEULE ligne, à 320 px (largeur du critère WCAG 1.4.10)
 * comme à 390 px (décision n° 158, puis n° 181 : plus de retour à la ligne, elle défile).
 *
 * Le test précédent ne voyait un débordement qu'avec les polices du poste qui le lance : le
 * cinquième onglet débordait de 12 px sur la CI Linux et tenait sous Windows. Vérifier que tous les
 * onglets partagent le même sommet (une seule ligne) plutôt que la seule largeur de la barre couvre
 * aussi ce cas, sans dépendre des polices installées.
 */
for (const width of [320, 390]) {
  test(`mobile étroit (${width} px) : la barre d’onglets Trading tient sur une ligne et défile`, async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'projet mobile uniquement');
    await openDemo(page);
    await page.setViewportSize({ width, height: 720 });
    await page.goto('#/trading/seuil');
    const tabs = page.getByRole('navigation', { name: 'Espace Trading' });
    // L'onglet courant (le dernier, « Seuil ») est ramené en vue au montage.
    await expect(tabs.getByRole('link', { name: 'Seuil' })).toBeVisible();
    const geometry = await tabs.evaluate((nav) => {
      const links = [...nav.querySelectorAll('a')];
      const tops = new Set(links.map((a) => Math.round(a.getBoundingClientRect().top)));
      return {
        oneLine: tops.size === 1,
        navRight: Math.round(nav.getBoundingClientRect().right),
        viewport: document.documentElement.clientWidth,
      };
    });
    expect(geometry.oneLine, "la barre d'onglets passe à la ligne").toBe(true);
    expect(
      geometry.navRight,
      "la barre d'onglets déborde du viewport au lieu de défiler",
    ).toBeLessThanOrEqual(geometry.viewport);
  });
}

/**
 * Les mailles du calendrier de P&L à 320 px (décision n° 165) : avec la semaine, quatre boutons et
 * deux flèches ne tiennent plus sur une ligne. Ils passent à la ligne au lieu de pousser la page.
 */
test('mobile étroit (320 px) : les mailles du calendrier passent à la ligne au lieu de déborder', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await openDemo(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('#/trading/stats');
  const grains = page.getByRole('radiogroup', { name: 'Maille du calendrier' });
  await grains.getByRole('radio', { name: 'Semaine', exact: true }).click();
  await expect(page.getByRole('list', { name: /^Semaines de \d{4}$/ })).toBeVisible();
  const overflow = await grains.evaluate((group) => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    controls: [...(group.parentElement?.querySelectorAll('button') ?? [])].map((b) =>
      Math.round(b.getBoundingClientRect().right),
    ),
  }));
  expect(
    Math.max(overflow.page, ...overflow.controls),
    `mailles du calendrier : ${JSON.stringify(overflow)}`,
  ).toBeLessThanOrEqual(overflow.viewport);
});

test('desktop : en-tête de colonnes visible, libellé « Réalisé » réservé aux lecteurs d’écran', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'projets desktop uniquement');
  await openDemo(page);
  await expect(page.locator('.head')).toBeVisible();
  await expect(page.locator('.head')).toHaveAttribute('aria-hidden', 'true');
  const firstRow = page.getByRole('list', { name: 'Positions' }).getByRole('listitem').first();
  // Réservé aux lecteurs d'écran : présent dans le DOM mais réduit à un pixel (technique « sr-only »).
  const label = firstRow.getByText('Réalisé', { exact: true });
  await expect(label).toHaveCount(1);
  const box = await label.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(1);
  expect(box!.height).toBeLessThanOrEqual(1);
});

/*
 * P124 — l'écran du téléphone, ci-dessous.
 */

test('mobile : la racine utilise 100svh, avec un repli 100vh pour les navigateurs qui l’ignorent', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await openDemo(page);
  const minHeight = await page.locator('.app').evaluate((el) => getComputedStyle(el).minHeight);
  expect(Number.parseFloat(minHeight)).toBeGreaterThan(0);

  /*
   * Le repli n'est réel que si les DEUX déclarations survivent à la construction. Une première
   * version les écrivait dans la MÊME règle (`min-height: 100vh; min-height: 100svh;`) : le
   * minifieur de Vite élaguait la première comme « morte », qui ne l'est que pour un navigateur
   * qui comprend `svh` — constaté sur le CSS construit, pas supposé (décision n° 75). `@supports`
   * isole les deux dans des règles distinctes, qu'aucun minifieur ne fusionne.
   */
  const cssHref = await page.locator('link[rel="stylesheet"]').first().getAttribute('href');
  const css = await (await page.request.get(new URL(cssHref!, BASE_URL).toString())).text();
  expect(css, 'repli 100vh absent du CSS construit').toContain('min-height:100vh');
  expect(css, '@supports (height:100svh) absent du CSS construit').toMatch(
    /@supports\s*\(height:\s*100svh\)/,
  );
});

test('mobile : Réglages — sections repliables, sommaire d’ancres, une seule section ouverte au départ', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await openDemo(page);
  await page.goto('#/settings');

  const sections = page.locator('.settings > details');
  const states = await sections.evaluateAll((els) =>
    els.map((el) => ({ id: el.id, open: (el as HTMLDetailsElement).open })),
  );
  // 10 sections dans le build public (11 en variante privée, avec « Sortie réseau »).
  expect(states.length).toBeGreaterThanOrEqual(10);
  expect(states.find((s) => s.id === 'donnees')?.open, '« Données » doit être ouverte').toBe(true);
  const others = states.filter((s) => s.id !== 'donnees');
  expect(
    others.every((s) => !s.open),
    'les autres sections doivent être repliées',
  ).toBe(true);

  // Le sommaire d'ancres ouvre la section visée SANS passer par le routeur à hash (`#coffre`
  // n'est pas une route : un `hashchange` la ferait atterrir sur la Vue d'ensemble).
  const toc = page.getByRole('navigation', { name: 'Sommaire des réglages' });
  await expect(toc).toBeVisible();
  await expect(page.locator('#coffre')).toHaveJSProperty('open', false);
  await toc.getByRole('link', { name: 'Coffre' }).click();
  await expect(page.locator('#coffre')).toHaveJSProperty('open', true);
  await expect(page).toHaveURL(/#\/settings$/);
});

test('mobile étroit : les interrupteurs sont des switches nommés, ligne entière cliquable, cible ≥ 44 px au doigt', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await page.goto('#/market');
  const toggle = page.getByRole('switch', { name: 'Ne montrer que les publications majeures' });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();

  const row = page.locator('label.switch-row').filter({ has: toggle });
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  // Pixel 7 (émulation Playwright) est un pointeur grossier : ≥ 44 px (var(--tap)) attendu ici.
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // Toute la ligne est cliquable : un clic sur le TEXTE (pas le glyphe) bascule l'interrupteur.
  await row.locator('span').click();
  await expect(toggle).toBeChecked();
});

test('mobile : Marché — aucun évènement passé dans le DOM avant le bouton, en-têtes de jour', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await page.goto('#/market');

  const headers = page.locator('article.card.day h3');
  expect(await headers.count()).toBeGreaterThan(0);
  expect((await headers.first().textContent())?.trim()).not.toBe('');

  // Repli par défaut : la section « Déjà publié » ne pose AUCUN `article.card.day` dans le DOM
  // tant que le bouton n'a pas été pressé — pas seulement masqué en CSS.
  const pastSection = page.locator('section[aria-labelledby="past-heading"]');
  expect(await pastSection.locator('article.card.day').count()).toBe(0);

  await page.getByRole('button', { name: /derniers jours de publications/ }).click();
  expect(await pastSection.locator('article.card.day').count()).toBeGreaterThan(0);
});

test('mobile : fiche actif — 20 opérations au plus, puis « Afficher plus »', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'projet mobile uniquement');
  await openDemo(page);
  await page.goto('#/asset/btc');

  const ops = page.locator('article.op');
  const initial = await ops.count();
  expect(initial).toBeLessThanOrEqual(20);

  const more = page.getByRole('button', { name: /Afficher .* de plus/ });
  if (await more.isVisible()) {
    await more.click();
    expect(await ops.count()).toBeGreaterThan(initial);
  }
});
