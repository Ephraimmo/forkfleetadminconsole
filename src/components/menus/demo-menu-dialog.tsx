import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Sparkles, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildDemoMenu,
  demoMenuFor,
  demoPlanSize,
  loadDemoMenu,
  planDemoMenuLoad,
  planDemoMenuRemoval,
  removeDemoMenu,
} from "@/lib/demo-menus";
import type { MenuPayload } from "@/lib/menus.firebase";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Load (or take back off) the ready-made demo menu for a restaurant. Shows
 * what the demo contains and, against the live menu, what loading it would
 * add or skip. Renders nothing for a restaurant without a demo menu.
 */
export function DemoMenuDialog({
  restaurantId,
  menu,
  open,
  onOpenChange,
  onChanged,
}: {
  restaurantId: string;
  /** The restaurant's current menu. */
  menu: MenuPayload;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const demo = demoMenuFor(restaurantId);
  const built = useMemo(
    () => (demo ? buildDemoMenu(demo, restaurantId) : null),
    [demo, restaurantId],
  );
  const loadPlan = useMemo(() => (built ? planDemoMenuLoad(built, menu) : null), [built, menu]);
  const removalPlan = useMemo(
    () => (built ? planDemoMenuRemoval(built, menu) : null),
    [built, menu],
  );

  const close = (next: boolean) => {
    if (!next) setConfirmRemove(false);
    onOpenChange(next);
  };

  const load = useMutation({
    mutationFn: () => loadDemoMenu(restaurantId),
    onSuccess: (plan) => {
      const added = plan.add.items.length;
      toast.success(
        added > 0
          ? `Demo menu loaded — ${plural(added, "product")} added`
          : "Demo menu is already loaded",
        plan.skipped.length > 0
          ? {
              description: `${plural(plan.skipped.length, "product")} skipped: the menu already has them.`,
            }
          : undefined,
      );
      onChanged?.();
      close(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => removeDemoMenu(restaurantId),
    onSuccess: (plan) => {
      toast.success(`Demo menu removed — ${plural(plan.remove.items.length, "product")} deleted`);
      onChanged?.();
      close(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!demo || !built || !loadPlan || !removalPlan) return null;

  const busy = load.isPending || remove.isPending;
  const total = built.items.length;
  const toAdd = loadPlan.add.items.length;
  const fullyLoaded = demoPlanSize(loadPlan) === 0;
  const demoOnMenu = removalPlan.remove.items.length;
  const perCategory = built.categories.map((c) => ({
    ...c,
    count: built.items.filter((i) => i.category_id === c.id).length,
  }));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Demo menu for {demo.restaurant_name}
          </DialogTitle>
          <DialogDescription>{demo.summary}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {perCategory.map((c) => (
              <Badge key={c.id} variant="secondary" className="gap-1 font-normal">
                {c.name}
                <span className="text-muted-foreground">{c.count}</span>
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {plural(total, "product")} in{" "}
            {plural(built.categories.length, "category", "categories")}, with{" "}
            {plural(built.variants.length, "size")}, {plural(built.addons.length, "add-on")} and{" "}
            {plural(built.modifiers.length, "modifier group")}. Every product has a photo, a
            description, allergens and a price in rand, and can be edited or deleted like any other.
          </p>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            {fullyLoaded ? (
              <p className="flex items-center gap-1.5 font-medium text-emerald-500">
                <CheckCircle2 className="size-3.5" />
                {loadPlan.already_loaded === total
                  ? "The demo menu is already on this menu."
                  : "There's nothing left to add."}
              </p>
            ) : loadPlan.already_loaded > 0 ? (
              <p>
                {loadPlan.already_loaded} of {total} demo products are already on the menu. Loading
                adds the other {plural(toAdd, "product")}.
              </p>
            ) : (
              <p>
                Loading adds {plural(toAdd, "product")} to this menu.
                {menu.items.length > 0
                  ? ` The menu's ${plural(menu.items.length, "product")} stay as they are.`
                  : ""}
              </p>
            )}
            {loadPlan.skipped.length > 0 && (
              <p className="mt-1.5 text-muted-foreground">
                Skipped because the menu already has a product with the same name:{" "}
                {loadPlan.skipped.join(", ")}.
              </p>
            )}
          </div>

          {confirmRemove && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
              <p className="font-medium text-destructive">
                Delete the {plural(demoOnMenu, "demo product")}?
              </p>
              <p className="mt-1 text-muted-foreground">
                This deletes every demo product, category and modifier group, including any changes
                made to them. The restaurant's own products are kept
                {removalPlan.uncategorise.length > 0
                  ? `; ${plural(removalPlan.uncategorise.length, "product")} in a demo category will become uncategorised`
                  : ""}
                .
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {demoOnMenu > 0 ? (
            confirmRemove ? (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => remove.mutate()}
                className="gap-2"
              >
                {remove.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Delete demo products
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="gap-2 text-destructive"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2 className="size-4" />
                Remove demo menu
              </Button>
            )
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => close(false)}>
              {confirmRemove ? "Keep it" : "Cancel"}
            </Button>
            {!confirmRemove && (
              <Button
                disabled={busy || fullyLoaded}
                onClick={() => load.mutate()}
                className="gap-2"
              >
                {load.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {fullyLoaded ? "Loaded" : "Load demo menu"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
