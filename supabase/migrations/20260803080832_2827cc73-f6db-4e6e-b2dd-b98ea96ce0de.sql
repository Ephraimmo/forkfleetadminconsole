-- Dispatch: assign a ready order to a driver
CREATE OR REPLACE FUNCTION public.assign_order_driver(_order_id uuid, _driver_id uuid, _eta_minutes integer DEFAULT NULL)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _row public.orders; _driver public.drivers; _prev order_status;
BEGIN
  SELECT * INTO _row FROM public.orders WHERE id = _order_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.is_platform_admin(auth.uid())
          OR public.has_permission(auth.uid(), 'dispatch.manage')
          OR public.works_at_restaurant(auth.uid(), _row.restaurant_id)) THEN
    RAISE EXCEPTION 'Not allowed to dispatch this order';
  END IF;

  SELECT * INTO _driver FROM public.drivers WHERE id = _driver_id;
  IF _driver.id IS NULL THEN RAISE EXCEPTION 'Driver not found'; END IF;
  IF _driver.status NOT IN ('online','busy') THEN RAISE EXCEPTION 'Driver is not available'; END IF;
  IF _row.status NOT IN ('ready','assigned','preparing','accepted') THEN
    RAISE EXCEPTION 'Order is not dispatchable from status %', _row.status;
  END IF;

  _prev := _row.status;
  UPDATE public.orders
     SET driver_id = _driver_id,
         status = 'assigned',
         eta_minutes = coalesce(_eta_minutes, eta_minutes, 30),
         updated_at = now(),
         updated_by = auth.uid()
   WHERE id = _order_id
  RETURNING * INTO _row;

  UPDATE public.drivers SET status = 'busy', updated_at = now(), updated_by = auth.uid()
   WHERE id = _driver_id AND status = 'online';

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_value, after_value)
  VALUES (auth.uid(), 'order.driver.assigned', 'order', _order_id::text,
          jsonb_build_object('status', _prev, 'driver_id', _prev IS NOT NULL),
          jsonb_build_object('status', 'assigned', 'driver_id', _driver_id, 'eta_minutes', _row.eta_minutes));
  RETURN _row;
END $$;

-- Dispatch: move a delivery forward
CREATE OR REPLACE FUNCTION public.advance_delivery_status(_order_id uuid, _next order_status, _eta_minutes integer DEFAULT NULL)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _row public.orders; _prev order_status;
BEGIN
  SELECT * INTO _row FROM public.orders WHERE id = _order_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT (public.is_platform_admin(auth.uid())
          OR public.has_permission(auth.uid(), 'dispatch.manage')
          OR public.works_at_restaurant(auth.uid(), _row.restaurant_id)) THEN
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
         eta_minutes = coalesce(_eta_minutes, eta_minutes),
         delivered_at = CASE WHEN _next = 'delivered' THEN now() ELSE delivered_at END,
         cancelled_at = CASE WHEN _next = 'cancelled' THEN now() ELSE cancelled_at END,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE id = _order_id
  RETURNING * INTO _row;

  IF _next IN ('delivered','cancelled') AND _row.driver_id IS NOT NULL THEN
    UPDATE public.drivers
       SET total_deliveries = total_deliveries + CASE WHEN _next = 'delivered' THEN 1 ELSE 0 END,
           status = CASE WHEN status = 'busy' THEN 'online'::driver_status ELSE status END,
           updated_at = now(),
           updated_by = auth.uid()
     WHERE id = _row.driver_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_value, after_value)
  VALUES (auth.uid(), 'order.status.' || _next, 'order', _order_id::text,
          jsonb_build_object('status', _prev),
          jsonb_build_object('status', _next, 'driver_id', _row.driver_id, 'eta_minutes', _row.eta_minutes));
  RETURN _row;
END $$;

-- Drivers: change availability
CREATE OR REPLACE FUNCTION public.set_driver_status(_driver_id uuid, _next driver_status)
RETURNS drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _row public.drivers; _prev driver_status;
BEGIN
  IF NOT (public.is_platform_admin(auth.uid())
          OR public.has_permission(auth.uid(), 'drivers.manage')
          OR public.has_permission(auth.uid(), 'dispatch.manage')) THEN
    RAISE EXCEPTION 'Not allowed to manage drivers';
  END IF;
  SELECT * INTO _row FROM public.drivers WHERE id = _driver_id;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Driver not found'; END IF;
  _prev := _row.status;
  UPDATE public.drivers SET status = _next, updated_at = now(), updated_by = auth.uid()
   WHERE id = _driver_id RETURNING * INTO _row;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_value, after_value)
  VALUES (auth.uid(), 'driver.status.' || _next, 'driver', _driver_id::text,
          jsonb_build_object('status', _prev), jsonb_build_object('status', _next));
  RETURN _row;
END $$;

REVOKE ALL ON FUNCTION public.assign_order_driver(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.advance_delivery_status(uuid, order_status, integer) FROM anon;
REVOKE ALL ON FUNCTION public.set_driver_status(uuid, driver_status) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_order_driver(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.advance_delivery_status(uuid, order_status, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_driver_status(uuid, driver_status) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;