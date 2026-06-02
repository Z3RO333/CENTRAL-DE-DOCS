import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  NFSE_ANALISE_SCHEMA,
  NFSE_SYSTEM_PROMPT,
  aiResultToNfseExtracted,
} from "@/lib/nfseExtractor";
import { extractPdfViaBtracker } from "@/lib/btrackerApi";

function getAzureOpenAiConfig() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT?.trim();
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION?.trim() || "2025-01-01-preview";
  if (!apiKey || !endpoint || !deployment) throw new Error("Azure OpenAI nao configurado.");
  const url = endpoint.includes("/chat/completions")
    ? endpoint
    : `${endpoint.replace(/\/+$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  return { apiKey, deployment, url };
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
  if (!opLoc) throw new Error("Sem operation-location no Document Intelligence.");

  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const poll = await fetch(opLoc, { headers: { "Ocp-Apim-Subscription-Key": key } });
    const result = (await poll.json()) as {
      status?: string;
      analyzeResult?: { content?: string };
    };
    if (result.status === "succeeded") return result.analyzeResult?.content?.trim() ?? "";
    if (result.status === "failed") throw new Error("OCR falhou.");
  }
  throw new Error("OCR timeout.");
}

async function callOpenAi(text: string): Promise<unknown> {
  const { apiKey, deployment, url } = getAzureOpenAiConfig();
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

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const useBtrackerFallback = formData.get("btrackerFallback") === "1";

    if (!file) return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });

    const mimeType = file.type || "application/octet-stream";
    const buf = await file.arrayBuffer();
    const isXml =
      mimeType.includes("xml") || file.name.toLowerCase().endsWith(".xml");

    // ── XML: parse directly, no AI needed ─────────────────────────────────────
    if (isXml) {
      const text = new TextDecoder("utf-8").decode(buf);
      // Dynamic import to avoid loading xmldom in edge runtime
      const { parseNfseXml } = await import("@/lib/nfseExtractor");
      const extracted = parseNfseXml(text);
      return NextResponse.json({ source: "xml", data: extracted });
    }

    // ── PDF / image: Document Intelligence OCR → OpenAI ───────────────────────
    let text: string;
    try {
      text = await extrairTextoOcr(buf, mimeType);
    } catch {
      // If our OCR fails and we have a BTracker token, fall back to BTracker's extractor
      if (useBtrackerFallback) {
        const cookieStore = await cookies();
        const jwt = cookieStore.get("btracker_jwt")?.value;
        if (jwt) {
          const btResult = await extractPdfViaBtracker(buf, file.name, jwt);
          return NextResponse.json({ source: "btracker", data: btResult });
        }
      }
      throw new Error("OCR falhou e nenhum fallback disponivel.");
    }

    if (!text) return NextResponse.json({ error: "Nenhum texto extraido do documento." }, { status: 422 });

    const aiResult = await callOpenAi(text);
    const extracted = aiResultToNfseExtracted(
      aiResult as Parameters<typeof aiResultToNfseExtracted>[0],
      "ocr",
    );

    return NextResponse.json({ source: "ocr+ai", data: extracted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro na extracao";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
