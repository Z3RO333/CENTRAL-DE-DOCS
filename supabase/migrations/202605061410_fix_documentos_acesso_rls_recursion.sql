-- Fix infinite recursion in documentos_acesso RLS policy.
-- The original policy did SELECT on documentos_acesso inside USING/WITH CHECK,
-- which re-triggered the same policy and caused HTTP 500 on every authenticated
-- query. Replace with a SECURITY DEFINER function so the lookup bypasses RLS.

CREATE OR REPLACE FUNCTION public.is_documentos_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.documentos_acesso
    WHERE (email = auth.email() OR user_id = auth.uid())
      AND scope = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_documentos_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_documentos_admin()
  TO anon, authenticated, service_role;

DROP POLICY IF EXISTS manage_perms_for_admin ON public.documentos_acesso;

CREATE POLICY manage_perms_for_admin ON public.documentos_acesso
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING (public.is_documentos_admin())
  WITH CHECK (public.is_documentos_admin());
