/**
 * Rendu PDF du rapport : jsPDF + jspdf-autotable, importés à la demande (chunk séparé) pour ne
 * pas alourdir le bundle principal. A4 portrait, police standard Helvetica (encodage WinAnsi :
 * tout texte passe par `toPdfText`). Tout se passe dans le navigateur ; `doc.save()` déclenche
 * le téléchargement.
 */
import type { jsPDF } from 'jspdf';
import type { CellDef, UserOptions } from 'jspdf-autotable';
import type { RenderedInsight } from '../format/insights';
import type {
  ReportCell,
  ReportKpi,
  ReportModel,
  ReportTable,
  TableKind,
  Tone,
} from './report-model';

type Rgb = [number, number, number];
type AutoTable = (doc: jsPDF, options: UserOptions) => void;
type TextStyle = 'normal' | 'bold';
type Align = 'left' | 'right' | 'center';

const PAGE = { width: 210, height: 297 } as const;
const MARGIN = { left: 16, right: 16, top: 24, bottom: 20 } as const;
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const RIGHT = PAGE.width - MARGIN.right;
const BOTTOM = PAGE.height - MARGIN.bottom;

const COLOR = {
  ink: [17, 24, 39] as Rgb,
  muted: [75, 85, 99] as Rgb,
  faint: [140, 148, 160] as Rgb,
  line: [209, 213, 219] as Rgb,
  head: [38, 43, 54] as Rgb,
  zebra: [243, 244, 246] as Rgb,
  box: [248, 249, 251] as Rgb,
  accent: [37, 99, 235] as Rgb,
  gain: [21, 128, 61] as Rgb,
  loss: [185, 28, 28] as Rgb,
  /** Ambre foncé du thème clair (`--warn`) : lisible à l'impression, contraste ≥ 4,5:1 sur blanc. */
  warn: [180, 83, 9] as Rgb,
  white: [255, 255, 255] as Rgb,
};

/** Largeurs de colonnes (mm) par tableau ; `auto` = reste de la largeur utile. */
const COLUMN_WIDTHS: Record<TableKind, (number | 'auto')[]> = {
  positions: [22, 20, 19.5, 19.5, 20, 20, 17.5, 19.5, 20],
  stablecoins: [22, 20, 19.5, 19.5, 20, 20, 17.5, 19.5, 20],
  allocation: ['auto', 45, 35],
  closed: ['auto', 26, 26, 26, 22, 30],
};

/** Caractères hors Latin-1 que WinAnsi encode quand même (jsPDF les mappe sur 0x80–0x9F). */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
/** Substituts lisibles pour les caractères absents de WinAnsi. */
const REPLACEMENTS: Record<string, string> = {
  '\u2212': '-', // signe moins typographique
  '\u202f': '\u00a0', // espace fine insécable (séparateur de milliers fr-FR)
  '\u2009': ' ',
  '→': '->',
  '↔': '<->',
  '≈': '~',
  '≤': '<=',
  '≥': '>=',
  Σ: 'somme',
  '⚠': '!',
};

/** Rend une chaîne encodable en WinAnsi (police standard) ; l'inconnu devient « ? ». */
export function toPdfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const mapped = REPLACEMENTS[ch];
    if (mapped !== undefined) out += mapped;
    else if ((ch.codePointAt(0) ?? 0) <= 0xff || WINANSI_EXTRA.has(ch)) out += ch;
    else out += '?';
  }
  return out;
}

export function reportFileName(dateStamp: string): string {
  return `cout-revient-ch-rapport-${dateStamp}.pdf`;
}

const toneColor = (tone: Tone): Rgb =>
  tone === 'gain' ? COLOR.gain : tone === 'loss' ? COLOR.loss : COLOR.ink;

/** Construit le document (sans le télécharger) ; charge jsPDF à la demande. */
export async function buildReportPdf(model: ReportModel): Promise<jsPDF> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.setProperties({
    title: `${model.meta.appName} — ${model.meta.title}`,
    subject: model.cover.subtitle,
    author: model.meta.appName,
    creator: `${model.meta.appName} ${model.meta.version}`,
  });
  render(doc, autoTable, model);
  return doc;
}

