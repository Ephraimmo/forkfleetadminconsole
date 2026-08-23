CREATE TYPE public.app_role AS ENUM (
  'super_admin','platform_admin','restaurant_owner','restaurant_manager','kitchen_manager',
  'kitchen_staff','cashier','dispatcher','finance_manager','customer_support',
  'marketing_manager','inventory_manager','branch_manager','operations_manager','auditor'
);

CREATE TYPE public.order_status AS ENUM (
  'pending','accepted','preparing','ready','assigned','picked_up','on_the_way','delivered','cancelled','refunded'
);

CREATE TYPE public.restaurant_status AS ENUM ('pending','approved','suspended','rejected');
CREATE TYPE public.driver_status AS ENUM ('offline','online','busy','suspended','pending');
CREATE TYPE public.payment_method AS ENUM ('cash','card','wallet','online');

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  email text NOT NULL,
  full_name text,
  phone text,
  avatar_url text,
  job_title text,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role AND is_active);
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND is_active
      AND role IN ('super_admin','platform_admin','operations_manager')
  );
$$;

CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  module text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  permission_code text NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  UNIQUE (role, permission_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role = ur.role AND rp.is_active
    WHERE ur.user_id = _user_id AND ur.is_active AND rp.permission_code = _code
  );
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _count int;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  SELECT count(*) INTO _count FROM public.user_roles WHERE is_active;
  IF _count = 0 THEN
    INSERT INTO public.user_roles (user_id, role, created_by) VALUES (_uid, 'super_admin', _uid)
    ON CONFLICT DO NOTHING;
    RETURN true;
  END IF;
  RETURN false;
END; $$;

CREATE TABLE public.restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  cuisine text NOT NULL,
  email text,
  phone text,
  address text,
  city text NOT NULL DEFAULT 'Johannesburg',
  country text NOT NULL DEFAULT 'ZA',
  currency text NOT NULL DEFAULT 'ZAR',
  latitude numeric(9,6),
  longitude numeric(9,6),
  status public.restaurant_status NOT NULL DEFAULT 'pending',
  commission_rate numeric(5,2) NOT NULL DEFAULT 15.00,
  delivery_radius_km numeric(5,2) NOT NULL DEFAULT 8,
  rating numeric(3,2) NOT NULL DEFAULT 0,
  rating_count integer NOT NULL DEFAULT 0,
  prep_time_minutes integer NOT NULL DEFAULT 20,
  logo_url text,
  opens_at time NOT NULL DEFAULT '08:00',
  closes_at time NOT NULL DEFAULT '22:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurants TO authenticated;
GRANT ALL ON public.restaurants TO service_role;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_restaurants_updated BEFORE UPDATE ON public.restaurants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL,
  description text,
  price numeric(10,2) NOT NULL,
  discount_price numeric(10,2),
  prep_time_minutes integer NOT NULL DEFAULT 15,
  is_available boolean NOT NULL DEFAULT true,
  is_featured boolean NOT NULL DEFAULT false,
  image_url text,
  allergens text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO authenticated;
GRANT ALL ON public.menu_items TO service_role;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_menu_items_updated BEFORE UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  city text NOT NULL DEFAULT 'Johannesburg',
  loyalty_points integer NOT NULL DEFAULT 0,
  wallet_balance numeric(10,2) NOT NULL DEFAULT 0,
  is_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  vehicle_type text NOT NULL DEFAULT 'motorbike',
  vehicle_plate text,
  license_number text,
  status public.driver_status NOT NULL DEFAULT 'pending',
  is_verified boolean NOT NULL DEFAULT false,
  rating numeric(3,2) NOT NULL DEFAULT 0,
  total_deliveries integer NOT NULL DEFAULT 0,
  wallet_balance numeric(10,2) NOT NULL DEFAULT 0,
  current_latitude numeric(9,6),
  current_longitude numeric(9,6),
  city text NOT NULL DEFAULT 'Johannesburg',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_drivers_updated BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE SEQUENCE public.order_number_seq START 100000;
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE DEFAULT ('ORD-' || nextval('public.order_number_seq')),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  status public.order_status NOT NULL DEFAULT 'pending',
  payment_method public.payment_method NOT NULL DEFAULT 'card',
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  delivery_fee numeric(10,2) NOT NULL DEFAULT 25,
  tax numeric(10,2) NOT NULL DEFAULT 0,
  discount numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  commission numeric(10,2) NOT NULL DEFAULT 0,
  delivery_address text,
  special_instructions text,
  placed_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  eta_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_orders_placed_at ON public.orders (placed_at DESC);
