
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.bootstrap_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_metrics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'today_orders', (SELECT count(*) FROM orders WHERE placed_at >= date_trunc('day', now())),
    'today_revenue', (SELECT coalesce(sum(total),0) FROM orders WHERE placed_at >= date_trunc('day', now()) AND status = 'delivered'),
    'week_revenue', (SELECT coalesce(sum(total),0) FROM orders WHERE placed_at >= now() - interval '7 days' AND status = 'delivered'),
    'month_revenue', (SELECT coalesce(sum(total),0) FROM orders WHERE placed_at >= now() - interval '30 days' AND status = 'delivered'),
    'total_revenue', (SELECT coalesce(sum(total),0) FROM orders WHERE status = 'delivered'),
    'commission_earned', (SELECT coalesce(sum(commission),0) FROM orders WHERE status = 'delivered'),
    'avg_order_value', (SELECT coalesce(round(avg(total),2),0) FROM orders WHERE status = 'delivered'),
    'status_counts', (SELECT coalesce(jsonb_object_agg(status, c),'{}'::jsonb) FROM (SELECT status::text AS status, count(*) AS c FROM orders GROUP BY status) s),
    'restaurants_total', (SELECT count(*) FROM restaurants),
    'restaurants_pending', (SELECT count(*) FROM restaurants WHERE status = 'pending'),
    'drivers_total', (SELECT count(*) FROM drivers),
    'drivers_online', (SELECT count(*) FROM drivers WHERE status IN ('online','busy')),
    'customers_total', (SELECT count(*) FROM customers),
    'customers_new_30d', (SELECT count(*) FROM customers WHERE created_at >= now() - interval '30 days')
  );
$$;

CREATE OR REPLACE FUNCTION public.revenue_trend(_days int DEFAULT 14)
RETURNS TABLE (day date, revenue numeric, orders bigint) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT d::date,
    coalesce(sum(o.total) FILTER (WHERE o.status = 'delivered'), 0)::numeric,
    count(o.id)
  FROM generate_series(date_trunc('day', now()) - ((_days - 1) || ' days')::interval, date_trunc('day', now()), '1 day') d
  LEFT JOIN orders o ON o.placed_at >= d AND o.placed_at < d + interval '1 day'
  GROUP BY d ORDER BY d;
$$;

CREATE OR REPLACE FUNCTION public.top_restaurants(_limit int DEFAULT 6)
RETURNS TABLE (id uuid, name text, cuisine text, rating numeric, orders bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT r.id, r.name, r.cuisine, r.rating, count(o.id), coalesce(sum(o.total) FILTER (WHERE o.status='delivered'),0)::numeric
  FROM restaurants r LEFT JOIN orders o ON o.restaurant_id = r.id
  GROUP BY r.id ORDER BY 6 DESC LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.top_menu_items(_limit int DEFAULT 6)
RETURNS TABLE (name text, units bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT oi.item_name, sum(oi.quantity)::bigint, sum(oi.line_total)::numeric
  FROM order_items oi GROUP BY oi.item_name ORDER BY 2 DESC LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.best_customers(_limit int DEFAULT 6)
RETURNS TABLE (id uuid, full_name text, email text, orders bigint, spend numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT c.id, c.full_name, c.email, count(o.id), coalesce(sum(o.total) FILTER (WHERE o.status='delivered'),0)::numeric
  FROM customers c JOIN orders o ON o.customer_id = c.id
  GROUP BY c.id ORDER BY 5 DESC LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.driver_performance(_limit int DEFAULT 6)
RETURNS TABLE (id uuid, full_name text, status public.driver_status, rating numeric, deliveries bigint, earnings numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT d.id, d.full_name, d.status, d.rating,
    count(o.id) FILTER (WHERE o.status='delivered'),
    coalesce(sum(o.delivery_fee) FILTER (WHERE o.status='delivered'),0)::numeric
  FROM drivers d LEFT JOIN orders o ON o.driver_id = d.id
  GROUP BY d.id ORDER BY 5 DESC LIMIT _limit;
$$;

REVOKE EXECUTE ON FUNCTION public.dashboard_metrics(), public.revenue_trend(int), public.top_restaurants(int),
  public.top_menu_items(int), public.best_customers(int), public.driver_performance(int) FROM anon;