/** Génère le PDF et déclenche son téléchargement ; renvoie le nom de fichier. */
export async function downloadReportPdf(model: ReportModel): Promise<string> {
  const doc = await buildReportPdf(model);
  const fileName = reportFileName(model.meta.dateStamp);
  doc.save(fileName);
  return fileName;
}

function render(doc: jsPDF, autoTable: AutoTable, model: ReportModel): void {
  let y: number = MARGIN.top;
  const tableMargin = { ...MARGIN };

  const font = (style: TextStyle, size: number, color: Rgb): void => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  /** Hauteur de ligne en mm pour une taille en points. */
  const lineHeight = (size: number): number => ((size * 25.4) / 72) * 1.35;
  const newPage = (): void => {
    doc.addPage();
    y = MARGIN.top;
  };
  const ensure = (height: number): void => {
    if (y + height > BOTTOM) newPage();
  };
  const write = (text: string, x: number, at: number, align: Align = 'left'): void => {
    doc.text(toPdfText(text), x, at, { align });
  };
  const split = (text: string, width: number): string[] =>
    doc.splitTextToSize(toPdfText(text), width) as string[];
  const paragraph = (
    text: string,
    size: number,
    color: Rgb,
    style: TextStyle = 'normal',
    // Types explicites : `MARGIN` est figé (`as const`), sa valeur littérale ne se réélargit pas.
    x: number = MARGIN.left,
    width: number = CONTENT_WIDTH,
  ): void => {
    font(style, size, color);
    const lh = lineHeight(size);
    for (const line of split(text, width)) {
      ensure(lh);
      doc.text(line, x, y);
      y += lh;
    }
  };
  const rule = (at: number, color: Rgb = COLOR.line, width = 0.25): void => {
    doc.setDrawColor(...color);
    doc.setLineWidth(width);
    doc.line(MARGIN.left, at, RIGHT, at);
  };
  const sectionTitle = (title: string): void => {
    ensure(32);
    font('bold', 15, COLOR.ink);
    write(title, MARGIN.left, y);
    y += 2.5;
    doc.setDrawColor(...COLOR.accent);
    doc.setLineWidth(0.7);
    doc.line(MARGIN.left, y, MARGIN.left + 12, y);
    y += 7;
  };
  const finalY = (): number =>
    (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;
  const box = (x: number, top: number, w: number, h: number): void => {
    doc.setFillColor(...COLOR.box);
    doc.setDrawColor(...COLOR.line);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, top, w, h, 1.5, 1.5, 'FD');
  };

  const cover = (): void => {
    const { meta, cover: c } = model;
    doc.setFillColor(...COLOR.head);
    doc.rect(0, 0, PAGE.width, 6, 'F');
    y = 58;
    font('bold', 9.5, COLOR.muted);
    doc.text(toPdfText(meta.appName.toUpperCase()), MARGIN.left, y, { charSpace: 0.6 });
    y += 13;
    font('bold', 26, COLOR.ink);
    write(c.title, MARGIN.left, y);
    y += 9.5;
    font('normal', 11.5, COLOR.muted);
    write(c.subtitle, MARGIN.left, y);
    y += 13;
    rule(y);
    y += 8;
    for (const fact of c.facts) {
      font('bold', 8.5, COLOR.muted);
      doc.text(toPdfText(fact.label.toUpperCase()), MARGIN.left, y, { charSpace: 0.2 });
      font('normal', 10.5, COLOR.ink);
      write(fact.value, MARGIN.left + 50, y);
      y += 7.5;
    }
    rule(y - 3);
    y += 7;
    for (const note of c.notes) {
      paragraph(`• ${note}`, 9, COLOR.muted);
      y += 1.5;
    }
    // Avertissement dans un encadré, calé en bas de la page de garde.
    font('normal', 8.5, COLOR.muted);
    const lines = split(c.disclaimer, CONTENT_WIDTH - 8);
    const lh = lineHeight(8.5);
    const boxHeight = lines.length * lh + 6;
    const boxTop = PAGE.height - 34 - boxHeight;
    box(MARGIN.left, boxTop, CONTENT_WIDTH, boxHeight);
    font('normal', 8.5, COLOR.muted);
    let ty = boxTop + 4 + lh * 0.75;
    for (const line of lines) {
      doc.text(line, MARGIN.left + 4, ty);
      ty += lh;
    }
    font('normal', 8, COLOR.faint);
    write(model.footer.left, MARGIN.left, PAGE.height - 22);
    write(
      `${model.footer.right} — document produit localement dans votre navigateur, aucune donnée transmise.`,
      MARGIN.left,
      PAGE.height - 17,
    );
  };

  const kpiGrid = (kpis: ReportKpi[]): void => {
    const cols = 3;
    const gap = 4;
    const w = (CONTENT_WIDTH - gap * (cols - 1)) / cols;
    const h = 27;
    const rows = Math.ceil(kpis.length / cols);
    ensure(rows * (h + gap));
    kpis.forEach((kpi, i) => {
      const x = MARGIN.left + (i % cols) * (w + gap);
      const top = y + Math.floor(i / cols) * (h + gap);
      box(x, top, w, h);
      font('bold', 7.5, COLOR.muted);
      doc.text(toPdfText(kpi.label.toUpperCase()), x + 4, top + 6.5, { charSpace: 0.3 });
      font('bold', 14, toneColor(kpi.tone));
      write(kpi.value, x + 4, top + 14.5);
      if (kpi.hint) {
        // Jusqu'à deux lignes : « hors actifs sans cours » ne doit pas disparaître.
        font('normal', 7.5, COLOR.muted);
        split(kpi.hint, w - 8)
          .slice(0, 2)
          .forEach((line, j) => doc.text(line, x + 4, top + 20 + j * 3.4));
      }
    });
    y += rows * (h + gap) + 4;
  };

  const detailsTable = (details: ReportKpi[]): void => {
    autoTable(doc, {
      startY: y,
      margin: tableMargin,
      theme: 'plain',
      tableWidth: CONTENT_WIDTH,
      styles: {
        font: 'helvetica',
        fontSize: 9,
        cellPadding: { top: 2.2, bottom: 2.2, left: 1.5, right: 1.5 },
        textColor: COLOR.ink,
        lineColor: COLOR.line,
        lineWidth: { bottom: 0.2 },
        overflow: 'linebreak',
        valign: 'middle',
      },
      columnStyles: {
        0: { cellWidth: 58, fontStyle: 'bold' },
        1: { cellWidth: 38, halign: 'right' },
        2: { textColor: COLOR.muted, fontSize: 8 },
      },
      body: details.map((d) => [
        toPdfText(d.label),
        { content: toPdfText(d.value), styles: { textColor: toneColor(d.tone) } },
        toPdfText(d.hint ?? ''),
      ]),
    });
    y = finalY() + 10;
  };

  /** Constats : pastille colorée par le ton, intitulé en gras, phrase chiffrée en dessous. */
  const insightBullets = (items: readonly RenderedInsight[]): void => {
    const TONE_COLOR: Record<RenderedInsight['tone'], Rgb> = {
      positive: COLOR.gain,
      negative: COLOR.loss,
      attention: COLOR.warn,
      neutral: COLOR.accent,
    };
    for (const item of items) {
      ensure(16);
      doc.setFillColor(...TONE_COLOR[item.tone]);
      doc.rect(MARGIN.left, y - 2.2, 1.8, 1.8, 'F');
      font('bold', 9.5, COLOR.ink);
      write(item.title, MARGIN.left + 4.5, y);
      y += 4.8;
      paragraph(item.detail, 9, COLOR.muted, 'normal', MARGIN.left + 4.5, CONTENT_WIDTH - 4.5);
      y += 3;
    }
    y += 3;
  };

  const table = (t: ReportTable): void => {
    sectionTitle(t.title);
    if (t.note) {
      paragraph(t.note, 8.5, COLOR.muted);
      y += 2;
    }
    if (t.rows.length === 0) {
      paragraph(t.emptyText, 9.5, COLOR.muted);
      y += 6;
      return;
    }
    const widths = COLUMN_WIDTHS[t.kind];
    const dense = t.columns.length > 6;
    const fontSize = dense ? 7.3 : 8.6;
    const padX = dense ? 1.2 : 1.5;
    const toDef = (c: ReportCell, i: number, bold: boolean): CellDef => ({
      // Un retour à la ligne dans `content` donne deux lignes (un tableau serait joint par « , »).
      content: c.sub ? `${toPdfText(c.text)}\n${toPdfText(c.sub)}` : toPdfText(c.text),
      styles: {
        halign: t.columns[i]?.align ?? 'left',
        textColor: toneColor(c.tone),
        ...(bold ? { fontStyle: 'bold' as const } : {}),
      },
    });
    autoTable(doc, {
      startY: y,
      margin: tableMargin,
      theme: 'plain',
      tableWidth: CONTENT_WIDTH,
      head: [t.columns.map((c) => ({ content: toPdfText(c.label), styles: { halign: c.align } }))],
      body: t.rows.map((row) => row.map((c, i) => toDef(c, i, false))),
      foot: t.total ? [t.total.map((c, i) => toDef(c, i, true))] : [],
      styles: {
        font: 'helvetica',
        fontSize,
        cellPadding: { top: 1.7, bottom: 1.7, left: padX, right: padX },
        textColor: COLOR.ink,
        lineColor: COLOR.line,
        lineWidth: 0,
        overflow: 'linebreak',
        valign: 'middle',
      },
      headStyles: {
        fillColor: COLOR.head,
        textColor: COLOR.white,
        fontStyle: 'bold',
        fontSize: fontSize - 0.4,
      },
      bodyStyles: { lineWidth: { bottom: 0.15 } },
      alternateRowStyles: { fillColor: COLOR.zebra },
      footStyles: {
        fillColor: COLOR.white,
        textColor: COLOR.ink,
        fontStyle: 'bold',
        lineWidth: { top: 0.5, bottom: 0 },
      },
      columnStyles: Object.fromEntries(
        t.columns.map((c, i) => [i, { halign: c.align, cellWidth: widths[i] ?? 'auto' }]),
      ),
      showHead: 'everyPage',
      showFoot: 'lastPage',
      rowPageBreak: 'avoid',
    });
    y = finalY() + 10;
  };

  const methodology = (): void => {
    sectionTitle(model.methodology.title);
    for (const item of model.methodology.items) {
      ensure(18);
      font('bold', 10.5, COLOR.ink);
      write(item.title, MARGIN.left, y);
      y += 5.5;
      paragraph(item.text, 9.2, COLOR.muted);
      y += 4;
    }
  };

  /** En-tête et pied de page sur toutes les pages sauf la page de garde. */
  const chrome = (): void => {
    const pages = doc.getNumberOfPages();
    for (let page = 2; page <= pages; page++) {
      doc.setPage(page);
      font('normal', 8, COLOR.muted);
      write(`${model.meta.appName} — ${model.meta.title}`, MARGIN.left, 13);
      write(model.footer.right, RIGHT, 13, 'right');
      rule(16);
      rule(PAGE.height - 14);
      write(model.footer.left, MARGIN.left, PAGE.height - 9);
      write(`page ${page} / ${pages}`, RIGHT, PAGE.height - 9, 'right');
    }
  };

  cover();
  newPage();
  sectionTitle(model.summary.title);
  kpiGrid(model.summary.kpis);
  detailsTable(model.summary.details);
  if (model.insights) {
    sectionTitle(model.insights.title);
    insightBullets(model.insights.items);
    paragraph(model.insights.note, 8.5, COLOR.muted);
  }
  if (model.subscription) {
    sectionTitle(model.subscription.title);
    detailsTable(model.subscription.details);
    paragraph(model.subscription.note, 8.5, COLOR.muted);
  }
  table(model.allocation);
  newPage();
  table(model.positions);
  table(model.stablecoins);
  if (model.closed.rows.length > 0) newPage();
  table(model.closed);
  newPage();
  methodology();
  chrome();
}
