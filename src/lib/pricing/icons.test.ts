import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KNOWN_ICONS, iconUrl } from './icons';
import { TICKERS } from './tickers';

const ICONS_DIR = new URL('../../../public/icons/', import.meta.url);
const files = readdirSync(ICONS_DIR)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.slice(0, -'.svg'.length))
  .sort();

describe('logos embarqués (public/icons)', () => {
  it('chaque entrée de KNOWN_ICONS a son fichier', () => {
    const missing = [...KNOWN_ICONS].filter((code) => !files.includes(code));
    expect(missing).toEqual([]);
  });

  it('chaque fichier a son entrée dans KNOWN_ICONS', () => {
    const orphans = files.filter((code) => !KNOWN_ICONS.has(code));
    expect(orphans).toEqual([]);
  });

  it('les fichiers portent un ticker minuscule connu de la table des prix', () => {
    for (const code of files) {
      expect(code).toMatch(/^[a-z0-9]+$/);
      expect(TICKERS).toHaveProperty(code);
    }
  });

  it('aucun SVG ne contient de script ni de référence externe (CSP, vie privée)', () => {
    for (const code of files) {
      const svg = readFileSync(new URL(`${code}.svg`, ICONS_DIR), 'utf8');
      expect(svg, code).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(svg, code).not.toMatch(
        /<script|<image|<foreignObject|href=|https?:\/\/(?!www\.w3\.org)/,
      );
    }
  });

  it('iconUrl pointe sous BASE_URL, insensible à la casse, null sinon', () => {
    expect(iconUrl('btc')).toBe(`${import.meta.env.BASE_URL}icons/btc.svg`);
    expect(iconUrl('BTC')).toBe(iconUrl('btc'));
    expect(iconUrl('zzz')).toBeNull();
  });
});
