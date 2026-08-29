import { describe, expect, it } from 'vitest';
import { parseCsvText } from '../csv';
import { canonHeader, detectSecondOpinion, parseCostBasisMethod } from './detect';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../../tests/fixtures/second-opinion/${name}`, import.meta.url)),
    'utf8',
  );

const detectFile = (name: string) => detectSecondOpinion(parseCsvText(fixture(name)).header);

describe('canonHeader', () => {
  it('efface la casse, les accents, les apostrophes typographiques et les espaces insécables', () => {
    expect(canonHeader('  Prix   total d’ACQUISITION ')).toBe("prix total d'acquisition");
    expect(canonHeader('Valeur globale')).toBe('valeur globale');
    expect(canonHeader('Méthode :')).toBe('methode');
  });

  it('efface un suffixe d’unité ou un numéro de case entre parenthèses', () => {
    expect(canonHeader('Prix de cession (€)')).toBe('prix de cession');
    expect(canonHeader('Valeur globale du portefeuille (EUR)')).toBe(
      'valeur globale du portefeuille',
    );
    expect(canonHeader('Valeur globale du portefeuille (212)')).toBe(
      'valeur globale du portefeuille',
    );
  });

  it('n’efface PAS une parenthèse qui distingue réellement deux colonnes', () => {
    expect(canonHeader('Prix de cession (net des frais)')).toBe('prix de cession (net des frais)');
  });
});

describe('détection de l’annexe 2086', () => {
  it('reconnaît un fichier en numéros de case', () => {
    const detection = detectFile('2086-concordant.csv');
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.format).toBe('waltio-2086');
    expect(detection.columns.cessionDate).toBe(0);
    expect(detection.columns.netProceeds).toBe(4);
    expect(detection.columns.gain).toBe(6);
    // La méthode d'une annexe 2086 est imposée par la loi : rien à déclarer.
    expect(detection.declaredMethod).toBe('fr-global');
  });

  it('reconnaît le même fichier en libellés français, avec un autre séparateur', () => {
    const detection = detectFile('2086-libelles.csv');
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.columns.globalValue).toBe(1);
    expect(detection.columns.acquisition).toBe(3);
    // « Devise » est une colonne de contexte connue : jamais signalée comme inconnue.
    expect(detection.unknownColumns).toEqual([]);
  });

  it('accepte une date et une plus-value seules (deux colonnes retirées du tableur)', () => {
    const detection = detectSecondOpinion(['Date de la cession', 'Plus-value ou moins-value']);
    expect(detection.ok).toBe(true);
  });

  it('renonce quand il ne reste qu’une date', () => {
    const detection = detectSecondOpinion(['Date de la cession']);
    expect(detection.ok).toBe(false);
    if (detection.ok) return;
    expect(detection.reason).toBe('unrecognised');
  });
});

describe('refus explicites', () => {
  it('un export sans aucun chiffre calculé est refusé en le disant', () => {
    const detection = detectFile('blockpit-transactions.csv');
    expect(detection.ok).toBe(false);
    if (detection.ok) return;
    expect(detection.reason).toBe('no-calculated-figures');
    expect(detection.tool).toBe('blockpit');
  });

  it('un format pivot est un IMPORT, pas un second avis', () => {
    const detection = detectSecondOpinion([
      'Date',
      'Sent Amount',
      'Sent Currency',
      'Received Amount',
      'Received Currency',
    ]);
    expect(detection.ok).toBe(false);
    if (detection.ok) return;
    expect(detection.reason).toBe('transactions-only');
  });

  it('un rapport chiffré reconnu mais pas encore comparable l’annonce honnêtement', () => {
    for (const [name, tool] of [
      ['cointracker-gains.csv', 'cointracker'],
      ['cointracking-gains.csv', 'cointracking'],
    ] as const) {
      const detection = detectFile(name);
      expect(detection.ok).toBe(false);
      if (detection.ok) continue;
      expect(detection.reason).toBe('not-yet-comparable');
      expect(detection.tool).toBe(tool);
    }
  });

  it('un en-tête inconnu nomme les colonnes cherchées plutôt que d’analyser de travers', () => {
    const detection = detectSecondOpinion(['Colonne A', 'Colonne B']);
    expect(detection.ok).toBe(false);
    if (detection.ok) return;
    expect(detection.reason).toBe('unrecognised');
    expect(detection.looked).toContain('Prix de cession (213)');
    expect(detection.found).toEqual(['Colonne A', 'Colonne B']);
  });

  it('un en-tête vide renonce plutôt que de lever', () => {
    const detection = detectSecondOpinion([]);
    expect(detection.ok).toBe(false);
  });
});

describe('parseCostBasisMethod', () => {
  it('reconnaît les méthodes usuelles', () => {
    expect(parseCostBasisMethod('FIFO')).toBe('fifo');
    expect(parseCostBasisMethod('Lifo (dernier entré)')).toBe('lifo');
    expect(parseCostBasisMethod('HIFO')).toBe('hifo');
    expect(parseCostBasisMethod('ACB')).toBe('acb');
    expect(parseCostBasisMethod('OPTI')).toBe('opti');
    expect(parseCostBasisMethod('Coût moyen pondéré')).toBe('wac');
    expect(parseCostBasisMethod('Méthode globale (150 VH bis)')).toBe('fr-global');
  });

  it('un libellé non reconnu reste « unknown », jamais deviné', () => {
    expect(parseCostBasisMethod('Notre méthode maison')).toBe('unknown');
    expect(parseCostBasisMethod('')).toBe('unknown');
  });
});
