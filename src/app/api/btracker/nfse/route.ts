import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { sanitizeId } from "@/lib/documentosApiUtils";
import {
  ApiHttpError as HttpError,
  getSessionUserFromRequest,
  hasDocumentosAccess,
} from "@/lib/apiAuth";
import { saveNfseToBtracker, type SaveNfseInput } from "@/lib/btrackerApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const user = await getSessionUserFromRequest(req);
    const email = user.email?.toLowerCase().trim() ?? null;
    const supabaseAdmin = createSupabaseAdminClient();
    const canAccess = await hasDocumentosAccess(user.id, email, supabaseAdmin);
    if (!canAccess) throw new HttpError(403, "Acesso negado.");

    const cookieStore = await cookies();
    const jwt = cookieStore.get("btracker_jwt")?.value;
    if (!jwt) throw new HttpError(401, "Nao autenticado no BTracker.");

    const { input, documentoId } = (await req.json()) as {
      input: SaveNfseInput;
      documentoId?: string;
    };

    // Baixa o PDF do documento para anexar (NF + boleto) e obter hashcodigo
    let nfBytes: ArrayBuffer | undefined;
    let nfName = "nfse.pdf";
    const id = documentoId ? sanitizeId(documentoId) : "";
    if (id) {
      const { data: reg } = await supabaseAdmin
        .from("formularios")
        .select("dados,arquivo_path,arquivo_assinado_path")
        .eq("id", id)
        .maybeSingle();
      const row = reg as {
        dados: Record<string, unknown> | string | null;
        arquivo_path: string | null;
        arquivo_assinado_path: string | null;
      } | null;
      const path = row?.arquivo_assinado_path ?? row?.arquivo_path;
      if (path) {
        const { data: blob } = await supabaseAdmin.storage.from("formularios").download(path);
        if (blob) {
          nfBytes = await blob.arrayBuffer();
          nfName = path.split("/").pop() ?? nfName;
        }
      }
    }

    const result = await saveNfseToBtracker(input, jwt, { nfBytes, nfName });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "Erro ao salvar NFS-e";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
