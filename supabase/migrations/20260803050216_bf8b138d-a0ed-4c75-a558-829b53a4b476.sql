REVOKE EXECUTE ON FUNCTION public.manages_restaurant(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.works_at_restaurant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manages_restaurant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.works_at_restaurant(uuid, uuid) TO authenticated;