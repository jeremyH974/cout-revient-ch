/**
 * Le texte de loi derrière un chiffre fiscal affiché (décision n° 80).
 *
 * `tax-fr.ts` ne porte qu'un **identifiant** — `sourceId: 'pfu-31_4'` — parce que le domaine reste
 * pur et que deux tables portant la même citation divergeraient au premier amendement. C'est ici
 * que le lien se résout, au moment de l'affichage, comme `format/watch.ts` habille déjà l'écran de
 * veille.
 *
 * Pourquoi cela compte : un utilisateur qui lit « 31,4 % » dans son rapport n'a autrement aucun
 * moyen de savoir d'où vient ce nombre ni de quand il date — et **le BOFiP applicable affiche
 * encore 30 %**, sans mise à jour depuis avril 2024. L'écart entre la loi et la doctrine est réel :
 * l'outil le porte plutôt que de le subir.
 */
import { EXEMPTION_THRESHOLD_SOURCE_ID, type TaxRate } from '../domain/tax-fr';
import { WATCH_ENTRIES, type WatchEntry } from '../watch/entries';

/** L'entrée de veille désignée par un identifiant, ou `null` si aucun n'est déclaré. */
export function watchEntryOf(sourceId: string | undefined): WatchEntry | null {
  if (!sourceId) return null;
  return WATCH_ENTRIES.find((entry) => entry.id === sourceId) ?? null;
}

/** Citation courte : le texte et la date à laquelle il a été relu. */
export function citationOf(entry: WatchEntry | null): string | null {
  return entry ? `${entry.source.label} — relu le ${frDate(entry.source.checkedOn)}` : null;
}

/** `AAAA-MM-JJ` → `JJ/MM/AAAA`, sans passer par `Date` (dates civiles, jamais de fuseau). */
function frDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return day && month && year ? `${day}/${month}/${year}` : iso;
}

/**
 * La phrase à poser sous une estimation fiscale : d'où viennent le taux et le seuil appliqués.
 *
 * Rendue **une fois** par section plutôt qu'à chaque millésime — répéter la même citation trois
 * lignes de suite la ferait cesser d'être lue.
 */
export function taxSourcesNote(rate: TaxRate): string | null {
  const parts: string[] = [];
  const rateCitation = citationOf(watchEntryOf(rate.sourceId));
  if (rateCitation) parts.push(`Taux ${rate.label} : ${rateCitation}`);
  const thresholdCitation = citationOf(watchEntryOf(EXEMPTION_THRESHOLD_SOURCE_ID));
  if (thresholdCitation) parts.push(`Seuil d’exonération : ${thresholdCitation}`);
  return parts.length > 0 ? `${parts.join('. ')}.` : null;
}
