-- ============ helpers ============
CREATE TABLE public.restaurant_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  UNIQUE (restaurant_id, user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_staff TO authenticated;
GRANT ALL ON public.restaurant_staff TO service_role;
ALTER TABLE public.restaurant_staff ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.manages_restaurant(_user_id uuid, _restaurant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin(_user_id) OR EXISTS (
    SELECT 1 FROM public.restaurant_staff rs
    WHERE rs.user_id = _user_id AND rs.restaurant_id = _restaurant_id AND rs.is_active
      AND rs.role IN ('restaurant_owner','restaurant_manager','branch_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.works_at_restaurant(_user_id uuid, _restaurant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin(_user_id) OR EXISTS (
    SELECT 1 FROM public.restaurant_staff rs
    WHERE rs.user_id = _user_id AND rs.restaurant_id = _restaurant_id AND rs.is_active
  );
$$;

CREATE POLICY "staff readable" ON public.restaurant_staff FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff managed" ON public.restaurant_staff FOR ALL TO authenticated
  USING (public.manages_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (public.manages_restaurant(auth.uid(), restaurant_id));

-- ============ invitations ============
CREATE TABLE public.staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role app_role NOT NULL,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  status text NOT NULL DEFAULT 'pending',
  message text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid,
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_invitations TO authenticated;
GRANT ALL ON public.staff_invitations TO service_role;
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invites readable" ON public.staff_invitations FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR (restaurant_id IS NOT NULL AND public.manages_restaurant(auth.uid(), restaurant_id)));
CREATE POLICY "invites managed" ON public.staff_invitations FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR (restaurant_id IS NOT NULL AND public.manages_restaurant(auth.uid(), restaurant_id)))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR (restaurant_id IS NOT NULL AND public.manages_restaurant(auth.uid(), restaurant_id)));

-- ============ business hours ============
CREATE TABLE public.restaurant_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time NOT NULL DEFAULT '08:00',
  closes_at time NOT NULL DEFAULT '22:00',
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  UNIQUE (restaurant_id, day_of_week)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_hours TO authenticated;
GRANT ALL ON public.restaurant_hours TO service_role;
ALTER TABLE public.restaurant_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hours readable" ON public.restaurant_hours FOR SELECT TO authenticated USING (true);
CREATE POLICY "hours managed" ON public.restaurant_hours FOR ALL TO authenticated
  USING (public.manages_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (public.manages_restaurant(auth.uid(), restaurant_id));

-- ============ branches ============
CREATE TABLE public.restaurant_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  address text,
  city text NOT NULL DEFAULT 'Johannesburg',
  phone text,
  latitude numeric,
  longitude numeric,
  delivery_radius_km numeric NOT NULL DEFAULT 8,
  status restaurant_status NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_branches TO authenticated;
GRANT ALL ON public.restaurant_branches TO service_role;
ALTER TABLE public.restaurant_branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "branches readable" ON public.restaurant_branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "branches managed" ON public.restaurant_branches FOR ALL TO authenticated
  USING (public.manages_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (public.manages_restaurant(auth.uid(), restaurant_id));

-- ============ delivery zones ============
CREATE TABLE public.delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.restaurant_branches(id) ON DELETE SET NULL,
  name text NOT NULL,
  radius_km numeric NOT NULL DEFAULT 5,
  base_fee numeric NOT NULL DEFAULT 25,
  min_order numeric NOT NULL DEFAULT 0,
  surcharge numeric NOT NULL DEFAULT 0,
  postal_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_zones TO authenticated;
GRANT ALL ON public.delivery_zones TO service_role;
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zones readable" ON public.delivery_zones FOR SELECT TO authenticated USING (true);
CREATE POLICY "zones managed" ON public.delivery_zones FOR ALL TO authenticated
  USING (public.manages_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (public.manages_restaurant(auth.uid(), restaurant_id));

-- ============ menu categories / variants / addons ============
CREATE TABLE public.menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  UNIQUE (restaurant_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_categories TO authenticated;
GRANT ALL ON public.menu_categories TO service_role;
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "menu categories readable" ON public.menu_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "menu categories managed" ON public.menu_categories FOR ALL TO authenticated
  USING (public.manages_restaurant(auth.uid(), restaurant_id))
  WITH CHECK (public.manages_restaurant(auth.uid(), restaurant_id));

ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.menu_categories(id) ON DELETE SET NULL;

INSERT INTO public.menu_categories (restaurant_id, name)
SELECT DISTINCT restaurant_id, category FROM public.menu_items
ON CONFLICT DO NOTHING;

UPDATE public.menu_items mi SET category_id = mc.id
FROM public.menu_categories mc
WHERE mc.restaurant_id = mi.restaurant_id AND mc.name = mi.category AND mi.category_id IS NULL;

CREATE TABLE public.menu_item_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_delta numeric NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  is_available boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_item_variants TO authenticated;
GRANT ALL ON public.menu_item_variants TO service_role;
ALTER TABLE public.menu_item_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "variants readable" ON public.menu_item_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY "variants managed" ON public.menu_item_variants FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = menu_item_id AND public.manages_restaurant(auth.uid(), mi.restaurant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = menu_item_id AND public.manages_restaurant(auth.uid(), mi.restaurant_id)));

CREATE TABLE public.menu_item_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  max_quantity integer NOT NULL DEFAULT 1,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_item_addons TO authenticated;
GRANT ALL ON public.menu_item_addons TO service_role;
ALTER TABLE public.menu_item_addons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "addons readable" ON public.menu_item_addons FOR SELECT TO authenticated USING (true);
CREATE POLICY "addons managed" ON public.menu_item_addons FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = menu_item_id AND public.manages_restaurant(auth.uid(), mi.restaurant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.menu_items mi WHERE mi.id = menu_item_id AND public.manages_restaurant(auth.uid(), mi.restaurant_id)));

-- ============ updated_at triggers ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['restaurant_staff','staff_invitations','restaurant_hours','restaurant_branches','delivery_zones','menu_categories','menu_item_variants','menu_item_addons']
  LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- ============ kitchen queue action ============
CREATE OR REPLACE FUNCTION public.advance_order_status(_order_id uuid, _next order_status)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.orders; _prev order_status;
BEGIN
  SELECT * INTO _row FROM public.orders WHERE id = _order_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.is_platform_admin(auth.uid()) OR public.works_at_restaurant(auth.uid(), _row.restaurant_id)) THEN
    RAISE EXCEPTION 'Not allowed to update this order';
  END IF;
  IF _next NOT IN ('accepted','preparing','ready','assigned','cancelled') THEN
    RAISE EXCEPTION 'Unsupported kitchen transition';
  END IF;
  _prev := _row.status;
  UPDATE public.orders SET status = _next, updated_at = now(), updated_by = auth.uid(),
    cancelled_at = CASE WHEN _next = 'cancelled' THEN now() ELSE cancelled_at END
  WHERE id = _order_id RETURNING * INTO _row;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_value, after_value)
  VALUES (auth.uid(), 'order.status.' || _next, 'order', _order_id,
          jsonb_build_object('status', _prev), jsonb_build_object('status', _next));
  RETURN _row;
END $$;
REVOKE EXECUTE ON FUNCTION public.advance_order_status(uuid, order_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_order_status(uuid, order_status) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.manages_restaurant(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.works_at_restaurant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manages_restaurant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.works_at_restaurant(uuid, uuid) TO authenticated;