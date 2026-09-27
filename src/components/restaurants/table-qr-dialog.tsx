// View, download, print and regenerate one table's QR code.
//
// The code encodes `<customer app>/dine-in/<token>`, where the token is random
// and meaningless on its own — see issueTableQr() in src/lib/tables.firebase.ts.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  Printer,
  QrCode,
  RefreshCw,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isPermissionDenied } from "@/lib/firestore";
import {
  downloadDataUrl,
  downloadText,
  fileSlug,
  printHtml,
  qrPath,
  qrPngDataUrl,
  qrPrintHtml,
  qrSvg,
} from "@/lib/qr-code";
import {
  DINE_IN_QR_ROUTE,
  issueTableQr,
  saveCustomerAppUrl,
  tableDisplayName,
  tableQrUrl,
  type RestaurantTable,
} from "@/lib/tables.firebase";

const SCAN_HINT = "Scan to see the menu and order";

function qrErrorMessage(e: unknown): string {
  if (isPermissionDenied(e)) {
    return "Permission denied — you may not manage this restaurant's QR codes, or the latest firestore.rules haven't been deployed yet.";
  }
  return e instanceof Error ? e.message : "Could not issue a QR code.";
}

export function TableQrDialog({
  table,
  restaurantName,
  customerAppUrl,
  canManage,
  actor,
  onClose,
}: {
  table: RestaurantTable | null;
  restaurantName: string;
  customerAppUrl: string | null;
  canManage: boolean;
  actor: string | null;
  onClose: () => void;
}) {
  const [issuing, setIssuing] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [copied, setCopied] = useState(false);

  const open = table !== null;
  useEffect(() => {
    if (!open) return;
    setEditingLink(false);
    setCopied(false);
  }, [open]);

  const link =
    table?.qr_token && customerAppUrl ? tableQrUrl(customerAppUrl, table.qr_token) : null;
  const qr = useMemo(() => (link ? qrPath(link) : null), [link]);
  const title = table ? tableDisplayName(table.label) : "";
  const fileBase = `${fileSlug(restaurantName)}-${fileSlug(title)}-qr`;
  const showLinkForm = Boolean(table?.qr_token) && (editingLink || !customerAppUrl);

  async function issue() {
    if (!table) return;
    const replacing = Boolean(table.qr_token);
    setIssuing(true);
    try {
      await issueTableQr({ restaurant_id: table.restaurant_id, table_id: table.id, actor });
      toast.success(
        replacing
          ? `New QR code issued for ${title} — the old code no longer works.`
          : `QR code generated for ${title}.`,
      );
    } catch (e) {
      toast.error(qrErrorMessage(e));
    } finally {
      setIssuing(false);
      setConfirmRegenerate(false);
    }
  }

  async function saveLink() {
    setSavingLink(true);
    try {
      await saveCustomerAppUrl(linkDraft, actor);
      toast.success("QR link saved — it applies to every table.");
      setEditingLink(false);
    } catch (e) {
      toast.error(
        isPermissionDenied(e)
          ? "Only platform administrators can change the QR link."
          : e instanceof Error
            ? e.message
            : "Could not save the QR link.",
      );
    } finally {
      setSavingLink(false);
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  function downloadPng() {
    if (!link) return;
    try {
      downloadDataUrl(`${fileBase}.png`, qrPngDataUrl(link, { title, subtitle: restaurantName }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the image.");
    }
  }

  function downloadSvg() {
    if (!link) return;
    downloadText(`${fileBase}.svg`, qrSvg(link), "image/svg+xml");
  }

  function print() {
    if (!link) return;
    printHtml(qrPrintHtml({ text: link, title, subtitle: restaurantName, hint: SCAN_HINT }));
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && !issuing && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <QrCode className="size-4" /> QR code — {title}
            </DialogTitle>
            <DialogDescription>
              Guests scan this to order at {title}. The code holds only a random token — no
              restaurant or table details — so it can&apos;t be edited to reach another table.
            </DialogDescription>
          </DialogHeader>

          {table && !table.qr_token && (
            <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
              <QrCode className="mx-auto size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">This table has no QR code yet.</p>
              {canManage ? (
                <Button onClick={() => void issue()} disabled={issuing}>
                  {issuing ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <QrCode className="mr-1.5 size-4" />
                  )}
                  Generate QR code
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Ask someone who manages this restaurant to generate one.
                </p>
              )}
            </div>
          )}

          {table && showLinkForm && (
            <div className="space-y-2 rounded-lg border p-3">
              <Label htmlFor="qr-link" className="text-sm font-medium">
                Customer app address
              </Label>
              <p className="text-xs text-muted-foreground">
                QR codes open{" "}
                <span className="font-mono">&lt;address&gt;{DINE_IN_QR_ROUTE}/&lt;code&gt;</span> in
                the customer app. Set it once — it applies to every restaurant&apos;s tables.
              </p>
              <div className="flex gap-2">
                <Input
                  id="qr-link"
                  placeholder="https://order.example.com"
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  className="font-mono text-xs"
                />
                <Button onClick={() => void saveLink()} disabled={savingLink || !linkDraft.trim()}>
                  {savingLink ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                </Button>
              </div>
              {customerAppUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditingLink(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}

          {table && link && qr && !editingLink && (
            <div className="space-y-4">
              {!table.active && (
                <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {title} is inactive — this code won&apos;t take orders until the table is active
                  again.
                </p>
              )}
              <div className="mx-auto w-full max-w-[240px] rounded-lg bg-white p-2">
                <svg
                  viewBox={`0 0 ${qr.dimension} ${qr.dimension}`}
                  shapeRendering="crispEdges"
                  role="img"
                  aria-label={`QR code for ${title}`}
                  className="block h-auto w-full"
                >
                  <rect width={qr.dimension} height={qr.dimension} fill="#fff" />
                  <path d={qr.d} fill="#000" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-base font-semibold">{title}</p>
                <p className="text-xs text-muted-foreground">{restaurantName}</p>
              </div>

              <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={link}>
                  {link}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  onClick={() => void copyLink()}
                  aria-label="Copy link"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" onClick={downloadPng}>
                  <Download className="mr-1.5 size-3.5" /> PNG
                </Button>
                <Button variant="outline" size="sm" onClick={downloadSvg}>
                  <Download className="mr-1.5 size-3.5" /> SVG
                </Button>
                <Button size="sm" onClick={print}>
                  <Printer className="mr-1.5 size-3.5" /> Print
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
                <span>
                  {table.qr_generated_at
                    ? `Generated ${new Date(table.qr_generated_at).toLocaleString()}`
                    : "Generated"}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setLinkDraft(customerAppUrl ?? "");
                      setEditingLink(true);
                    }}
                  >
                    Change link
                  </Button>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => setConfirmRegenerate(true)}
                      disabled={issuing}
                    >
                      <RefreshCw className="mr-1 size-3" /> Regenerate
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmRegenerate}
        onOpenChange={(next) => !issuing && setConfirmRegenerate(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate the QR code for {title}?</AlertDialogTitle>
            <AlertDialogDescription>
              The current code stops working immediately. Any printed copies on the table will need
              to be reprinted and replaced. Use this if a code has been copied or taken away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={issuing}>Keep current code</AlertDialogCancel>
            <AlertDialogAction
              disabled={issuing}
              onClick={(e) => {
                e.preventDefault();
                void issue();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {issuing && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
