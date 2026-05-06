-- Religa RLS nas tabelas public que tinham policies mas estavam com RLS desligada.
-- Diagnostico: o usuario havia desligado RLS para destravar o app, mas o problema
-- estava no storage. Agora que storage foi corrigido, e seguro religar RLS aqui.
--
-- Server APIs usam supabaseAdmin (service_role) e bypassam RLS,
-- entao a maioria das policies sao para acesso anon/authenticated do browser.

ALTER TABLE public.formularios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos_acesso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lojas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documento_regra_vinculos ENABLE ROW LEVEL SECURITY;

-- documentos_acesso: cada usuario autenticado pode ler os proprios registros.
-- Necessario porque:
--   1) useDocumentsAccess (hook do browser) consulta esta tabela diretamente
--      para descobrir role/modulos do usuario.
--   2) A policy formularios_select_only_approved depende de
--      EXISTS(SELECT FROM documentos_acesso WHERE user_id = auth.uid()).
DROP POLICY IF EXISTS documentos_acesso_select_self ON public.documentos_acesso;
CREATE POLICY documentos_acesso_select_self
  ON public.documentos_acesso FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR email = auth.email()
    OR public.is_documentos_admin()
  );
