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

/** Chaque ligne de l'annexe 2086, dans l'ordre du formulaire (cerfa n° 16043). */
const FORM_LINES = {
  cessionDate: 0,
  globalValue: 1,
  proceeds: 2,
  fees: 3,
  netProceeds: 4,
  soulte: 5,
  proceedsNetOfSoultes: 6,
  netProceedsAfterSoultes: 7,
  acquisition: 8,
  capitalFraction: 9,
  priorSoultes: 10,
  netAcquisition: 11,
  gain: 12,
};

describe('détection de l’annexe 2086', () => {
  it('reconnaît un fichier en numéros de ligne, les treize lignes du formulaire', () => {
    const detection = detectFile('2086-concordant.csv');
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.format).toBe('waltio-2086');
    expect(detection.columns).toEqual(FORM_LINES);
    expect(detection.unknownColumns).toEqual([]);
    // La méthode d'une annexe 2086 est imposée par la loi : rien à déclarer.
    expect(detection.declaredMethod).toBe('fr-global');
  });

  it('numérote comme le formulaire : 216 est une soulte, 220 le prix d’acquisition, 223 son net', () => {
    // La première version lisait 216 comme le prix d'acquisition et 220 comme la plus-value, ce
    // qu'aucun des sept millésimes du formulaire n'a jamais fait : le prix d'acquisition d'un
    // fichier y était comparé à notre plus-value.
    const detection = detectSecondOpinion(['211', '216', '220', '223', '224']);
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.columns).toEqual({
      cessionDate: 0,
      soulte: 1,
      acquisition: 2,
      netAcquisition: 3,
      gain: 4,
    });
  });

  it('reconnaît le même fichier en libellés du formulaire, avec un autre séparateur', () => {
    const detection = detectFile('2086-libelles.csv');
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.columns).toEqual(FORM_LINES);
    // « Devise » est une colonne de contexte connue : jamais signalée comme inconnue.
    expect(detection.unknownColumns).toEqual([]);
  });

  it('accepte une date et une plus-value seules (deux colonnes retirées du tableur)', () => {
    const detection = detectSecondOpinion(['Date de la cession', 'Plus-value ou moins-value']);
    expect(detection.ok).toBe(true);
  });

  it('lit la plus-value sous le libellé de sa ligne de formule, qui n’a pas de numéro', () => {
    const detection = detectSecondOpinion(['Date de la cession', 'Plus-values et moins-values']);
    expect(detection.ok && detection.columns.gain).toBe(1);
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
