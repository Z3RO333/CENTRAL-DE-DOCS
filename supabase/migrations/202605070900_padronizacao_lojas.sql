-- Padronização das lojas/unidades conforme base oficial Bemol (94 unidades).
-- Adiciona coluna categoria, faz UPSERT preservando UUIDs existentes (documentos
-- ainda apontam para esses ids via formularios.dados->loja_id), e marca lojas
-- legadas que não constam da base como REVISAR, corrigindo mojibake conhecido.

alter table public.lojas
  add column if not exists categoria text not null default 'REVISAR';

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'lojas'
      and constraint_name = 'lojas_categoria_check'
  ) then
    alter table public.lojas
      add constraint lojas_categoria_check
      check (categoria in ('LOJA','CD','FARMA','REVISAR'));
  end if;
end $$;

create index if not exists lojas_categoria_idx on public.lojas (categoria);
create index if not exists lojas_codigo_idx on public.lojas (codigo);

-- Função imutável aplicada apenas em registros legados (REVISAR).
-- Cobre os mojibakes observados na base atual; não tenta detectar dinamicamente.
create or replace function public.lojas_fix_mojibake(value text)
returns text
language sql
immutable
as $$
  select
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(coalesce(value, ''), 'CAMAPUÃƒ', 'CAMAPUÃ', 'g'),
                'SAÃšDE', 'SAÚDE', 'g'
              ),
              'TARUMÃ‚', 'TARUMA', 'g'
            ),
            'CAMAPUÃ‚', 'CAMAPUA', 'g'
          ),
          'JI-PARANÃ', 'JI-PARANA', 'g'
        ),
        'JU-PARANÃ', 'JI-PARANA', 'g'
      ),
      'CODAJÃS', 'CODAJAS', 'g'
    );
$$;

