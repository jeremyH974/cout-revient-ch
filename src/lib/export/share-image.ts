/**
 * Rendu image de la carte de partage (P9, décision n° 53).
 *
 * **Canvas 2D, pas un SVG converti.** Sérialiser un SVG contenant du texte vers une image échoue de
 * deux façons silencieuses : `foreignObject` teinte le canvas sur plusieurs moteurs, et les polices
 * ne survivent pas à la sérialisation — on obtient une image vide ou dans une police de repli, sans
 * erreur. Du `fillText` explicite est déterministe, mesurable, et ne dépend d'aucune police
 * distante : deux contraintes qui comptent ici, entre la CSP du site et le fonctionnement hors
 * ligne.
 *
 * **1200 × 630** : le format d'aperçu attendu par Discord, et déjà celui de l'image Open Graph du
 * site (`index.html`). Deux géométries concurrentes dans un même dépôt finiraient par diverger.
 *
 * **La géométrie est une fonction pure**, séparée du dessin. `shareCardLayout` ne touche à aucun
 * contexte de rendu, si bien que `share-image.test.ts` peut vérifier — sans navigateur — que tout
 * le texte tient dans le cadre, y compris avec un libellé long. Le débordement silencieux est le
 * défaut classique d'une carte générée, et il ne se voit qu'une fois l'image postée.
 *
 * La largeur du texte est **estimée** à partir de la taille de police, sans `measureText` (qui
 * exigerait un contexte). L'estimation est délibérément large : elle sert à tronquer avant de
 * déborder, jamais à centrer au pixel.
 */
import type { ShareCard, ShareTone } from './share-card';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
const PADDING = 72;
const CONTENT = CARD_WIDTH - PADDING * 2;

/**
 * Largeur moyenne d'un glyphe rapportée à la taille de police, pour une sans-serif. Volontairement
 * majorée (une valeur mesurée tourne autour de 0,5) : mieux vaut tronquer un caractère de trop que
 * laisser un libellé sortir du cadre.
 */
const GLYPH_RATIO = 0.58;

export type ShareTheme = 'dark' | 'light';

export interface SharePalette {
  bg: string;
  fg: string;
  muted: string;
  gain: string;
  loss: string;
  rule: string;
  accent: string;
}

/** Palettes reprises des jetons de `src/app.css` : la carte ressemble à l'application. */
export const SHARE_PALETTES: Record<ShareTheme, SharePalette> = {
  // Sombre par défaut : Discord l'est majoritairement, une carte claire y brûle les yeux.
  dark: {
    bg: '#0f1115',
    fg: '#e7e9ee',
    muted: '#9aa3b2',
    gain: '#4ade80',
    loss: '#f87171',
    rule: '#262b36',
    accent: '#5b8def',
  },
  light: {
    bg: '#f6f7f9',
    fg: '#111827',
    muted: '#4b5563',
    gain: '#15803d',
    loss: '#b91c1c',
    rule: '#e5e7eb',
    accent: '#2563eb',
  },
};

export type TextRole = 'title' | 'subtitle' | 'label' | 'value' | 'footer';

export interface LayoutText {
  kind: 'text';
  text: string;
  x: number;
  /** Ligne de base. */
  y: number;
  size: number;
  weight: 'normal' | 'bold';
  align: 'left' | 'right';
  role: TextRole;
  tone: ShareTone;
}

export interface LayoutRule {
  kind: 'rule';
  x: number;
  y: number;
  width: number;
}

export type LayoutItem = LayoutText | LayoutRule;

export interface ShareLayout {
  width: number;
  height: number;
  items: readonly LayoutItem[];
}

/** Largeur estimée d'un texte : sert à tronquer, jamais à positionner finement. */
export function estimateWidth(text: string, size: number): number {
  return text.length * size * GLYPH_RATIO;
}

/** Tronque au budget de largeur, avec une ellipse. Ne coupe jamais au milieu d'un mot vide. */
export function truncateTo(text: string, size: number, maxWidth: number): string {
  if (estimateWidth(text, size) <= maxWidth) return text;
  const budget = Math.max(1, Math.floor(maxWidth / (size * GLYPH_RATIO)) - 1);
  return `${text.slice(0, budget).trimEnd()}…`;
}

const SIZES = { title: 52, subtitle: 28, label: 30, value: 34, footer: 24 } as const;

