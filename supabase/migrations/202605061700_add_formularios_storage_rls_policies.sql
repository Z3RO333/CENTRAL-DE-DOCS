-- Storage RLS policies para o bucket "formularios".
-- Sem essas policies, storage.objects (que tem RLS ligado por padrao)
-- bloqueia upload (erro "new row violates row-level security policy")
-- e tambem o createSignedUrl (retorna "Object not found").

DROP POLICY IF EXISTS "formularios_storage_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "formularios_storage_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "formularios_storage_update_own" ON storage.objects;
DROP POLICY IF EXISTS "formularios_storage_delete_own" ON storage.objects;

-- Upload: usuario autenticado so pode subir arquivos na propria pasta
-- (path no formato <user_id>/<tipo>/<arquivo>).
CREATE POLICY "formularios_storage_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'formularios'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leitura: qualquer usuario autenticado pode gerar signed URLs do bucket.
-- O controle de quem visualiza qual documento e feito na tabela
-- public.formularios via documentos_acesso.
CREATE POLICY "formularios_storage_select_authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'formularios');

-- Update: necessario para upsert na propria pasta.
CREATE POLICY "formularios_storage_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'formularios'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'formularios'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete: usuario pode remover arquivos da propria pasta.
CREATE POLICY "formularios_storage_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'formularios'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
