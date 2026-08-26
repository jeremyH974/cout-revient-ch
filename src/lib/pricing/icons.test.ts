import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KNOWN_ICONS, NO_ICON, iconUrl } from './icons';
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

/**
 * Les contrôles ci-dessus vérifient la cohérence entre `KNOWN_ICONS` et le disque. Restait un angle
 * mort : un ticker de `TICKERS` sans logo ne déclenchait rien — il s'affichait en badge d'initiales,
 * sans qu'on puisse dire si c'était un choix ou un oubli. `NO_ICON` tranche, et ces tests exigent
 * que chaque ticker soit décidé dans un sens ou dans l'autre (P8, décision n° 47).
 */
describe('tickers sans logo : une absence décidée, jamais subie', () => {
  it('tranche le cas de chaque ticker : logo embarqué, ou absence motivée', () => {
    const undecided = Object.keys(TICKERS).filter((c) => !KNOWN_ICONS.has(c) && !NO_ICON.has(c));
    expect(undecided).toEqual([]);
  });

  it('ne classe aucun ticker dans les deux tables à la fois', () => {
    const both = [...NO_ICON.keys()].filter((c) => KNOWN_ICONS.has(c));
    expect(both).toEqual([]);
  });

  it('motive chaque absence, pour qu’un oubli ne passe pas pour un choix', () => {
    for (const [code, reason] of NO_ICON) {
      expect(reason.length, code).toBeGreaterThan(20);
    }
  });

  it('ne motive pas l’absence d’un ticker inconnu', () => {
    const orphans = [...NO_ICON.keys()].filter((c) => !(c in TICKERS));
    expect(orphans).toEqual([]);
  });
});
