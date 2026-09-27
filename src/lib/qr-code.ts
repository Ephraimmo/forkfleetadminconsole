// QR code rendering for table codes. qrcode-generator does the encoding; the
// on-screen preview, SVG download, PNG download and print sheet are all drawn
// from the same module matrix here, so every output is the same code.

import qrcode from "qrcode-generator";

/** Quiet zone around the code, in modules (the QR spec asks for 4). */
const QUIET_ZONE = 4;

export interface QrMatrix {
  /** Modules per side (21 for version 1, +4 per version). */
  size: number;
  isDark: (row: number, col: number) => boolean;
}

/**
 * Encode text as a QR matrix. Error correction "Q" (~25% recoverable) keeps a
 * printed table card scannable through the odd smudge or scratch.
 */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcode(0, "Q");
  qr.addData(text, "Byte");
  qr.make();
  return { size: qr.getModuleCount(), isDark: (row, col) => qr.isDark(row, col) };
}

/** SVG path data for the dark modules (one run per row segment) plus the viewBox size. */
export function qrPath(text: string): { dimension: number; d: string } {
  const { size, isDark } = qrMatrix(text);
  let d = "";
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < size && isDark(row, col)) col++;
      const run = col - start;
      d += `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`;
    }
  }
  return { dimension: size + QUIET_ZONE * 2, d };
}

/** A standalone, crisp, scalable SVG of the code (black on white). */
export function qrSvg(text: string): string {
  const { dimension, d } = qrPath(text);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" ` +
    `shape-rendering="crispEdges"><rect width="${dimension}" height="${dimension}" fill="#fff"/>` +
    `<path d="${d}" fill="#000"/></svg>`
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Lower-case, dash-separated file name fragment. */
export function fileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "table"
  );
}

/* ------------------------------------------------ browser-only outputs --- */

/** PNG of the code with the table name (and restaurant) printed underneath. */
export function qrPngDataUrl(
  text: string,
  caption: { title: string; subtitle?: string | null },
): string {
  const { size, isDark } = qrMatrix(text);
  const px = 20;
  const qrPx = (size + QUIET_ZONE * 2) * px;
  const captionPx = Math.round(qrPx * 0.22);

  const canvas = document.createElement("canvas");
  canvas.width = qrPx;
  canvas.height = qrPx + captionPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't render images.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isDark(row, col)) ctx.fillRect((col + QUIET_ZONE) * px, (row + QUIET_ZONE) * px, px, px);
    }
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(captionPx * 0.36)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(
    caption.title,
    qrPx / 2,
    qrPx + captionPx * (caption.subtitle ? 0.3 : 0.4),
    qrPx * 0.9,
  );
  if (caption.subtitle) {
    ctx.fillStyle = "#555555";
    ctx.font = `500 ${Math.round(captionPx * 0.2)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(caption.subtitle, qrPx / 2, qrPx + captionPx * 0.68, qrPx * 0.9);
  }
  return canvas.toDataURL("image/png");
}

export function downloadDataUrl(filename: string, href: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  downloadDataUrl(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One printable table card: restaurant, the code, table name and a scan hint. */
export function qrPrintHtml(input: {
  text: string;
  title: string;
  subtitle?: string | null;
  hint: string;
}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A5 portrait; margin: 12mm; }
  html, body { margin: 0; height: 100%; }
  body { display: flex; align-items: center; justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
  .card { text-align: center; }
  .restaurant { font-size: 14pt; letter-spacing: .08em; text-transform: uppercase; color: #444; margin: 0 0 6mm; }
  .qr svg { width: 90mm; height: 90mm; display: block; margin: 0 auto; }
  .table { font-size: 30pt; font-weight: 800; margin: 6mm 0 2mm; }
  .hint { font-size: 12pt; color: #444; margin: 0; }
</style></head>
<body><div class="card">
  ${input.subtitle ? `<p class="restaurant">${escapeHtml(input.subtitle)}</p>` : ""}
  <div class="qr">${qrSvg(input.text)}</div>
  <p class="table">${escapeHtml(input.title)}</p>
  <p class="hint">${escapeHtml(input.hint)}</p>
</div></body></html>`;
}

/** Print an HTML document through a hidden iframe (no pop-up to block). */
export function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return remove();
    win.addEventListener("afterprint", () => setTimeout(remove, 0));
    win.focus();
    win.print();
    // Fallback for browsers that never fire afterprint.
    setTimeout(remove, 60_000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}
