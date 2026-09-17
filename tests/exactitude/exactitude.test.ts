/**
 * **Le banc d'essai d'exactitude, rejoué** (P73 — `docs/exactitude.md`).
 *
 * Trois épreuves par version, et chacune a sa raison :
 *
 * 1. **Le jeu est celui qui a été publié.** Son empreinte SHA-256 est dans le manifeste : un tiers
 *    qui la retrouve sait qu'il rejoue exactement ce qui a été publié, sans avoir à nous croire.
 * 2. **Les attendus se redérivent.** L'implémentation de référence, écrite à part du moteur, refait
 *    chaque montant publié. Un attendu retouché à la main, ou dérivé d'une formule depuis corrigée,
 *    se trahit ici — et c'est aussi ce qui garantit que la page publiée dit le même que le jeu.
 * 3. **Le moteur de l'application produit ces montants**, exactement : aucune tolérance.
 *
 * Aucune requête réseau, aucun prix de marché : la valeur globale du portefeuille est une donnée
 * d'entrée de chaque cas, comme sur le formulaire.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { D } from '../../src/lib/domain/money';
import { computeFrenchTax } from '../../src/lib/domain/tax-fr';
import type { LedgerEvent, TradeEvent } from '../../src/lib/domain/types';
import {
  dossier,
  empreinte,
  formater,
  lireJeu,
  lireManifeste,
  remplacerSection,
  rendreSection,
  type Cas,
} from './banc.ts';
import { deriver, type Operation } from './reference.ts';

const VERSIONS = ['v1'] as const;

/** Traduit les opérations neutres d'un cas en événements du grand livre de l'application. */
function grandLivre(cas: Cas): { events: LedgerEvent[]; annotations: Record<string, string> } {
  let rang = 0;
  const base = () => ({
    id: `exactitude:${cas.id}:${++rang}`,
    source: 'manual' as const,
    scope: 'coinhouse' as const,
    accountId: 'ch:main' as const,
    rowKeys: [],
    warnings: [],
  });
  const echange = (
    at: string,
    out: { asset: string; qty: string },
    into: { asset: string; qty: string },
    valueEur: string,
    fee: TradeEvent['fee'],
  ): TradeEvent => ({
    ...base(),
    kind: 'trade',
    at,
    out,
    in: into,
    valueEur,
    valueEurSource: 'manual',
    fee,
    quotePrice: null,
  });

  const annotations: Record<string, string> = {};
  const events = cas.operations.map((op: Operation): LedgerEvent => {
    switch (op.nature) {
      case 'achat':
        return echange(
          op.date,
          { asset: 'eur', qty: op.euros },
          { asset: op.actif, qty: '1' },
          op.euros,
          null,
        );
      case 'echange':
        // Échange entre actifs numériques : la valeur en euros n'y joue aucun rôle fiscal.
        return echange(
          op.date,
          { asset: op.cede, qty: '1' },
          { asset: op.recu, qty: '1' },
          '0',
          null,
        );
      case 'vente': {
        const remise = op.remise ?? '0';
        const event = echange(
          op.date,
          { asset: op.actif, qty: '1' },
          { asset: 'eur', qty: op.euros },
          op.euros,
          {
            asset: 'eur',
            gross: op.frais,
            rebate: remise,
            grossEur: op.frais,
            rebateEur: remise,
          },
        );
        annotations[event.id] = op.valeurGlobale;
        return event;
      }
    }
  });
  return { events, annotations };
}

/** Égalité exacte de deux montants décimaux, quelle que soit leur écriture (« 2500 » = « 2500.0 »). */
const egal = (recu: string | null, attendu: string, libelle: string): void => {
  expect(recu, libelle).not.toBeNull();
  expect(D(recu!).eq(D(attendu)), `${libelle} : reçu ${recu}, attendu ${attendu}`).toBe(true);
};

for (const version of VERSIONS) {
  describe(`banc d'essai d'exactitude ${version}`, () => {
    const manifeste = lireManifeste(version);
    const texte = readFileSync(`${dossier(version)}/cas.json`, 'utf8');
    const jeu = lireJeu(version);

    it('le jeu est exactement celui dont le manifeste publie l’empreinte', () => {
      expect(manifeste.version).toBe(version);
      expect(jeu.version).toBe(version);
      expect(empreinte(texte), 'cas.json a changé depuis sa génération').toBe(manifeste.empreinte);
    });

    it('la page publiée dit exactement ce que dit le jeu', async () => {
      // Sans cette épreuve, la page pourrait afficher des montants que le banc ne vérifie plus.
      const page = readFileSync('docs/exactitude.md', 'utf8');
      const attendue = await formater(
        remplacerSection(page, version, rendreSection(jeu)),
        'docs/exactitude.md',
      );
      expect(page).toBe(attendue);
    });

    for (const cas of jeu.cas) {
      describe(`${cas.id} — ${cas.titre}`, () => {
        it('les attendus publiés se redérivent de ses seules opérations', () => {
          expect(cas.attendu, `${cas.id} n'a pas d'attendu`).toBeDefined();
          expect(deriver(cas.operations, cas.taux)).toEqual(cas.attendu);
        });

        it('le moteur de l’application produit chaque ligne de l’annexe 2086', () => {
          const { events, annotations } = grandLivre(cas);
          const ledger = computeFrenchTax({ events, annotations });
          const attendu = cas.attendu!;

          expect(ledger.cessions.map((c) => c.at.slice(0, 10))).toEqual(
            attendu.cessions.map((c) => c.date),
          );
          ledger.cessions.forEach((c, i) => {
            const a = attendu.cessions[i]!;
            const ici = `${cas.id}, cession du ${a.date}`;
            egal(c.globalValueEur, a.l212, `${ici}, l. 212`);
            egal(c.feesEur, a.l214, `${ici}, l. 214`);
            egal(c.proceedsEur, a.l218, `${ici}, l. 218`);
            egal(c.ptaBefore, a.l223, `${ici}, l. 223`);
            egal(c.acquisitionShareEur, a.fraction, `${ici}, fraction imputée`);
            egal(c.gainEur, a.l224, `${ici}, l. 224`);
            egal(c.ptaAfter, a.ptaApres, `${ici}, prix d'acquisition restant`);
          });

          expect(ledger.years.map((y) => y.year).sort()).toEqual(
            attendu.annees.map((a) => a.annee),
          );
          for (const a of attendu.annees) {
            const y = ledger.years.find((year) => year.year === a.annee)!;
            const ici = `${cas.id}, année ${a.annee}`;
            egal(y.proceedsEur, a.l51, `${ici}, l. 51`);
            expect(y.exempt, `${ici}, exonération`).toBe(a.exoneree);
            egal(y.gainsEur, a.plusValues, `${ici}, plus-values`);
            egal(y.lossesEur, a.moinsValues, `${ici}, moins-values`);
            egal(y.netEur, a.net, `${ici}, résultat net`);
            egal(y.rate, a.taux, `${ici}, taux`);
            egal(y.taxEur, a.impot, `${ici}, impôt`);
          }
        });
      });
    }
  });
}