-- Pass 1: UPSERT da base oficial.
-- Atualiza nomes/categoria dos centros que já existem; insere os que faltam.
with oficial(codigo, nome, categoria) as (
  values
    ('101','MATRIZ','LOJA'),
    ('103','AVENIDA','LOJA'),
    ('104','CD MANAUS','CD'),
    ('105','EDUCANDOS','LOJA'),
    ('106','AMAZONAS SHOPPING','LOJA'),
    ('109','GRANDE CIRCULAR','LOJA'),
    ('114','PONTA NEGRA','LOJA'),
    ('115','CIDADE NOVA','LOJA'),
    ('116','SHOPPING STUDIO 5','LOJA'),
    ('117','SHOPPING MILLENNIUM','LOJA'),
    ('118','CAMAPUA','LOJA'),
    ('119','SHOPPING MANAUARA','LOJA'),
    ('120','SHOPPING PONTA NEGRA','LOJA'),
    ('121','NOVA CIDADE','LOJA'),
    ('144','CD II','CD'),
    ('148','CD TARUMA','CD'),
    ('149','CD FARMA TARUMA','CD'),
    ('170','CD PORTO','CD'),
    ('201','PORTO VELHO CENTRO','LOJA'),
    ('202','SHOPPING PORTO VELHO','LOJA'),
    ('203','CD PORTO VELHO','CD'),
    ('204','JATUARANA','LOJA'),
    ('205','JI-PARANA','LOJA'),
    ('206','ARIQUEMES','LOJA'),
    ('401','RIO BRANCO','LOJA'),
    ('402','CD RIO BRANCO','CD'),
    ('404','CRUZEIRO DO SUL','LOJA'),
    ('500','TORQUATO','LOJA'),
    ('510','ITACOATIARA','LOJA'),
    ('520','MANACAPURU','LOJA'),
    ('530','PRESIDENTE FIGUEIREDO','LOJA'),
    ('531','AUTAZES','LOJA'),
    ('550','IRANDUBA','LOJA'),
    ('560','RIO PRETO','LOJA'),
    ('561','CODAJAS','LOJA'),
    ('570','MANAQUIRI','LOJA'),
    ('580','CAREIRO','LOJA'),
    ('590','PARINTINS','LOJA'),
    ('591','COARI','LOJA'),
    ('592','MAUES','LOJA'),
    ('601','BEMOL FARMA TORQUATO','FARMA'),
    ('602','FARMA CAMAPUA','FARMA'),
    ('603','BEMOL FARMA AMAZONAS SHOPPING','FARMA'),
    ('604','FARMA GRANDE CIRCULAR','FARMA'),
    ('605','BEMOL FARMA MATRIZ','FARMA'),
    ('606','BEMOL FARMA SHOPPING PONTA NEGRA','FARMA'),
    ('607','BEMOL FARMA NOVA CIDADE','FARMA'),
    ('609','FARMA PORTO VELHO','FARMA'),
    ('610','FARMA BOA VISTA','FARMA'),
    ('611','FARMA ITACOATIARA','FARMA'),
    ('612','FARMA MANAUARA','FARMA'),
    ('613','FARMA ARIQUEMES','FARMA'),
    ('614','BEMOL FARMA PRESIDENTE FIGUEIREDO','FARMA'),
    ('615','FARMA DJALMA','FARMA'),
    ('616','FARMA JI-PARANA','FARMA'),
    ('617','FARMA PONTA NEGRA DB','FARMA'),
    ('618','FARMA STUDIO 5','FARMA'),
    ('619','FARMA JATUARANA','FARMA'),
    ('620','FARMA AVENIDA','FARMA'),
    ('621','FARMA CIDADE NOVA','FARMA'),
    ('622','FARMA AUTAZES','FARMA'),
    ('623','FARMA ATAIDE TEIVE','FARMA'),
    ('624','FARMA MANACAPURU','FARMA'),
    ('625','FARMA RIO BRANCO','FARMA'),
    ('626','FARMA RORAINOPOLIS','FARMA'),
    ('627','FARMA GETULIO VARGAS','FARMA'),
    ('628','FARMA EDUARDO GOMES','FARMA'),
    ('629','FARMA RIO PRETO','FARMA'),
    ('630','FARMA CODAJAS','FARMA'),
    ('631','FARMA PORTO VELHO SHOPPING','FARMA'),
    ('632','FARMA CRUZEIRO DO SUL','FARMA'),
    ('633','FARMA MANAQUIRI','FARMA'),
    ('634','FARMA MAJOR WILLIAMS','FARMA'),
    ('635','FARMA CAREIRO','FARMA'),
    ('636','FARMA DOM PEDRO','FARMA'),
    ('637','FARMA BOULEVARD','FARMA'),
    ('638','BEMOL FARMA IRANDUBA','FARMA'),
    ('639','BEMOL FARMA PARINTINS','FARMA'),
    ('640','BEMOL FARMA COARI','FARMA'),
    ('641','BEMOL FARMA EDUCANDOS','FARMA'),
    ('642','FARMA VIA NORTE','FARMA'),
    ('643','FARMA EFIGENIO SALLES','FARMA'),
    ('644','FARMA FRANCESES','FARMA'),
    ('645','FARMA COROADO','FARMA'),
    ('647','FARMA AV. DAS TORRES','FARMA'),
    ('648','FARMA NOEL NUTELS','FARMA'),
    ('649','FARMA FLORES','FARMA'),
    ('699','FARMA TORRES ONLINE','FARMA'),
    ('701','SHOPPING BOA VISTA','LOJA'),
    ('702','ATAIDE TEIVE','LOJA'),
    ('703','RORAINOPOLIS','LOJA'),
    ('704','CD BOA VISTA','CD'),
    ('705','GETULIO VARGAS','LOJA'),
    ('706','MAJOR WILLIAMS','LOJA')
),
atualizadas as (
  update public.lojas l
  set nome = o.nome,
      categoria = o.categoria
  from oficial o
  where l.codigo = o.codigo
  returning l.codigo as c
)
insert into public.lojas (codigo, nome, categoria)
select o.codigo, o.nome, o.categoria
from oficial o
where o.codigo not in (select c from atualizadas);

-- Pass 2: lojas legadas (não casaram com a base) ainda têm categoria = 'REVISAR'
-- pelo default. Aqui só corrigimos o mojibake conhecido.
update public.lojas
set nome = public.lojas_fix_mojibake(nome)
where categoria = 'REVISAR';