CREATE INDEX idx_orders_status ON public.orders (status);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL,
  line_total numeric(10,2) NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  ip_address text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_audit_created ON public.audit_logs (created_at DESC);

CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid())) WITH CHECK (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

CREATE POLICY "roles readable by staff" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));
CREATE POLICY "permissions readable" ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "role perms readable" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "role perms managed by admin" ON public.role_permissions FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "restaurants readable" ON public.restaurants FOR SELECT TO authenticated USING (true);
CREATE POLICY "restaurants managed" ON public.restaurants FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "menu readable" ON public.menu_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "menu managed" ON public.menu_items FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "customers readable" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers managed" ON public.customers FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "drivers readable" ON public.drivers FOR SELECT TO authenticated USING (true);
CREATE POLICY "drivers managed" ON public.drivers FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "orders readable" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "orders managed" ON public.orders FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "order items readable" ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "order items managed" ON public.order_items FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "audit readable" ON public.audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

INSERT INTO public.permissions (code, module, description) VALUES
('dashboard.view','Dashboard','View the operations dashboard'),
('restaurants.view','Restaurants','View restaurants'),
('restaurants.manage','Restaurants','Create, approve and suspend restaurants'),
('menus.view','Menus','View menus'),
('menus.manage','Menus','Manage menu items and pricing'),
('inventory.view','Inventory','View stock levels'),
('inventory.manage','Inventory','Adjust stock and purchase orders'),
('orders.view','Orders','View orders'),
('orders.manage','Orders','Accept, reject and progress orders'),
('orders.refund','Orders','Issue refunds'),
('customers.view','Customers','View customer profiles'),
('customers.manage','Customers','Edit and block customers'),
('drivers.view','Drivers','View drivers'),
('drivers.manage','Drivers','Verify, suspend and manage drivers'),
('dispatch.view','Dispatch','View dispatch board'),
('dispatch.manage','Dispatch','Assign drivers to orders'),
('payments.view','Payments','View payments and settlements'),
('payments.manage','Payments','Process payouts and settlements'),
('promotions.view','Promotions','View campaigns and coupons'),
('promotions.manage','Promotions','Create and edit campaigns'),
('reports.view','Reports','View reports'),
('reports.export','Reports','Export reports'),
('support.view','Support','View support tickets'),
('support.manage','Support','Respond to and escalate tickets'),
('settings.view','Settings','View platform settings'),
('settings.manage','Settings','Change platform settings'),
('audit.view','Audit','View audit logs'),
('users.view','Users','View staff users'),
('users.manage','Users','Manage staff users and roles');

INSERT INTO public.role_permissions (role, permission_code)
SELECT r.role, p.code FROM (VALUES ('super_admin'::public.app_role),('platform_admin')) AS r(role), public.permissions p;

