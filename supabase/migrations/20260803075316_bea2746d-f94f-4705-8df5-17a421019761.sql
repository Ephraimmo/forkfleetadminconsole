CREATE POLICY "menu images readable" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'menu-images');
CREATE POLICY "menu images insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'menu-images');
CREATE POLICY "menu images update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'menu-images') WITH CHECK (bucket_id = 'menu-images');
CREATE POLICY "menu images delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'menu-images');