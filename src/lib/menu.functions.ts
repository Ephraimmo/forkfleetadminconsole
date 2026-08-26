import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface MenuCategory {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_available: boolean;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  category: string;
  name: string;
  description: string | null;
  price: number;
  discount_price: number | null;
  prep_time_minutes: number;
  is_available: boolean;
  is_featured: boolean;
  image_url: string | null;
  allergens: string[];
}

export interface MenuVariant {
  id: string;
  menu_item_id: string;
  name: string;
  price_delta: number;
  is_default: boolean;
  is_available: boolean;
}

export interface MenuAddon {
  id: string;
  menu_item_id: string;
  name: string;
  price: number;
  max_quantity: number;
  is_available: boolean;
}

export interface MenuPayload {
  categories: MenuCategory[];
  items: MenuItem[];
  variants: MenuVariant[];
  addons: MenuAddon[];
}

export const getMenu = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { restaurantId: string }) => input)
  .handler(async ({ data, context }): Promise<MenuPayload> => {
    const db = context.supabase as never as { from: (t: string) => any };
    const [catRes, itemRes] = await Promise.all([
      db.from("menu_categories").select("*").eq("restaurant_id", data.restaurantId).order("sort_order"),
      db.from("menu_items").select("*").eq("restaurant_id", data.restaurantId).order("name"),
    ]);
    const itemIds = (itemRes.data ?? []).map((i: { id: string }) => i.id);
    let variants: MenuVariant[] = [];
    let addons: MenuAddon[] = [];
    if (itemIds.length > 0) {
      const [varRes, addRes] = await Promise.all([
        db.from("menu_item_variants").select("*").in("menu_item_id", itemIds).order("sort_order"),
        db.from("menu_item_addons").select("*").in("menu_item_id", itemIds).order("name"),
      ]);
      variants = varRes.data ?? [];
      addons = addRes.data ?? [];
    }
    return { categories: catRes.data ?? [], items: itemRes.data ?? [], variants, addons };
  });

export const saveCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id?: string; restaurant_id: string; name: string; description?: string; sort_order?: number; is_available?: boolean }) =>
      input,
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const { id, ...rest } = data;
    const { error } = id
      ? await db.from("menu_categories").update({ ...rest, updated_by: context.userId }).eq("id", id)
      : await db.from("menu_categories").insert({ ...rest, created_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const { error } = await db.from("menu_categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveMenuItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string;
      restaurant_id: string;
      category_id: string | null;
      category: string;
      name: string;
      description?: string;
      price: number;
      discount_price?: number | null;
      prep_time_minutes: number;
      is_available: boolean;
      is_featured: boolean;
      image_url?: string | null;
      allergens?: string[];
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const { id, ...rest } = data;
    const { error } = id
      ? await db.from("menu_items").update({ ...rest, updated_by: context.userId }).eq("id", id)
      : await db.from("menu_items").insert({ ...rest, created_by: context.userId });
    if (error) throw new Error(error.message);
    await db.from("audit_logs").insert({
      actor_id: context.userId,
      action: id ? "menu.item.updated" : "menu.item.created",
      entity_type: "menu_item",
      entity_id: id ?? null,
      after_value: { name: data.name, price: data.price },
    });
    return { ok: true };
  });

export const deleteMenuItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const { error } = await db.from("menu_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleMenuItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; is_available: boolean }) => input)
  .handler(async ({ data, context }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const { error } = await db
      .from("menu_items")
      .update({ is_available: data.is_available, updated_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveVariant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id?: string; menu_item_id: string; name: string; price_delta: number; is_default?: boolean; is_available?: boolean }) =>
      input,
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const { id, ...rest } = data;
    const { error } = id
      ? await db.from("menu_item_variants").update(rest).eq("id", id)
      : await db.from("menu_item_variants").insert(rest);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveAddon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id?: string; menu_item_id: string; name: string; price: number; max_quantity?: number; is_available?: boolean }) => input,
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const { id, ...rest } = data;
    const { error } = id
      ? await db.from("menu_item_addons").update(rest).eq("id", id)
      : await db.from("menu_item_addons").insert(rest);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMenuChild = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; kind: "variant" | "addon" }) => input)
  .handler(async ({ data, context }) => {
    const db = context.supabase as never as { from: (t: string) => any };
    const table = data.kind === "variant" ? "menu_item_variants" : "menu_item_addons";
    const { error } = await db.from(table).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