INSERT INTO public.role_permissions (role, permission_code) VALUES
('operations_manager','dashboard.view'),('operations_manager','orders.view'),('operations_manager','orders.manage'),
('operations_manager','dispatch.view'),('operations_manager','dispatch.manage'),('operations_manager','drivers.view'),
('operations_manager','drivers.manage'),('operations_manager','restaurants.view'),('operations_manager','reports.view'),
('restaurant_owner','dashboard.view'),('restaurant_owner','restaurants.view'),('restaurant_owner','menus.view'),
('restaurant_owner','menus.manage'),('restaurant_owner','orders.view'),('restaurant_owner','reports.view'),
('restaurant_manager','dashboard.view'),('restaurant_manager','menus.view'),('restaurant_manager','menus.manage'),
('restaurant_manager','orders.view'),('restaurant_manager','orders.manage'),('restaurant_manager','inventory.view'),
('branch_manager','dashboard.view'),('branch_manager','orders.view'),('branch_manager','orders.manage'),('branch_manager','inventory.view'),
('kitchen_manager','dashboard.view'),('kitchen_manager','orders.view'),('kitchen_manager','orders.manage'),('kitchen_manager','inventory.view'),
('kitchen_staff','orders.view'),('kitchen_staff','orders.manage'),
('cashier','orders.view'),('cashier','orders.manage'),('cashier','payments.view'),
('dispatcher','dashboard.view'),('dispatcher','dispatch.view'),('dispatcher','dispatch.manage'),('dispatcher','orders.view'),('dispatcher','drivers.view'),
('finance_manager','dashboard.view'),('finance_manager','payments.view'),('finance_manager','payments.manage'),('finance_manager','reports.view'),('finance_manager','reports.export'),
('customer_support','support.view'),('customer_support','support.manage'),('customer_support','customers.view'),('customer_support','orders.view'),('customer_support','orders.refund'),
('marketing_manager','promotions.view'),('marketing_manager','promotions.manage'),('marketing_manager','customers.view'),('marketing_manager','reports.view'),
('inventory_manager','inventory.view'),('inventory_manager','inventory.manage'),('inventory_manager','menus.view'),
('auditor','audit.view'),('auditor','reports.view'),('auditor','orders.view'),('auditor','payments.view');

INSERT INTO public.restaurants (name, slug, cuisine, email, phone, address, city, latitude, longitude, status, commission_rate, rating, rating_count, prep_time_minutes) VALUES
('Nandos Rosebank','nandos-rosebank','Flame Grilled','rosebank@nandos.test','+27 11 880 1000','12 Oxford Rd, Rosebank','Johannesburg',-26.1467,28.0436,'approved',15.00,4.6,1820,18),
('Ocean Basket Sandton','ocean-basket-sandton','Seafood','sandton@oceanbasket.test','+27 11 783 2200','Sandton City, Sandton','Johannesburg',-26.1076,28.0567,'approved',17.50,4.4,1240,25),
('Kota Kings Soweto','kota-kings-soweto','Street Food','hello@kotakings.test','+27 11 982 4411','Vilakazi St, Orlando West','Soweto',-26.2380,27.9070,'approved',12.00,4.8,3410,12),
('Sushi Ren','sushi-ren','Japanese','info@sushiren.test','+27 21 421 7788','Bree St, CBD','Cape Town',-33.9210,18.4180,'approved',18.00,4.7,910,22),
('Mama Africa Grill','mama-africa-grill','African','orders@mamaafrica.test','+27 31 305 6677','Florida Rd, Morningside','Durban',-29.8330,31.0130,'approved',15.00,4.5,760,28),
('Pizza Forno','pizza-forno','Italian','ciao@pizzaforno.test','+27 12 460 1122','Menlyn Maine, Menlyn','Pretoria',-25.7860,28.2760,'approved',16.00,4.3,1530,20),
('Green Bowl Co','green-bowl-co','Healthy','hi@greenbowl.test','+27 21 555 9080','Kloof St, Gardens','Cape Town',-33.9330,18.4090,'approved',14.00,4.2,540,15),
('Burger Boulevard','burger-boulevard','Burgers','eat@burgerblvd.test','+27 11 442 3300','Grayston Dr, Sandown','Johannesburg',-26.1030,28.0640,'approved',16.50,4.1,2210,17),
('Spice Route Curry House','spice-route','Indian','curry@spiceroute.test','+27 31 208 4455','Overport, Berea','Durban',-29.8420,31.0000,'approved',15.50,4.6,1180,26),
('Taco Republica','taco-republica','Mexican','hola@tacorepublica.test','+27 21 300 7712','Long St, CBD','Cape Town',-33.9250,18.4180,'pending',15.00,0,0,19),
('Braai Bros','braai-bros','Barbecue','fire@braaibros.test','+27 12 771 8899','Hatfield, Pretoria','Pretoria',-25.7480,28.2380,'pending',15.00,0,0,30),
('Noodle Lab','noodle-lab','Asian Fusion','slurp@noodlelab.test','+27 11 234 5566','Braamfontein','Johannesburg',-26.1930,28.0300,'suspended',16.00,3.4,320,21);

