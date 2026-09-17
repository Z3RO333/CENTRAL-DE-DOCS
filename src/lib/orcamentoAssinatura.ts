import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { createSupabaseAdminClient } from "@/lib/supabaseAdminClient";
import { formatPersonName } from "@/lib/displayName";

const STORAGE_BUCKET = "formularios";

function formatDadosLabel(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Manaus",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `Dados: ${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}:${get("second")} -04'00'`;
}

export async function resolveAssinadoPorNome(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  input: { userId: string; email: string | null },
) {
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(input.userId);
    const metaName =
      (data?.user?.user_metadata?.name as string | undefined) ??
      (data?.user?.user_metadata?.full_name as string | undefined) ??
      null;
    return (
      formatPersonName({ name: metaName, email: input.email }) ||
      input.email ||
      "Gestor aprovador"
    );
  } catch {
    return input.email || "Gestor aprovador";
  }
}

/** Altura ocupada por cada carimbo (logo + 3 linhas), usada para empilhar
 * sem sobrepor quando o PDF já tem um carimbo anterior (ex.: pré-aprovação
 * seguida de aprovação final). */
const STAMP_HEIGHT = 42;

export async function gerarPdfAssinado(input: {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  orcamentoId: string;
  arquivoOriginalPath: string;
  assinadoPorNome: string;
  assinadoPorUserId: string;
  /** Texto acima do nome. Default: "Assinado de forma digital por". */
  rotulo?: string;
  /** Posição do carimbo na pilha (0 = mais embaixo). Use 1+ quando o PDF
   * de origem já contém um carimbo anterior, para não sobrepor. */
  carimboIndex?: number;
}) {
  const {
    supabaseAdmin,
    orcamentoId,
    arquivoOriginalPath,
    assinadoPorNome,
    assinadoPorUserId,
    rotulo = "Assinado de forma digital por",
    carimboIndex = 0,
  } = input;

  const { data: originalBlob, error: downloadError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .download(arquivoOriginalPath);
  if (downloadError || !originalBlob) {
    throw downloadError ?? new Error("Não foi possível baixar o PDF original.");
  }
  const originalBytes = await originalBlob.arrayBuffer();

  const pdfDoc = await PDFDocument.load(originalBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  const page = pages[pages.length - 1];

  const logoBytes = await readFile(path.join(process.cwd(), "public", "bemol-logo.png"));
  const logoImage = await pdfDoc.embedPng(logoBytes);
  const logoHeight = 32;
  const logoWidth = logoImage.width * (logoHeight / logoImage.height);

  const dadosLabel = formatDadosLabel(new Date());

  const stampBaseY = 54 + carimboIndex * STAMP_HEIGHT;
  const logoX = 48;
  page.drawImage(logoImage, {
    x: logoX,
    y: stampBaseY,
    width: logoWidth,
    height: logoHeight,
  });

  const stampX = logoX + logoWidth + 12;
  page.drawText(rotulo, {
    x: stampX,
    y: stampBaseY + 24,
    size: 8,
    font,
    color: rgb(0.4, 0.45, 0.5),
  });
  page.drawText(assinadoPorNome, {
    x: stampX,
    y: stampBaseY + 12,
    size: 12,
    font: fontBold,
    color: rgb(0.1, 0.12, 0.16),
  });
  page.drawText(dadosLabel, {
    x: stampX,
    y: stampBaseY,
    size: 8,
    font,
    color: rgb(0.4, 0.45, 0.5),
  });

  const bytes = await pdfDoc.save();
  const signedPath = `${assinadoPorUserId}/orcamentos_internos/assinados/${orcamentoId}-${Date.now()}.pdf`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(signedPath, Buffer.from(bytes), { contentType: "application/pdf" });
  if (uploadError) {
    throw uploadError;
  }
  return signedPath;
}
