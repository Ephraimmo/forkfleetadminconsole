// A dine-in order's edit history: every change a waiter made to what the
// guests ordered — the line as it was, who changed it, what changed and when.
//
//   Order #FF-123456
//   Original:  Steak + Mushroom Sauce
//   Edited by: John
//   Change:    Mushroom Sauce removed
//   Time:      18:47

import { format, isToday } from "date-fns";
import { History } from "lucide-react";

import type { OrderEditRecord } from "@/lib/dine-in-order-edit";

const time = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, isToday(d) ? "HH:mm" : "d MMM, HH:mm");
};

/** One entry per changed line (and one for the special instructions), oldest first. */
function entries(edit: OrderEditRecord) {
  const rows = edit.lines.map((line) => ({
    key: `${edit.id}:${line.line_id}`,
    original: line.original ?? "— (added by the waiter)",
    change: line.changes.join(", "),
    now: line.kind === "changed" ? line.updated : null,
  }));
  if (edit.special_instructions) {
    rows.push({
      key: `${edit.id}:special`,
      original: `Special instructions: ${edit.special_instructions.from ?? "none"}`,
      change: edit.special_instructions.to
        ? `Changed to "${edit.special_instructions.to}"`
        : "Removed the special instructions",
      now: null,
    });
  }
  return rows;
}

export function OrderEditHistory({
  orderNumber,
  edits,
}: {
  orderNumber: string;
  edits: OrderEditRecord[];
}) {
  if (edits.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
        <History className="size-3.5" /> Edit history
        <span className="font-normal text-muted-foreground">
          — the customer&apos;s order as it was, and every change made to it
        </span>
      </h3>
      <ol className="space-y-2">
        {edits.map((edit) =>
          entries(edit).map((row) => (
            <li key={row.key} className="rounded-md border bg-muted/20 p-2.5 text-xs">
              <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5">
                <dt className="text-muted-foreground">Order</dt>
                <dd className="font-medium">#{orderNumber}</dd>
                <dt className="text-muted-foreground">Original</dt>
                <dd>{row.original}</dd>
                <dt className="text-muted-foreground">Edited by</dt>
                <dd>{edit.by}</dd>
                <dt className="text-muted-foreground">Change</dt>
                <dd className="font-medium text-amber-200">{row.change}</dd>
                {row.now && (
                  <>
                    <dt className="text-muted-foreground">Now</dt>
                    <dd>{row.now}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Time</dt>
                <dd className="tabular-nums" title={new Date(edit.at).toLocaleString()}>
                  {time(edit.at)}
                </dd>
              </dl>
              {edit.confirmation_withdrawn && (
                <p className="mt-1.5 text-[11px] text-sky-300">
                  The order had been confirmed; this change meant confirming it again.
                </p>
              )}
            </li>
          )),
        )}
      </ol>
    </section>
  );
}
