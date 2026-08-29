import { describe, expect, it } from 'vitest';
import type { AccountDeclaration, DeclarationStatus } from '../domain/declarations-fr';
import {
  countryName,
  declarationsToText,
  renderDeclaration,
  renderDeclarations,
  STATUS_LABELS,
} from './declarations-fr';

const base: AccountDeclaration = {
  accountId: 'csv:nl',
  label: 'Bitvavo',
  status: 'included',
  country: 'NL',
  usedInYear: true,
  currentlyHolds: true,
  possiblyClosedInYear: false,
};

const STATUSES: readonly DeclarationStatus[] = [
  'excluded-domestic',
  'included',
  'uncertain-self-hosted',
  'unknown',
];

describe('rendu français des déclarations 3916-bis', () => {
  it('chaque statut produit une phrase complète, sans trou de formatage', () => {
    for (const status of STATUSES) {
      const rendered = renderDeclaration({
        ...base,
        status,
        country: status === 'unknown' || status === 'uncertain-self-hosted' ? null : base.country,
      });
      expect(rendered.detail.length).toBeGreaterThan(10);
      expect(rendered.detail).not.toMatch(/undefined|null|NaN|\[object/);
      expect(rendered.detail.endsWith('.')).toBe(true);
      expect(rendered.statusLabel).toBe(STATUS_LABELS[status]);
      expect(rendered.accountLabel).toBe('Bitvavo');
    }
  });

  it('un compte hors périmètre France ne dit jamais qu’il faut le déclarer', () => {
    const rendered = renderDeclaration({ ...base, status: 'excluded-domestic', country: 'FR' });
    expect(rendered.detail).toContain('hors périmètre');
    expect(rendered.detail).not.toContain('à déclarer');
  });

  it('un compte inclus nomme le pays et rappelle « même vide ou clos »', () => {
    const rendered = renderDeclaration(base);
    expect(rendered.detail).toContain('Pays-Bas');
    expect(rendered.detail).toContain('même vide ou clos');
    expect(rendered.detail).toContain('utilisé cette année');
  });

  it('un compte vide et non utilisé le dit, sans jamais prétendre qu’il a été utilisé', () => {
    const rendered = renderDeclaration({ ...base, usedInYear: false, currentlyHolds: false });
    expect(rendered.detail).toContain('actuellement vide');
    expect(rendered.detail).not.toContain('utilisé cette année');
  });

  it('un compte sans pays connu affiche « à l’étranger », jamais un pays inventé', () => {
    const rendered = renderDeclaration({ ...base, country: null });
    expect(rendered.detail).toContain('à l’étranger');
  });

  it('l’auto-hébergé renvoie l’avertissement exact, quel que soit le pays ou l’activité', () => {
    const rendered = renderDeclaration({
      ...base,
      status: 'uncertain-self-hosted',
      country: null,
      usedInYear: true,
      currentlyHolds: true,
    });
    expect(rendered.detail).toBe(
      'Portefeuille dont vous détenez seul la clé : le texte ne tranche pas ce cas — vérifiez avec un professionnel.',
    );
  });

  it('countryName retombe sur le code brut si le pays n’est pas dans la table', () => {
    expect(countryName('FR')).toBe('France');
    expect(countryName('ZZ')).toBe('ZZ');
  });

  it('declarationsToText : une ligne par compte, nom et statut lisibles sans autre contexte', () => {
    const text = declarationsToText(renderDeclarations([base]));
    expect(text).toBe(`- Bitvavo — ${STATUS_LABELS.included} : ${renderDeclaration(base).detail}`);
  });

  it('declarationsToText : plusieurs comptes, une ligne chacun, dans l’ordre reçu', () => {
    const other: AccountDeclaration = {
      ...base,
      accountId: 'oc:btc',
      label: 'Ledger BTC',
      status: 'uncertain-self-hosted',
      country: null,
    };
    const text = declarationsToText(renderDeclarations([base, other]));
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('Bitvavo —');
    expect(text).toContain('Ledger BTC —');
  });
});
