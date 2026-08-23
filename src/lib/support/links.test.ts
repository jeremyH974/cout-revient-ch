import { describe, expect, it } from 'vitest';
import { issueUrl } from './links';

describe('formulaire d’issue pré-rempli', () => {
  it('renseigne gabarit, titre et champs par identifiant', () => {
    const url = new URL(
      issueUrl(
        'fichier-non-reconnu',
        { header: 'Date,Montant', diagnostic: 'Version : 0.1.0' },
        '[Import] test',
      ),
    );
    expect(url.origin + url.pathname).toBe(
      'https://github.com/jeremyH974/cout-revient-ch/issues/new',
    );
    expect(url.searchParams.get('template')).toBe('fichier-non-reconnu.yml');
    expect(url.searchParams.get('title')).toBe('[Import] test');
    expect(url.searchParams.get('header')).toBe('Date,Montant');
    expect(url.searchParams.get('diagnostic')).toBe('Version : 0.1.0');
  });

  it('tronque un diagnostic trop long pour rester sous la limite d’URL', () => {
    const long = 'ligne de diagnostic avec des accents éèà\n'.repeat(400);
    const url = issueUrl('bug', { diagnostic: long });
    expect(url.length).toBeLessThanOrEqual(6000);
    expect(new URL(url).searchParams.get('diagnostic')).toContain('tronqué');
  });
});
