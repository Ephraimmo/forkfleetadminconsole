
CREATE OR REPLACE FUNCTION public.assign_order_driver(_order_id uuid, _driver_id uuid, _eta_minutes integer DEFAULT NULL)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _row public.orders; _prev order_status; _prev_driver uuid;
BEGIN
  SELECT * INTO _row FROM public.orders WHERE id = _order_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.is_platform_admin(auth.uid()) OR public.works_at_restaurant(auth.uid(), _row.restaurant_id)) THEN
    RAISE EXCEPTION 'Not allowed to dispatch this order';
  END IF;
  IF _row.status NOT IN ('ready','assigned','preparing','accepted') THEN
    RAISE EXCEPTION 'Order is not dispatchable in status %', _row.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = _driver_id AND is_active) THEN
    RAISE EXCEPTION 'Driver not found';
  END IF;

  _prev := _row.status;
  _prev_driver := _row.driver_id;

  UPDATE public.orders
     SET driver_id = _driver_id,
         status = 'assigned',
         eta_minutes = COALESCE(_eta_minutes, eta_minutes),
         updated_at = now(),
         updated_by = auth.uid()
   WHERE id = _order_id
  RETURNING * INTO _row;

  UPDATE public.drivers SET status = 'busy', updated_at = now() WHERE id = _driver_id AND status = 'online';
  IF _prev_driver IS NOT NULL AND _prev_driver <> _driver_id THEN
    UPDATE public.drivers SET status = 'online', updated_at = now()
     WHERE id = _prev_driver AND status = 'busy'
       AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.driver_id = _prev_driver AND o.status IN ('assigned','picked_up','on_the_way'));
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_value, after_value)
  VALUES (auth.uid(), 'order.dispatch.assigned', 'order', _order_id::text,
          jsonb_build_object('status', _prev, 'driver_id', _prev_driver),
          jsonb_build_object('status', _row.status, 'driver_id', _driver_id, 'eta_minutes', _row.eta_minutes));

  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.unassign_order_driver(_order_id uuid)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _row public.orders; _prev_driver uuid; _prev order_status;
BEGIN
  SELECT * INTO _row FROM public.orders WHERE id = _order_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.is_platform_admin(auth.uid()) OR public.works_at_restaurant(auth.uid(), _row.restaurant_id)) THEN
    RAISE EXCEPTION 'Not allowed to dispatch this order';
  END IF;
  IF _row.status NOT IN ('assigned') THEN
    RAISE EXCEPTION 'Only assigned orders can be unassigned';
  END IF;

  _prev_driver := _row.driver_id;
  _prev := _row.status;

  UPDATE public.orders SET driver_id = NULL, status = 'ready', updated_at = now(), updated_by = auth.uid()
   WHERE id = _order_id RETURNING * INTO _row;

  IF _prev_driver IS NOT NULL THEN
    UPDATE public.drivers SET status = 'online', updated_at = now()
     WHERE id = _prev_driver AND status = 'busy'
       AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.driver_id = _prev_driver AND o.status IN ('assigned','picked_up','on_the_way'));
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_value, after_value)
  VALUES (auth.uid(), 'order.dispatch.unassigned', 'order', _order_id::text,
          jsonb_build_object('status', _prev, 'driver_id', _prev_driver),
          jsonb_build_object('status', _row.status, 'driver_id', NULL));

  RETURN _row;
END $$;

CREATE OR REPLACE FUNCTION public.advance_delivery_status(_order_id uuid, _next order_status, _eta_minutes integer DEFAULT NULL)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _row public.orders; _prev order_status;
BEGIN
  SELECT * INTO _row FROM public.orders WHERE id = _order_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.is_platform_admin(auth.uid()) OR public.works_at_restaurant(auth.uid(), _row.restaurant_id)) THEN
    RAISE EXCEPTION 'Not allowed to update this delivery';
  END IF;
  IF _next NOT IN ('picked_up','on_the_way','delivered','cancelled') THEN
    RAISE EXCEPTION 'Unsupported delivery transition';
  END IF;
  IF _next <> 'cancelled' AND _row.driver_id IS NULL THEN
    RAISE EXCEPTION 'Assign a driver before moving the delivery forward';
  END IF;

  _prev := _row.status;

  UPDATE public.orders
     SET status = _next,
         eta_minutes = COALESCE(_eta_minutes, eta_minutes),
         delivered_at = CASE WHEN _next = 'delivered' THEN now() ELSE delivered_at END,
         cancelled_at = CASE WHEN _next = 'cancelled' THEN now() ELSE cancelled_at END,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE id = _order_id
  RETURNING * INTO _row;

  IF _next = 'delivered' AND _row.driver_id IS NOT NULL THEN
    UPDATE public.drivers
       SET total_deliveries = total_deliveries + 1,
           wallet_balance = wallet_balance + COALESCE(_row.delivery_fee, 0),
           status = CASE WHEN status = 'busy' THEN 'online'::driver_status ELSE status END,
           updated_at = now()
     WHERE id = _row.driver_id;
  ELSIF _next = 'cancelled' AND _row.driver_id IS NOT NULL THEN
    UPDATE public.drivers SET status = 'online', updated_at = now()
     WHERE id = _row.driver_id AND status = 'busy';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_value, after_value)
  VALUES (auth.uid(), 'order.delivery.' || _next, 'order', _order_id::text,
          jsonb_build_object('status', _prev, 'driver_id', _row.driver_id),
          jsonb_build_object('status', _next, 'driver_id', _row.driver_id, 'eta_minutes', _row.eta_minutes));

  RETURN _row;
END $$;

REVOKE EXECUTE ON FUNCTION public.assign_order_driver(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unassign_order_driver(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.advance_delivery_status(uuid, order_status, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_order_driver(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unassign_order_driver(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_delivery_status(uuid, order_status, integer) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
