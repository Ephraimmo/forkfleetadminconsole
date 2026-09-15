import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@/lib/use-demo-fn";
import { toast } from "sonner";
import {
  Bike,
  ChefHat,
  CheckCircle2,
  FileText,
  Flame,
  MessageSquare,
  PackageCheck,
  ShoppingBag,
} from "lucide-react";

import { PermissionGate } from "@/components/permission-gate";
import { OrderTypeBadge } from "@/components/order-type-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  advanceOrder,
  getKitchenQueue,
  markCustomerCollected,
  onKitchenChanged,
  type KitchenOrder,
} from "@/lib/kitchen.functions";
import { useFirebaseRestaurants } from "@/hooks/use-firebase-restaurants";
import { useFirebaseOrderSync } from "@/hooks/use-firebase-orders";

export const Route = createFileRoute("/_authenticated/kitchen")({
  head: () => ({
    meta: [
      { title: "Live Kitchen Queue — ForkFleet Console" },
      {
        name: "description",
        content: "Real-time cooking and ready queues with audited order status transitions.",
      },
      { property: "og:title", content: "Live Kitchen Queue — ForkFleet Console" },
      {
        property: "og:description",
        content: "Real-time cooking and ready queues with audited status transitions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KitchenPage,
});

const COLUMNS: {
  key: string;
  label: string;
  next: string | null;
  icon: typeof Flame;
  hint?: string;
}[] = [
  {
    key: "accepted",
    label: "New (Accepted)",
    next: "preparing",
    icon: ChefHat,
    hint: "Tap Start cooking to fire the order",
  },
  { key: "preparing", label: "Cooking", next: "ready", icon: Flame, hint: "On the pass" },
  {
    key: "ready",
    label: "Ready for pickup",
    next: null,
    icon: PackageCheck,
    hint: "Delivery orders wait for a driver; pickup orders wait for the customer",
  },
];

function KitchenPage() {
  const [restaurantId, setRestaurantId] = useState("all");
  const [notesOrder, setNotesOrder] = useState<KitchenOrder | null>(null);
  const queryClient = useQueryClient();
  const fetchQueue = useServerFn(getKitchenQueue);
  const advance = useServerFn(advanceOrder);
  useFirebaseOrderSync();

  const { rows: _fbRestaurants } = useFirebaseRestaurants();
  const restaurantsQuery = { data: _fbRestaurants, isLoading: false };

  const queueQuery = useQuery({
    queryKey: ["kitchen-queue", restaurantId],
    queryFn: () => fetchQueue({ restaurantId }),
    initialData: [],
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  // Live subscription → push incoming rows straight into the query cache.
  useEffect(() => {
    const unsub = onKitchenChanged(() => {
      // Invalidate so the filter (restaurantId) re-applies against fresh cache.
      void queryClient.invalidateQueries({ queryKey: ["kitchen-queue"] });
    });
    return unsub;
  }, [queryClient]);

  const advanceMutation = useMutation({
    mutationFn: (payload: { orderId: string; nextStatus: string }) => advance(payload),
    onSuccess: () => {
      toast.success("Order moved");
      void queryClient.invalidateQueries({ queryKey: ["kitchen-queue"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Handover for customer-pickup orders: ready → "picked_up" (customer collected).
  const collectMutation = useMutation({
    mutationFn: (orderId: string) => markCustomerCollected({ orderId }),
    onSuccess: () => {
      toast.success("Marked as collected by the customer");
      void queryClient.invalidateQueries({ queryKey: ["kitchen-queue"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const orders = queueQuery.data ?? [];

  return (
    <PermissionGate
      required={["orders.view", "orders.manage"]}
      breadcrumb={["Operations", "Kitchen queue"]}
      title="Live kitchen queue"
      description="Accepted, cooking and ready lanes with realtime updates and audit logging."
      actions={
        <Select value={restaurantId} onValueChange={setRestaurantId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="All restaurants" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All restaurants</SelectItem>
            {(restaurantsQuery.data ?? []).map((restaurant) => (
              <SelectItem key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {(staff) => {
        const canManage = staff.hasPermission("orders.manage");
        if (queueQuery.isLoading) return <Skeleton className="h-96 w-full" />;
        return (
          <>
            <div className="grid gap-4 xl:grid-cols-4">
              {COLUMNS.map((column) => {
                const lane = orders.filter((order) => order.status === column.key);
                return (
                  <Card key={column.key} className="flex flex-col">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <column.icon className="size-4" /> {column.label}
                      </CardTitle>
                      <CardDescription>{lane.length} orders</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {lane.map((order) => (
                        <OrderTicket
                          key={order.id}
                          order={order}
                          onViewNotes={() => setNotesOrder(order)}
                          {...(column.next && canManage
                            ? {
                                onAdvance: () =>
                                  advanceMutation.mutate({
                                    orderId: order.id,
                                    nextStatus: column.next as string,
                                  }),
                              }
                            : {})}
                          {...(column.key === "ready" && order.order_type === "pickup" && canManage
                            ? { onCollected: () => collectMutation.mutate(order.id) }
                            : {})}
                        />
                      ))}
                      {lane.length === 0 && (
                        <p className="py-8 text-center text-xs text-muted-foreground">
                          Lane is clear.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Dialog
              open={Boolean(notesOrder)}
              onOpenChange={(open) => !open && setNotesOrder(null)}
            >
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <FileText className="size-4 text-amber-400" />
                    Order notes — {notesOrder?.order_number}
                  </DialogTitle>
                  <DialogDescription>Instructions from the customer.</DialogDescription>
                </DialogHeader>
                {notesOrder && <KitchenNotesBody order={notesOrder} />}
                <DialogFooter>
                  <Button variant="secondary" onClick={() => setNotesOrder(null)}>
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        );
      }}
    </PermissionGate>
  );
}

function kitchenOrderHasNotes(order: KitchenOrder): boolean {
  if ((order.special_instructions ?? "").trim().length > 0) return true;
  if ((order.delivery_notes ?? "").trim().length > 0) return true;
  return order.items.some((it) => (it.notes ?? "").trim().length > 0);
}

function KitchenNotesBody({ order }: { order: KitchenOrder }) {
  const special = (order.special_instructions ?? "").trim();
  const delivery = (order.delivery_notes ?? "").trim();
  const itemNotes = order.items.filter((it) => (it.notes ?? "").trim().length > 0);
  return (
    <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
      <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
        {order.restaurant_name} • {order.customer_name}
      </div>
      {(special.length > 0 || itemNotes.length > 0) && (
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-violet-300">
            <ChefHat className="size-3.5" /> Kitchen instructions
          </h4>
          {special && (
            <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3 text-xs">
              <p className="whitespace-pre-wrap text-foreground/90">{special}</p>
            </div>
          )}
          {itemNotes.map((it) => (
            <div
              key={it.id}
              className="mt-1.5 rounded-md border border-violet-500/20 bg-violet-500/5 p-2 text-xs"
            >
              <p className="font-medium text-foreground">
                {it.quantity}× {it.item_name}
              </p>
              <p className="mt-0.5 text-foreground/80">{it.notes}</p>
            </div>
          ))}
        </section>
      )}
      {delivery && (
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-sky-300">
            <PackageCheck className="size-3.5" /> Handover / delivery notes
          </h4>
          <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-3 text-xs">
            <p className="whitespace-pre-wrap text-foreground/90">{delivery}</p>
          </div>
        </section>
      )}
    </div>
  );
}

function OrderTicket({
  order,
  onAdvance,
  onCollected,
  onViewNotes,
}: {
  order: KitchenOrder;
  onAdvance?: () => void;
  onCollected?: () => void;
  onViewNotes?: () => void;
}) {
  const waited = Math.max(
    0,
    Math.round((Date.now() - new Date(order.placed_at).getTime()) / 60000),
  );
  const hasNotes = kitchenOrderHasNotes(order);
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{order.order_number}</p>
        <Badge variant={waited > 25 ? "destructive" : "secondary"}>{waited}m</Badge>
      </div>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {order.restaurant_name} • {order.customer_name}
        </span>
        <OrderTypeBadge type={order.order_type} />
      </p>
      <ul className="mt-2 space-y-0.5 text-xs">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-2">
            <span>
              {item.quantity}× {item.item_name}
            </span>
          </li>
        ))}
      </ul>
      {hasNotes && onViewNotes && (
        <button
          type="button"
          onClick={onViewNotes}
          className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-left text-[11px] text-amber-200 transition hover:bg-amber-500/15"
        >
          <MessageSquare className="size-3.5 shrink-0" />
          <span className="truncate">View customer notes</span>
        </button>
      )}
      <div className="mt-3 flex gap-2">
        {onAdvance && (
          <Button size="sm" className="flex-1" onClick={onAdvance}>
            <CheckCircle2 className="mr-1 size-3.5" /> Advance
          </Button>
        )}
        {onCollected && (
          <Button size="sm" className="flex-1" onClick={onCollected}>
            <ShoppingBag className="mr-1 size-3.5" /> Customer collected
          </Button>
        )}
        {hasNotes && onViewNotes && (
          <Button size="sm" variant="outline" onClick={onViewNotes} title="View notes">
            <FileText className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