INSERT INTO public.menu_items (restaurant_id, name, category, description, price, prep_time_minutes, is_featured)
SELECT r.id, m.name, m.category, m.description, m.price, m.prep, m.feat
FROM public.restaurants r
CROSS JOIN LATERAL (VALUES
  ('Signature Platter','Mains','House speciality platter for two', 249.00, 25, true),
  ('Half Grilled Chicken','Mains','Flame grilled with two sides', 129.00, 20, true),
  ('Loaded Fries','Sides','Crispy fries with house sauce', 59.00, 10, false),
  ('Garden Salad','Sides','Fresh seasonal greens', 65.00, 8, false),
  ('Chef Special Wrap','Mains','Wrapped daily favourite', 89.00, 14, true),
  ('Sticky Wings 8pc','Starters','Glazed chicken wings', 95.00, 16, false),
  ('Chocolate Brownie','Desserts','Warm brownie with cream', 55.00, 6, false),
  ('Craft Soda','Drinks','Locally bottled soda', 32.00, 2, false)
) AS m(name, category, description, price, prep, feat);

INSERT INTO public.customers (full_name, email, phone, city, loyalty_points, wallet_balance)
SELECT
  (ARRAY['Thabo','Lerato','Sipho','Naledi','Johan','Aisha','Michael','Zanele','Pieter','Nomsa','Daniel','Fatima','Kagiso','Chloe','Sibusiso','Rachel','Ahmed','Palesa','Ryan','Amahle'])[1 + (i % 20)]
  || ' ' ||
  (ARRAY['Molefe','Nkosi','Dlamini','van Wyk','Mahlangu','Patel','Botha','Khumalo','Naidoo','Mokoena'])[1 + (i % 10)],
  'customer' || i || '@mail.test',
  '+27 8' || (i % 9) || ' ' || (1000000 + i * 37),
  (ARRAY['Johannesburg','Cape Town','Durban','Pretoria','Soweto'])[1 + (i % 5)],
  (i * 37) % 2400,
  round(((i * 53) % 900)::numeric, 2)
FROM generate_series(1, 60) AS i;

INSERT INTO public.drivers (full_name, email, phone, vehicle_type, vehicle_plate, license_number, status, is_verified, rating, total_deliveries, wallet_balance, current_latitude, current_longitude, city)
SELECT
  (ARRAY['Bongani','Elias','Tumelo','Shaun','Karabo','Wandile','Riaan','Lucky','Mpho','Neo','Andile','Given'])[1 + (i % 12)]
  || ' ' || (ARRAY['Zulu','Sithole','Jacobs','Maluleke','Ndlovu','Petersen'])[1 + (i % 6)],
  'driver' || i || '@fleet.test',
  '+27 7' || (i % 9) || ' ' || (2000000 + i * 41),
  (ARRAY['motorbike','motorbike','scooter','car','bicycle'])[1 + (i % 5)],
  'GP ' || (100 + i) || '-' || (ARRAY['ZN','GP','WC','KZN'])[1 + (i % 4)],
  'DL' || (8800000 + i * 13),
  (ARRAY['online','online','busy','offline','pending','suspended'])[1 + (i % 6)]::public.driver_status,
  (i % 6) < 4,
  round((3.6 + ((i * 7) % 14) / 10.0)::numeric, 2),
  120 + (i * 29) % 900,
  round(((i * 61) % 4200)::numeric, 2),
  round((-26.2041 + ((i % 20) - 10) * 0.012)::numeric, 6),
  round((28.0473 + ((i % 17) - 8) * 0.014)::numeric, 6),
  (ARRAY['Johannesburg','Cape Town','Durban','Pretoria'])[1 + (i % 4)]
FROM generate_series(1, 24) AS i;

