// One guest's "Request waiter" call, with Accept / Resolve for staff.

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { BellRing, Check, CheckCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useStaffActor } from "@/hooks/use-staff-actor";
import type { StaffActor } from "@/lib/dine-in";
import { tableDisplayName } from "@/lib/tables.firebase";
import {
  acceptWaiterRequest,
  resolveWaiterRequest,
  waiterRequestMessage,
  type WaiterRequest,
} from "@/lib/waiter-requests.firebase";

const ago = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : formatDistanceToNow(d, { addSuffix: true });
};

export function WaiterRequestCard({
  request,
  canManage,
  showRestaurant = false,
  compact = false,
  orderNumber,
  actor: actorOverride,
}: {
  request: WaiterRequest;
  canManage: boolean;
  /** Name the restaurant (when the list spans several). */
  showRestaurant?: boolean;
  /** Smaller, for a table card on the Table overview. */
  compact?: boolean;
  /** The order number of the guest's current order, when known. */
  orderNumber?: string | null | undefined;
  /** Who is answering — defaults to the signed-in console staff member. */
  actor?: StaffActor;
}) {
  const staffActor = useStaffActor();
  const actor = actorOverride ?? staffActor;
  const [busy, setBusy] = useState<"accept" | "resolve" | null>(null);
  const accepted = request.status === "accepted";
  const table = tableDisplayName(request.table_label);

  async function run(kind: "accept" | "resolve") {
    setBusy(kind);
    try {
      if (kind === "accept") {
        await acceptWaiterRequest({ request_id: request.id, actor });
        toast.success(`You've got ${table} — the guest's call is marked as accepted.`);
      } else {
        const resolved = await resolveWaiterRequest({ request_id: request.id, actor });
        toast.success(
          resolved ? `${table}'s request is resolved.` : "That request was already resolved.",
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the waiter request.");
    } finally {
      setBusy(null);
    }
  }

  const who = [
    request.guest_label,
    orderNumber ? `Order ${orderNumber}` : null,
    showRestaurant ? request.restaurant_name : null,
  ].filter(Boolean);

  return (
    <div
      className={`rounded-lg border ${compact ? "p-2" : "p-3"} ${
        accepted ? "border-sky-500/30 bg-sky-500/5" : "border-amber-500/40 bg-amber-500/10"
      }`}
      role="status"
      aria-label={`Waiter request, ${table}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={`flex items-center gap-1.5 font-semibold ${compact ? "text-xs" : "text-sm"} ${
            accepted ? "text-sky-300" : "text-amber-300"
          }`}
        >
          <span aria-hidden>🔔</span> Waiter Request
          {request.request_count > 1 && (
            <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-medium text-amber-200">
              asked {request.request_count}×
            </span>
          )}
        </p>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {ago(request.last_requested_at)}
        </span>
      </div>
      {!compact && <p className="mt-1 text-lg font-semibold leading-tight">{table}</p>}
      <p className={`${compact ? "mt-0.5 text-xs" : "mt-0.5 text-sm"}`}>
        {waiterRequestMessage(request)}
      </p>
      {who.length > 0 && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{who.join(" · ")}</p>
      )}
      {accepted && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-sky-300">
          <BellRing className="size-3" /> Accepted by {request.accepted_by ?? "a waiter"}
          {request.accepted_at ? ` ${ago(request.accepted_at)}` : ""}
        </p>
      )}
      {canManage && (
        <div className={`flex flex-wrap gap-2 ${compact ? "mt-1.5" : "mt-2.5"}`}>
          <Button
            size="sm"
            className={compact ? "h-7 text-xs" : ""}
            onClick={() => void run("accept")}
            disabled={busy !== null || accepted}
          >
            {busy === "accept" ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Check className="mr-1 size-3.5" />
            )}
            {accepted ? "Accepted" : "Accept"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={compact ? "h-7 text-xs" : ""}
            onClick={() => void run("resolve")}
            disabled={busy !== null}
          >
            {busy === "resolve" ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <CheckCheck className="mr-1 size-3.5" />
            )}
            Resolve
          </Button>
        </div>
      )}
    </div>
  );
}
