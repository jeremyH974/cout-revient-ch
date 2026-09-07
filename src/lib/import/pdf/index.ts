/**
 * Lecteur PDF minimal, sans dépendance : il ne rend que du TEXTE, en lignes.
 *
 * **Ce qu'il est.** De quoi lire les documents d'un producteur connu — un contrat de financement
 * participatif — sans embarquer `pdf.js` et ses trois cent kilo-octets dans un bundle servi à
 * chaque visiteur. Il couvre le cas droit : table de références croisées classique, flux
 * `FlateDecode`, polices `Type0/Identity-H` avec table `ToUnicode`.
 *
 * **Ce qu'il n'est pas.** Un lecteur PDF général. Les documents chiffrés et ceux qui rangent
 * leurs objets dans des flux compressés (`/ObjStm`) sont **refusés en le disant** — un lecteur qui
 * rendrait un document vide sur ces formes serait pire qu'absent. Il n'y a ici ni rendu, ni
 * images, ni formulaires, ni ordre de lecture savant : des lignes, à leur place sur la page.
 */
export { PdfError } from './objects';

import { pdfObjects } from './objects';
import { pdfRows } from './text';

/** Lignes de texte du document, dans l'ordre de lecture. Lève `PdfError` sur une forme refusée. */
export async function pdfTextRows(buffer: ArrayBuffer): Promise<string[]> {
  return pdfRows(await pdfObjects(buffer));
}