INSERT INTO public.orders (restaurant_id, customer_id, driver_id, status, payment_method, subtotal, delivery_fee, tax, discount, total, commission, delivery_address, placed_at, delivered_at, cancelled_at, eta_minutes)
SELECT
  rest.id, cust.id,
  CASE WHEN st.status IN ('assigned','picked_up','on_the_way','delivered') THEN drv.id ELSE NULL END,
  st.status,
  (ARRAY['card','card','cash','wallet','online'])[1 + (g % 5)]::public.payment_method,
  sub.subtotal, 25.00,
  round(sub.subtotal * 0.15, 2),
  CASE WHEN g % 11 = 0 THEN 30.00 ELSE 0 END,
  round(sub.subtotal * 1.15 + 25.00 - CASE WHEN g % 11 = 0 THEN 30.00 ELSE 0 END, 2),
  round(sub.subtotal * rest.commission_rate / 100, 2),
  (ARRAY['24 Oak Ave, Parktown','8 Marine Dr, Sea Point','101 Ridge Rd, Berea','5 Church St, Hatfield','77 Vilakazi St, Orlando'])[1 + (g % 5)],
  ts.placed_at,
  CASE WHEN st.status = 'delivered' THEN ts.placed_at + ((25 + (g % 30)) || ' minutes')::interval ELSE NULL END,
  CASE WHEN st.status IN ('cancelled','refunded') THEN ts.placed_at + '10 minutes'::interval ELSE NULL END,
  20 + (g % 35)
FROM generate_series(1, 1400) AS g
CROSS JOIN LATERAL (SELECT (now() - (((g * 977) % 5184000) || ' seconds')::interval) AS placed_at) ts
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN ts.placed_at < now() - interval '1 day' THEN
      (ARRAY['delivered','delivered','delivered','delivered','delivered','delivered','delivered','cancelled','refunded'])[1 + (g % 9)]
    ELSE
      (ARRAY['pending','accepted','preparing','ready','assigned','picked_up','on_the_way','delivered','delivered','cancelled'])[1 + (g % 10)]
  END::public.order_status AS status
) st
CROSS JOIN LATERAL (SELECT round((85 + (g * 17) % 640)::numeric, 2) AS subtotal) sub
CROSS JOIN LATERAL (SELECT id, commission_rate FROM public.restaurants WHERE status = 'approved' ORDER BY md5(g::text || slug) LIMIT 1) rest
CROSS JOIN LATERAL (SELECT id FROM public.customers ORDER BY md5(g::text || email) LIMIT 1) cust
CROSS JOIN LATERAL (SELECT id FROM public.drivers WHERE is_verified ORDER BY md5(g::text || email) LIMIT 1) drv;

INSERT INTO public.order_items (order_id, menu_item_id, item_name, quantity, unit_price, line_total)
SELECT o.id, mi.id, mi.name, q.qty, mi.price, round(mi.price * q.qty, 2)
FROM public.orders o
CROSS JOIN LATERAL (SELECT 1 + (abs(hashtext(o.id::text)) % 3) AS n) c
CROSS JOIN LATERAL (
  SELECT id, name, price FROM public.menu_items m
  WHERE m.restaurant_id = o.restaurant_id
  ORDER BY md5(o.id::text || m.name) LIMIT 3
) mi
CROSS JOIN LATERAL (SELECT 1 + (abs(hashtext(o.id::text || mi.name)) % 2) AS qty) q;

INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, ip_address, after_value, created_at)
SELECT
  (ARRAY['ops@platform.test','admin@platform.test','support@platform.test','finance@platform.test'])[1 + (i % 4)],
  (ARRAY['order.status_changed','restaurant.approved','driver.verified','menu.updated','settings.changed','customer.blocked'])[1 + (i % 6)],
  (ARRAY['order','restaurant','driver','menu_item','settings','customer'])[1 + (i % 6)],
  'seed-' || i,
  '196.25.' || (i % 250) || '.' || ((i * 7) % 250),
  jsonb_build_object('note','seeded activity record','index',i),
  now() - ((i * 1900) || ' seconds')::interval
FROM generate_series(1, 80) AS i;