export function shareCardLayout(card: ShareCard): ShareLayout {
  const items: LayoutItem[] = [];
  const left = PADDING;
  const right = CARD_WIDTH - PADDING;

  items.push({
    kind: 'text',
    text: truncateTo(card.title, SIZES.title, CONTENT),
    x: left,
    y: PADDING + SIZES.title,
    size: SIZES.title,
    weight: 'bold',
    align: 'left',
    role: 'title',
    tone: 'neutral',
  });
  items.push({
    kind: 'text',
    text: truncateTo(card.subtitle, SIZES.subtitle, CONTENT),
    x: left,
    y: PADDING + SIZES.title + 44,
    size: SIZES.subtitle,
    weight: 'normal',
    align: 'left',
    role: 'subtitle',
    tone: 'neutral',
  });

  const footerBaseline = CARD_HEIGHT - PADDING;
  const first = PADDING + SIZES.title + 44 + 66;
  const last = footerBaseline - 60;
  // Les lignes se répartissent dans la hauteur restante : une carte à quatre lignes respire, une
  // carte à sept reste dans le cadre. Le pas est calculé, jamais constant.
  const count = Math.max(card.rows.length, 1);
  const step = count > 1 ? Math.min(64, (last - first) / (count - 1)) : 0;

  card.rows.forEach((row, index) => {
    const y = first + step * index;
    // Le libellé prend au plus la moitié gauche, la valeur au plus la moitié droite : ainsi une
    // valeur longue (« Bitcoin 50 % · Ethereum 30 % · Solana 15 % ») ne passe jamais sous le
    // libellé, ce qu'un partage à deux colonnes libres produit inévitablement.
    items.push({
      kind: 'text',
      text: truncateTo(row.label, SIZES.label, CONTENT * 0.42),
      x: left,
      y,
      size: SIZES.label,
      weight: 'normal',
      align: 'left',
      role: 'label',
      tone: 'neutral',
    });
    items.push({
      kind: 'text',
      text: truncateTo(row.value, SIZES.value, CONTENT * 0.56),
      x: right,
      y,
      size: SIZES.value,
      weight: 'bold',
      align: 'right',
      role: 'value',
      tone: row.tone,
    });
    if (index < card.rows.length - 1) {
      items.push({ kind: 'rule', x: left, y: y + step / 2 - SIZES.value / 2, width: CONTENT });
    }
  });

  items.push({
    kind: 'text',
    text: truncateTo(card.footer, SIZES.footer, CONTENT),
    x: left,
    y: footerBaseline,
    size: SIZES.footer,
    weight: 'normal',
    align: 'left',
    role: 'footer',
    tone: 'neutral',
  });

  return { width: CARD_WIDTH, height: CARD_HEIGHT, items };
}

function colorOf(item: LayoutText, palette: SharePalette): string {
  if (item.role === 'subtitle' || item.role === 'footer' || item.role === 'label') {
    return palette.muted;
  }
  if (item.tone === 'gain') return palette.gain;
  if (item.tone === 'loss') return palette.loss;
  return palette.fg;
}

/**
 * Pile de polices sans aucune dépendance distante : la première présente gagne. Une police
 * téléchargée serait bloquée par la CSP et absente hors ligne.
 */
const FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export function drawShareCard(
  ctx: CanvasRenderingContext2D,
  layout: ShareLayout,
  theme: ShareTheme,
): void {
  const palette = SHARE_PALETTES[theme];
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, layout.width, layout.height);

  // Filet d'accent en haut : signe la carte sans texte supplémentaire.
  ctx.fillStyle = palette.accent;
  ctx.fillRect(0, 0, layout.width, 8);

  for (const item of layout.items) {
    if (item.kind === 'rule') {
      ctx.fillStyle = palette.rule;
      ctx.fillRect(item.x, item.y, item.width, 1);
      continue;
    }
    ctx.fillStyle = colorOf(item, palette);
    ctx.font = `${item.weight === 'bold' ? '700' : '400'} ${item.size}px ${FONT_STACK}`;
    ctx.textAlign = item.align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(item.text, item.x, item.y);
  }
}

export interface RenderedCard {
  /** Pour le partage, le presse-papiers et le téléchargement. */
  blob: Blob | null;
  /**
   * Pour l'aperçu à l'écran, en `data:` et **non** en `blob:`. La CSP du site publié dit
   * `img-src 'self' data:` — un `blob:` y est refusé, et l'image reste vide **sans erreur
   * visible**. Le piège est d'autant plus vicieux que la CSP n'est injectée qu'au build : en
   * développement l'aperçu s'affiche parfaitement. Servir l'aperçu en `data:` évite d'élargir la
   * politique pour un simple rendu local.
   */
  dataUrl: string | null;
}

/**
 * Rend la carte en PNG, sous les deux formes dont l'interface a besoin. Champs à `null` si le
 * canvas est indisponible ou si l'encodage échoue — l'appelant retombe alors sur le résumé texte,
 * qui reste toujours proposé.
 */
export async function renderShareCard(card: ShareCard, theme: ShareTheme): Promise<RenderedCard> {
  if (typeof document === 'undefined') return { blob: null, dataUrl: null };
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: null, dataUrl: null };
  drawShareCard(ctx, shareCardLayout(card), theme);
  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png');
  });
  return { blob, dataUrl };
}
