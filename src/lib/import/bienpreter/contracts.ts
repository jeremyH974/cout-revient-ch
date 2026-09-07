/**
 * Archive de contrats BienPrêter : ce qui la lit, et ce qui l'applique aux prêts déjà importés.
 *
 * L'export CSV donne les mouvements, les contrats donnent les termes. Les deux se rejoignent par
 * le **numéro de contrat** : il nomme le fichier PDF, et il forme l'identifiant du prêt
 * (`bp:<numéro>`). Aucun appariement approximatif, aucune correspondance par montant ou par date —
 * un contrat qui ne trouve pas son prêt est signalé, jamais rapproché du plus ressemblant.
 *
 * **Ce que l'application écrase, et ce qu'elle respecte.** Le contrat fait foi sur les termes :
 * taux, convention de jours, mode d'amortissement, échéance, échéancier. Il ne touche à rien
 * d'autre — ni au capital souscrit, qui vient du relevé, ni aux événements, qui sont des faits.
 */
import type { Loan, LoanId } from '../../domain/lending/types';
import { PdfError, pdfTextRows } from '../pdf/index';
import { unzipEntries, ZipError } from '../xlsx/unzip';
import { parseBienPreterContract, type BienPreterContract } from './contract';

export interface ContractsRead {
  /** Contrats lus, indexés par numéro de contrat. */
  contracts: Map<string, BienPreterContract>;
  /** Fichiers qu'on n'a pas su lire, avec la raison — comptés, jamais tus. */
  rejected: { name: string; reason: string }[];
}

const CONTRACT_NUMBER = /([^/\\]+)\.pdf$/i;

/** Numéro de contrat porté par le nom du fichier ; `null` si ce n'est pas un PDF. */
function numberOf(path: string): string | null {
  const m = CONTRACT_NUMBER.exec(path);
  return m ? m[1]! : null;
}

async function readOne(bytes: Uint8Array): Promise<BienPreterContract | null> {
  const copy = bytes.slice();
  return parseBienPreterContract(await pdfTextRows(copy.buffer as ArrayBuffer));
}

/**
 * Lit une archive de contrats. Un PDF illisible n'interrompt pas les autres : chaque échec est
 * rattaché à son fichier, et l'archive rend ce qu'elle a pu.
 */
export async function readContractsArchive(buffer: ArrayBuffer): Promise<ContractsRead> {
  const contracts = new Map<string, BienPreterContract>();
  const rejected: { name: string; reason: string }[] = [];
  let entries: Map<string, Uint8Array>;
  try {
    entries = await unzipEntries(buffer);
  } catch (error) {
    throw error instanceof ZipError ? error : new ZipError(String(error));
  }
  for (const [path, bytes] of entries) {
    const number = numberOf(path);
    if (number === null) continue; // dossiers et fichiers annexes : ignorés sans bruit
    try {
      const contract = await readOne(bytes);
      if (contract) contracts.set(number, contract);
      else
        rejected.push({
          name: path,
          reason: 'aucun taux trouvé : ce n’est pas un contrat de prêt',
        });
    } catch (error) {
      rejected.push({
        name: path,
        reason: error instanceof PdfError ? error.message : 'lecture impossible',
      });
    }
  }
  return { contracts, rejected };
}

/**
 * Lit un fichier de contrats, quelle que soit sa forme : archive de l'espace investisseur, ou
 * contrat PDF isolé. Le numéro de contrat vient du nom du fichier dans les deux cas.
 */
export async function readContractFile(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<ContractsRead> {
  if (!/\.pdf$/i.test(fileName)) return readContractsArchive(buffer);
  const number = fileName.replace(/\.pdf$/i, '');
  try {
    const one = await parseBienPreterContract(await pdfTextRows(buffer));
    if (one) return { contracts: new Map([[number, one]]), rejected: [] };
    return { contracts: new Map(), rejected: [{ name: fileName, reason: 'aucun taux trouvé' }] };
  } catch (error) {
    return {
      contracts: new Map(),
      rejected: [
        {
          name: fileName,
          reason: error instanceof PdfError ? error.message : 'lecture impossible',
        },
      ],
    };
  }
}

/** Lit un unique contrat PDF (le même chemin, sans archive). */
export async function readContractPdf(buffer: ArrayBuffer): Promise<BienPreterContract | null> {
  return parseBienPreterContract(await pdfTextRows(buffer));
}

export interface ContractsApplied {
  loans: Record<LoanId, Loan>;
  /** Prêts dont les termes viennent d'être complétés. */
  applied: number;
  /** Numéros de contrat sans prêt correspondant : l'export CSV ne les connaît pas. */
  unmatched: string[];
}

/**
 * Reporte les termes de chaque contrat sur son prêt. Les prêts sans contrat gardent leurs
 * `unknown` : c'est l'absence qui doit rester visible, pas une valeur de remplissage.
 */
export function applyContracts(
  loans: Readonly<Record<LoanId, Loan>>,
  contracts: ReadonlyMap<string, BienPreterContract>,
): ContractsApplied {
  const out: Record<LoanId, Loan> = { ...loans };
  const unmatched: string[] = [];
  let applied = 0;
  for (const [number, contract] of contracts) {
    const id = `bp:${number}`;
    const loan = out[id];
    if (!loan) {
      unmatched.push(number);
      continue;
    }
    out[id] = {
      ...loan,
      rate: contract.rate,
      dayCount: contract.dayCount,
      amortisation: contract.amortisation,
      maturity: contract.maturity ?? loan.maturity,
      ...(contract.schedule.length > 0 ? { schedule: contract.schedule } : {}),
    };
    applied += 1;
  }
  return { loans: out, applied, unmatched };
}
