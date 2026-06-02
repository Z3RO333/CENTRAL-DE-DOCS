import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { sanitizeId, safeParseDados } from "@/lib/documentosApiUtils";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import {
  NFSE_ANALISE_SCHEMA,
  NFSE_SYSTEM_PROMPT,
  aiResultToNfseExtracted,
} from "@/lib/nfseExtractor";
import { extractPdfViaBtracker } from "@/lib/btrackerApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function resolveMimeType(path: string) {
  const p = path.toLowerCase();
  if (p.endsWith(".pdf")) return "application/pdf";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".xml")) return "text/xml";
  return "application/octet-stream";
}

async function extrairTextoOcr(buf: ArrayBuffer, mimeType: string): Promise<string> {
  const endpoint = (
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ||
    process.env.AZURE_OCR_ENDPOINT ||
    ""
  ).replace(/\/+$/, "");
  const key =
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY ||
    process.env.AZURE_OCR_DOCUMENT ||
    "";
  if (!endpoint || !key) throw new Error("Azure Document Intelligence nao configurado.");

  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30`;
  const r = await fetch(analyzeUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType, "Ocp-Apim-Subscription-Key": key },
    body: Buffer.from(buf),
  });
  if (r.status !== 202) throw new Error(`Document Intelligence status ${r.status}`);
  const opLoc = r.headers.get("operation-location");
  if (!opLoc) throw new Error("Sem operation-location.");
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const poll = await fetch(opLoc, { headers: { "Ocp-Apim-Subscription-Key": key } });
    const result = (await poll.json()) as { status?: string; analyzeResult?: { content?: string } };
    if (result.status === "succeeded") return result.analyzeResult?.content?.trim() ?? "";
    if (result.status === "failed") throw new Error("OCR falhou.");
  }
  throw new Error("OCR timeout.");
}

async function callOpenAi(text: string): Promise<unknown> {
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim() ?? "";
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim() ?? "";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim() || "2025-01-01-preview";
  if (!apiKey || !endpoint || !deployment) throw new Error("Azure OpenAI nao configurado.");
  const url = endpoint.includes("/chat/completions")
    ? endpoint
    : `${endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: NFSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Texto do documento:\n\n${text.slice(0, 48000)}\n\nSchema esperado: ${JSON.stringify(NFSE_ANALISE_SCHEMA)}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2000,
      temperature: 0.1,
    }),
  });
  if (!r.ok) {
    const msg = ((await r.json().catch(() => null)) as { error?: { message?: string } } | null)
      ?.error?.message ?? `Azure OpenAI status ${r.status}`;
    throw new Error(msg);
  }
  const raw = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = raw.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenAI nao retornou conteudo.");
  return JSON.parse(content.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim());
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getSessionUserFromRequest(request);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) throw new HttpError(403, "Acesso negado.");

    const { id: rawId } = await context.params;
    const id = sanitizeId(rawId ?? "");
    if (!id) throw new HttpError(400, "ID inválido.");

    const { data: registro, error: regErr } = await supabaseAdmin
      .from("formularios")
      .select("id,tipo,dados,arquivo_path,arquivo_assinado_path")
      .eq("id", id)
      .maybeSingle();
    if (regErr) throw regErr;
    if (!registro) throw new HttpError(404, "Documento não encontrado.");

    const row = registro as {
      id: string;
      tipo: string;
      dados: Record<string, unknown> | string | null;
      arquivo_path: string | null;
      arquivo_assinado_path: string | null;
    };

    const path = row.arquivo_assinado_path ?? row.arquivo_path;
    if (!path) throw new HttpError(400, "Documento sem arquivo.");

    // nome_arquivo fica em dados (campo JSON), com fallback para o path
    const dados = safeParseDados(row.dados);
    const mimeType = resolveMimeType(path);
    const fileName =
      (typeof dados?.nome_arquivo === "string" ? dados.nome_arquivo : null) ??
      path.split("/").pop() ??
      "documento";

    const { data: fileBlob, error: dlErr } = await supabaseAdmin.storage
      .from("formularios")
      .download(path);
    if (dlErr || !fileBlob) throw dlErr ?? new Error("Erro ao baixar arquivo.");

    const buf = await fileBlob.arrayBuffer();

    // ── XML: parse direto ──────────────────────────────────────────────────────
    if (mimeType === "text/xml" || fileName.toLowerCase().endsWith(".xml")) {
      const text = new TextDecoder("utf-8").decode(buf);
      const { parseNfseXml } = await import("@/lib/nfseExtractor");
      const data = parseNfseXml(text);
      return NextResponse.json({ source: "xml", data });
    }

    // ── PDF/imagem: OCR → OpenAI ───────────────────────────────────────────────
    let text: string | null = null;
    try {
      text = await extrairTextoOcr(buf, mimeType);
    } catch {
      // fallback para BTracker se houver token
      const cookieStore = await cookies();
      const jwt = cookieStore.get("btracker_jwt")?.value;
      if (jwt) {
        const btResult = await extractPdfViaBtracker(buf, fileName, jwt);
        return NextResponse.json({ source: "btracker", data: btResult });
      }
      throw new HttpError(422, "Não foi possível extrair texto do documento.");
    }

    if (!text) throw new HttpError(422, "Nenhum texto extraído.");

    const aiResult = await callOpenAi(text);
    const data = aiResultToNfseExtracted(
      aiResult as Parameters<typeof aiResultToNfseExtracted>[0],
      "ocr",
    );

    return NextResponse.json({ source: "ocr+ai", data });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
