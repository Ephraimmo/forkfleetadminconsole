// Table management for one restaurant (restaurant profile → Tables tab).
//
// Each table has a number/name, capacity, active flag and order mode, plus
// its own QR code. Tables live at /restaurants/{id}/tables/{tableId} — see
// src/lib/tables.firebase.ts for the data contract.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Armchair, LayoutGrid, Loader2, Pencil, Plus, QrCode, Save, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableQrDialog } from "@/components/restaurants/table-qr-dialog";
import {
  DEFAULT_ORDER_MODE,
  DEFAULT_TABLE_CAPACITY,
  isSessionIdle,
  MAX_TABLE_CAPACITY,
  MAX_TABLE_LABEL_LENGTH,
  ORDER_MODE_OPTIONS,
  orderModeLabel,
  resolveOrderMode,
  saveTable,
  subscribeCustomerAppUrl,
  subscribeTables,
  tableDisplayName,
  validateTableConfig,
  type RestaurantTable,
  type TableOrderMode,
} from "@/lib/tables.firebase";

export function TablesManager({
  restaurantId,
  restaurantName,
  canManage,
  actor,
}: {
  restaurantId: string;
  restaurantName: string;
  canManage: boolean;
  /** Email of the signed-in staff member, recorded as updated_by. */
  actor: string | null;
}) {
  const [tables, setTables] = useState<RestaurantTable[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customerAppUrl, setCustomerAppUrl] = useState<string | null>(null);
  // `null` = closed, "new" = add form, otherwise the id of the table being edited.
  const [formFor, setFormFor] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);

  useEffect(() => {
    setTables(null);
    setLoadError(null);
    return subscribeTables(restaurantId, setTables, setLoadError);
  }, [restaurantId]);
  useEffect(() => subscribeCustomerAppUrl(setCustomerAppUrl), []);

  const list = tables ?? [];
  const editingId = formFor && formFor !== "new" ? formFor : null;
  const editing = editingId ? (list.find((t) => t.id === editingId) ?? null) : null;
  const qrTable = qrFor ? (list.find((t) => t.id === qrFor) ?? null) : null;
  const activeCount = list.filter((t) => t.active).length;
  const seats = list.filter((t) => t.active).reduce((sum, t) => sum + t.capacity, 0);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Armchair className="size-4" /> Tables
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                Dine-in tables at {restaurantName}. Each table has its own capacity, order mode and
                QR code. Guests scan the code to order at that table.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/tables" search={{ restaurant: restaurantId }}>
                  <LayoutGrid className="mr-1.5 size-4" /> Live overview
                </Link>
              </Button>
              {canManage && (
                <Button onClick={() => setFormFor("new")} disabled={tables === null}>
                  <Plus className="mr-1.5 size-4" /> Add table
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {loadError}
            </p>
          )}
          {tables === null && !loadError ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              {list.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {list.length} table{list.length === 1 ? "" : "s"} · {activeCount} active · {seats}{" "}
                  seat{seats === 1 ? "" : "s"} at active tables
                </p>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Table</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead>Order mode</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>QR code</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((table) => (
                      <TableRow key={table.id} className={table.active ? "" : "opacity-60"}>
                        <TableCell className="font-medium">
                          {tableDisplayName(table.label)}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5">
                            <Users className="size-3.5" /> {table.capacity}
                          </span>
                        </TableCell>
                        <TableCell>
                          <OrderModeBadge mode={table.order_mode} />
                        </TableCell>
                        <TableCell>
                          {table.active ? (
                            <Badge className="bg-emerald-600 text-[10px]">Active</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {table.qr_token ? (
                            <span className="inline-flex items-center gap-1.5 text-foreground">
                              <QrCode className="size-3.5" /> Generated
                            </span>
                          ) : (
                            "Not generated"
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" onClick={() => setQrFor(table.id)}>
                              <QrCode className="mr-1 size-3.5" /> QR code
                            </Button>
                            {canManage && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setFormFor(table.id)}
                                aria-label={`Edit ${tableDisplayName(table.label)}`}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {list.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-10 text-center text-sm text-muted-foreground"
                        >
                          No tables yet.
                          {canManage && " Add a table to start taking dine-in orders by QR code."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <TableFormDialog
        open={formFor !== null}
        tableId={editingId}
        table={editing}
        tables={list}
        restaurantId={restaurantId}
        actor={actor}
        onClose={() => setFormFor(null)}
      />
      <TableQrDialog
        table={qrTable}
        restaurantName={restaurantName}
        customerAppUrl={customerAppUrl}
        canManage={canManage}
        actor={actor}
        onClose={() => setQrFor(null)}
      />
    </>
  );
}

export function OrderModeBadge({ mode }: { mode: TableOrderMode }) {
  return mode === "multiple" ? (
    <Badge
      variant="outline"
      className="gap-1 border-sky-500/30 bg-sky-500/10 text-[10px] text-sky-400"
    >
      <Users className="size-2.5" /> {orderModeLabel(mode)}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[10px]">
      {orderModeLabel(mode)}
    </Badge>
  );
}

function TableFormDialog({
  open,
  tableId,
  table,
  tables,
  restaurantId,
  actor,
  onClose,
}: {
  open: boolean;
  /** Id of the table being edited, or null when adding a new one. Kept
   *  separate from `table` so an edit can never turn into a create. */
  tableId: string | null;
  /** The edited table's saved settings (null if it has just been removed). */
  table: RestaurantTable | null;
  tables: RestaurantTable[];
  restaurantId: string;
  actor: string | null;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState(String(DEFAULT_TABLE_CAPACITY));
  const [orderMode, setOrderMode] = useState<TableOrderMode>(DEFAULT_ORDER_MODE);
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Guests seated right now keep their seating's mode until the table is cleared.
  const seating = table?.session && !isSessionIdle(table.session) ? table.session : null;

  // Load the table's saved settings each time the form opens.
  useEffect(() => {
    if (!open) return;
    setLabel(table?.label ?? "");
    setCapacity(String(table?.capacity ?? DEFAULT_TABLE_CAPACITY));
    setOrderMode(table?.order_mode ?? DEFAULT_ORDER_MODE);
    setActive(table?.active ?? true);
    setError(null);
  }, [open, tableId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const config = {
      label: label.trim(),
      capacity: capacity.trim() === "" ? Number.NaN : Number(capacity),
      active,
      order_mode: orderMode,
    };
    const problem = validateTableConfig(
      config,
      tables.filter((t) => t.id !== tableId),
    );
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveTable({ ...config, restaurant_id: restaurantId, id: tableId, actor });
      toast.success(`${tableDisplayName(saved.label)} ${tableId ? "saved" : "added"}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this table.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {tableId ? `Edit ${tableDisplayName(table?.label ?? "table")}` : "Add table"}
          </DialogTitle>
          <DialogDescription>
            Capacity and order mode are separate settings: a table for 4 can share one order or take
            4 separate orders.
          </DialogDescription>
        </DialogHeader>
        <form id="table-form" className="space-y-4" onSubmit={(e) => void submit(e)}>
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div className="space-y-1.5">
              <Label htmlFor="table-label">Table number or name</Label>
              <Input
                id="table-label"
                value={label}
                maxLength={MAX_TABLE_LABEL_LENGTH}
                placeholder="12 or Patio 3"
                autoFocus
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="table-capacity">Capacity (seats)</Label>
              <Input
                id="table-capacity"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_TABLE_CAPACITY}
                step={1}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium">Order mode</legend>
            <RadioGroup
              value={orderMode}
              onValueChange={(value) => setOrderMode(resolveOrderMode(value))}
            >
              {ORDER_MODE_OPTIONS.map((option) => (
                <Label
                  key={option.id}
                  htmlFor={`order-mode-${option.id}`}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal transition-colors ${
                    orderMode === option.id ? "border-primary/40 bg-primary/5" : "border-border"
                  }`}
                >
                  <RadioGroupItem
                    id={`order-mode-${option.id}`}
                    value={option.id}
                    className="mt-0.5"
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            {seating && seating.order_mode !== orderMode && (
              <p className="text-xs text-amber-300">
                {tableDisplayName(table?.label ?? "This table")} has guests right now — they keep
                ordering in {orderModeLabel(seating.order_mode, "long")} mode, and the new mode
                applies once the table is cleared.
              </p>
            )}
          </fieldset>

          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="table-active" className="text-sm font-medium">
                Status: {active ? "Active" : "Inactive"}
              </Label>
              <p className="text-xs text-muted-foreground">
                Inactive tables stay listed, but their QR code won&apos;t take orders.
              </p>
            </div>
            <Switch id="table-active" checked={active} onCheckedChange={setActive} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="table-form" disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
