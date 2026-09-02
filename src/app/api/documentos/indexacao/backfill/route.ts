import { NextResponse } from "next/server";
import { ApiHttpError as HttpError, getActorFromRequest } from "@/lib/apiAuth";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { baixarEAnalisarArquivo } from "@/lib/documentAnalysisPipeline";
import { indexarConteudoDocumento } from "@/lib/documentoIndexacao";
import { safeParseDados } from "@/lib/documentosApiUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_PADRAO = 25;
const LIMITE_MAX = 100;

type FormularioRow = {
  id: string;
  tipo: string;
  dados: Record<string, unknown> | string | null;
  arquivo_path: string | null;
  arquivo_assinado_path: string | null;
  prestador_id: string | null;
  equipamento_id: string | null;
  created_at: string;
};

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const actor = await getActorFromRequest(request, supabaseAdmin);
    if (!actor.isAdmin) {
      throw new HttpError(403, "Backfill de indexacao e restrito a administradores.");
    }

    const body = (await request.json().catch(() => ({}))) as {
      limite?: number;
      antesDe?: string;
    };

    const limiteBruto = Number(body.limite);
    const limite = Number.isFinite(limiteBruto)
      ? Math.min(Math.max(Math.trunc(limiteBruto), 1), LIMITE_MAX)
      : LIMITE_PADRAO;

    // Teto diario protege o custo de OCR (cobrado por pagina).
    // Padrao de 500 quando a variavel de ambiente esta ausente ou invalida
    // (INDEXACAO_LIMITE_DIARIO vazio resulta em Number("") = 0, que falharia
    // o teste > 0 e desativaria o teto — perigoso). Defina a variavel para
    // aumentar ou reduzir o limite.
    const limiteDiarioEnv = Number(process.env.INDEXACAO_LIMITE_DIARIO ?? "");
    const limiteDiario =
      Number.isFinite(limiteDiarioEnv) && limiteDiarioEnv > 0
        ? limiteDiarioEnv
        : 500;

    const inicioDoDia = new Date();
    inicioDoDia.setUTCHours(0, 0, 0, 0);
    // Conta documentos com indexado_em preenchido hoje como proxy de tentativas
    // bem-sucedidas; tentativas malsucedidas sao acumuladas pelo contador
    // in-loop abaixo para que o teto se aplique mesmo quando tudo falha.
    const { count: contagemDia } = await supabaseAdmin
      .from("documento_conteudo")
      .select("documento_id", { count: "exact", head: true })
      .gte("indexado_em", inicioDoDia.toISOString());
    const contagemHoje = contagemDia ?? 0;
    if (contagemHoje >= limiteDiario) {
      return NextResponse.json({
        processados: 0,
        indexados: 0,
        pulados: 0,
        erros: 0,
        limiteDiarioAtingido: true,
        proximoAntesDe: body.antesDe ?? null,
      });
    }

    // A janela busca mais candidatos que o lote (limite) porque parte deles
    // pode ja estar indexada; isso mantem o lote cheio sem exigir varias
    // idas ao banco so para descartar documentos ja processados.
    let query = supabaseAdmin
      .from("formularios")
      .select(
        "id,tipo,dados,arquivo_path,arquivo_assinado_path,prestador_id,equipamento_id,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limite * 4);

    if (body.antesDe) {
      query = query.lt("created_at", body.antesDe);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const candidatos = (data as FormularioRow[] | null) ?? [];
    if (candidatos.length === 0) {
      return NextResponse.json({
        processados: 0,
        indexados: 0,
        pulados: 0,
        erros: 0,
        concluido: true,
        proximoAntesDe: null,
      });
    }

    const { data: jaIndexados, error: erroIndexados } = await supabaseAdmin
      .from("documento_conteudo")
      .select("documento_id")
      .in(
        "documento_id",
        candidatos.map((row) => row.id),
      )
      .not("indexado_em", "is", null);
    if (erroIndexados) {
      throw erroIndexados;
    }

    const indexadosSet = new Set(
      ((jaIndexados as { documento_id: string }[] | null) ?? []).map(
        (row) => row.documento_id,
      ),
    );

    const pendentesTotais = candidatos.filter((row) => !indexadosSet.has(row.id));
    const pendentes = pendentesTotais.slice(0, limite);
    const truncado = pendentesTotais.length > pendentes.length;

    let indexados = 0;
    let pulados = 0;
    let erros = 0;
    // tentativas conta documentos efetivamente processados nesta requisicao.
    // Somado a contagemHoje, determina quando o teto diario e atingido — mesmo
    // que todas as tentativas falhem e nao gravem indexado_em no banco.
    let tentativas = 0;
    let limiteDiarioAtingido = false;

    // Sequencial de proposito: OCR e lento e cobrado por pagina; paralelizar
    // aqui multiplicaria custo e risco de throttling no Azure.
    for (const row of pendentes) {
      // 3(c): verificar teto a cada iteracao para parar o lote no meio quando necessario.
      if (contagemHoje + tentativas >= limiteDiario) {
        limiteDiarioAtingido = true;
        break;
      }
      tentativas += 1;

      const path = row.arquivo_assinado_path ?? row.arquivo_path;
      const dados = safeParseDados(row.dados);
      const metadados = {
        lojaId: typeof dados?.loja_id === "string" ? dados.loja_id : null,
        tipo: row.tipo,
        competencia:
          typeof dados?.competencia === "string" ? dados.competencia : null,
        equipamentoId: row.equipamento_id,
        prestadorId: row.prestador_id,
        documentoCreatedAt: row.created_at,
      };

      if (!path) {
        const resultado = await indexarConteudoDocumento(supabaseAdmin, {
          documentoId: row.id,
          texto: null,
          origem: "nao_aplicavel",
          paginas: null,
          arquivoHash: null,
          metadados,
        });

        if (resultado.status === "indexado") indexados += 1;
        else if (resultado.status === "pulado") pulados += 1;
        else erros += 1;
        continue;
      }

      // 2(a): imagens e outros formatos nao-PDF nao possuem texto indexavel
      // nesta fase. Registra como nao_aplicavel sem baixar nem analisar o arquivo,
      // evitando chamadas ao modelo de visao (caras e desnecessarias).
      const extensao = path.split(".").pop()?.toLowerCase() ?? "";
      if (extensao !== "pdf") {
        const resultado = await indexarConteudoDocumento(supabaseAdmin, {
          documentoId: row.id,
          texto: null,
          origem: "nao_aplicavel",
          paginas: null,
          arquivoHash: null,
          metadados,
        });
        if (resultado.status === "indexado") indexados += 1;
        else if (resultado.status === "pulado") pulados += 1;
        else erros += 1;
        continue;
      }

      try {
        const analise = await baixarEAnalisarArquivo(supabaseAdmin, {
          path,
          tipoDocumento: row.tipo,
          dadosAtuais: dados,
        });

        const resultado = await indexarConteudoDocumento(supabaseAdmin, {
          documentoId: row.id,
          texto: analise.textoExtraido,
          origem: analise.textoExtraido ? "ocr" : "nao_aplicavel",
          paginas: analise.paginas,
          arquivoHash: analise.arquivoHash,
          metadados,
        });

        if (resultado.status === "indexado") indexados += 1;
        else if (resultado.status === "pulado") pulados += 1;
        else erros += 1;
      } catch (err) {
        console.error("[backfill] Falha ao indexar documento:", row.id, err);
        erros += 1;
      }
    }

    // A janela vem ordenada por created_at desc, entao qualquer pendente nao
    // processado nesta chamada e sempre mais antigo que o ultimo pendente
    // processado. Se o lote foi truncado pelo limite ou interrompido pelo teto
    // diario antes de esgotar os pendentes, retomar do ultimo pendente
    // processado evita pular os que sobraram na janela. So quando a janela
    // inteira coube no lote (sem truncamento nem interrupcao) e que podemos
    // avancar o cursor ate o fim da janela (ultimo candidato), pulando os ja
    // indexados.
    const processadosSlice = pendentes.slice(0, tentativas);
    const truncadoPorLimite = pendentesTotais.length > pendentes.length;
    const truncadoPorCap = limiteDiarioAtingido && tentativas < pendentes.length;
    const truncadoFinal = truncadoPorLimite || truncadoPorCap;

    const ultimoProcessado = processadosSlice[processadosSlice.length - 1];
    const proximoAntesDe = truncadoFinal
      ? (ultimoProcessado?.created_at ?? candidatos[candidatos.length - 1].created_at)
      : candidatos[candidatos.length - 1].created_at;

    return NextResponse.json({
      processados: tentativas,
      indexados,
      pulados,
      erros,
      concluido: false,
      ...(limiteDiarioAtingido && { limiteDiarioAtingido: true }),
      proximoAntesDe,
    });
  } catch (err) {
    console.error("Erro no backfill de indexacao:", err);
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message =
      err instanceof Error ? err.message : "Nao foi possivel executar o backfill.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
