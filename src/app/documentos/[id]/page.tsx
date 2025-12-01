"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Script from "next/script";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { supabase } from "@/lib/supabaseClient";
import { FileSignature } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";

type FormularioRecord = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string;
  arquivo_assinado_path?: string | null;
  created_at: string;
  assinado_por?: string | null;
};

const tipoLabel: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

const resolveSignedPdfPath = (path?: string | null) => {
  if (!path) {
    return null;
  }
  if (path.endsWith("-view.html")) {
    return path.replace(/-view\.html$/, ".pdf");
  }
  if (path.endsWith(".html")) {
    return path.replace(/\.html$/, ".pdf");
  }
  return path;
};

const SIGNATURE_STORAGE_PREFIX = "digital-signature:";
const STORAGE_BUCKET = "formularios";
const SIGNED_URL_EXPIRES_IN = 60 * 30;

async function getSignedFileUrl(
  path: string,
  expiresIn = SIGNED_URL_EXPIRES_IN,
) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw error ?? new Error("Não foi possível gerar o link do arquivo.");
  }

  return data.signedUrl;
}

export default function AssinaturaDocumentoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const {
    hasAccess: hasDocumentsAccess,
    loading: accessLoading,
  } = useDocumentsAccess();
  const searchParams = useSearchParams();
  const [registro, setRegistro] = useState<FormularioRecord | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [storedSignature, setStoredSignature] = useState<string | null>(null);
  const [activeSignature, setActiveSignature] = useState<string | null>(null);
  const [signatureSource, setSignatureSource] = useState<"profile" | "upload" | null>(null);
  const [uploadedSignatureName, setUploadedSignatureName] = useState<string | null>(null);
  const [signProgress, setSignProgress] = useState(0);
  const signProgressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const getArquivoVisualizacaoPath = useCallback(() => {
    if (!registro) {
      return null;
    }
    const signedPdfPath = resolveSignedPdfPath(registro.arquivo_assinado_path);
    if (signedPdfPath) {
      return signedPdfPath;
    }
    return registro.arquivo_assinado_path ?? registro.arquivo_path ?? null;
  }, [registro]);

  const getArquivoDownloadPath = useCallback(() => {
    if (!registro) {
      return null;
    }
    const signedPdfPath = resolveSignedPdfPath(registro.arquivo_assinado_path);
    if (signedPdfPath) {
      return signedPdfPath;
    }
    return registro.arquivo_assinado_path ?? registro.arquivo_path ?? null;
  }, [registro]);

  const getArquivoOriginalPath = useCallback(
    () => registro?.arquivo_path ?? null,
    [registro],
  );

  const gerarLinkDoArquivoVisualizacao = useCallback(async () => {
    const path = getArquivoVisualizacaoPath();
    if (!path) {
      setError("Arquivo indisponível no momento.");
      return null;
    }
    try {
      const signedUrl = await getSignedFileUrl(path);
      return signedUrl;
    } catch (err) {
      console.error("Erro ao gerar link do arquivo:", err);
      setError("Não foi possível gerar o link do arquivo. Tente novamente.");
      return null;
    }
  }, [getArquivoVisualizacaoPath]);

  const refreshPublicUrl = useCallback(async () => {
    const signedUrl = await gerarLinkDoArquivoVisualizacao();
    if (signedUrl) {
      setPublicUrl(signedUrl);
    }
  }, [gerarLinkDoArquivoVisualizacao]);

  const abrirEmNovaAba = useCallback(async () => {
    const path = getArquivoVisualizacaoPath();
    if (!path) {
      setError("Arquivo indisponível no momento.");
      return;
    }

    const signedUrl = await gerarLinkDoArquivoVisualizacao();
    if (!signedUrl) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = signedUrl;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, [gerarLinkDoArquivoVisualizacao, getArquivoVisualizacaoPath]);

  const baixarArquivoAtual = useCallback(async () => {
    const path = getArquivoDownloadPath();
    if (!path) {
      setError("Arquivo indisponível para download.");
      return;
    }
    const signedUrl = await getSignedFileUrl(path);
    if (!signedUrl) {
      return;
    }
    const link = document.createElement("a");
    link.href = signedUrl;
    link.download = "documento.pdf";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [getArquivoDownloadPath]);

  const loteParam = searchParams.get("lote");
  const loteQueue = useMemo(() => {
    if (!loteParam) {
      return [] as string[];
    }
    const ids = loteParam
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    return ids.filter((id, index) => ids.indexOf(id) === index);
  }, [loteParam]);

  const currentIndexInBatch = loteQueue.findIndex((id) => id === params.id);
  const remainingAfterCurrent =
    currentIndexInBatch >= 0
      ? loteQueue.slice(currentIndexInBatch + 1)
      : loteQueue.filter((id) => id !== params.id);

  const batchActive = loteQueue.length > 0;

  const goToQueue = (queue: string[], targetId?: string) => {
    if (queue.length === 0) {
      router.push("/documentos");
      return;
    }
    const encoded = encodeURIComponent(queue.join(","));
    const nextId = targetId ?? queue[0];
    router.replace(`/documentos/${nextId}?lote=${encoded}`);
  };

  const handleRemoveFromBatch = (id: string) => {
    if (!batchActive) {
      router.push("/documentos");
      return;
    }
    const updatedQueue = loteQueue.filter((item) => item !== id);
    if (updatedQueue.length === 0) {
      router.push("/documentos");
      return;
    }
    if (id === params.id) {
      goToQueue(updatedQueue);
    } else {
      const encoded = encodeURIComponent(updatedQueue.join(","));
      router.replace(`/documentos/${params.id}?lote=${encoded}`);
    }
  };

  const handleChooseFromBatch = (id: string) => {
    if (!batchActive) {
      return;
    }
    const index = loteQueue.findIndex((item) => item === id);
    if (index === -1) {
      return;
    }
    const reordered = loteQueue.slice(index).concat(loteQueue.slice(0, index));
    goToQueue(reordered, id);
  };

  const handleSkipCurrent = () => {
    if (remainingAfterCurrent.length === 0) {
      router.push("/documentos");
      return;
    }
    goToQueue([...remainingAfterCurrent]);
  };

  const startSignProgress = () => {
    if (signProgressTimer.current) {
      clearInterval(signProgressTimer.current);
    }
    setSignProgress(15);
    signProgressTimer.current = setInterval(() => {
      setSignProgress((prev) => (prev < 85 ? prev + 5 : prev));
    }, 400);
  };

  const completeSignProgress = () => {
    if (signProgressTimer.current) {
      clearInterval(signProgressTimer.current);
      signProgressTimer.current = null;
    }
    setSignProgress(100);
    setTimeout(() => {
      setSignProgress(0);
    }, 800);
  };

  const resetSignProgress = () => {
    if (signProgressTimer.current) {
      clearInterval(signProgressTimer.current);
      signProgressTimer.current = null;
    }
    setSignProgress(0);
  };

  useEffect(() => {
    return () => {
      if (signProgressTimer.current) {
        clearInterval(signProgressTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (authLoading || accessLoading) {
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    if (!hasDocumentsAccess) {
      router.replace("/dashboard");
      return;
    }

    let active = true;

    const fetchRegistro = async () => {
      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        const { data, error: fetchError } = await supabase
          .from("formularios")
          .select("*")
          .eq("id", params.id)
          .eq("user_id", user.id)
          .single();

        if (fetchError || !data) {
          throw new Error("Documento n?o encontrado.");
        }

        const record: FormularioRecord = {
          id: data.id as string,
          tipo: data.tipo as string,
          status: data.status as string,
          arquivo_path: data.arquivo_path as string,
          arquivo_assinado_path: data.arquivo_assinado_path as string | null,
          created_at: data.created_at as string,
          assinado_por: data.assinado_por as string | null,
        };

        if (!active) {
          return;
        }

        setRegistro(record);

        const path = record.arquivo_assinado_path ?? record.arquivo_path;
        if (path) {
          try {
            const signedUrl = await getSignedFileUrl(path);
            if (active) {
              setPublicUrl(signedUrl);
            }
          } catch (urlErr) {
            console.error("Erro ao gerar link do arquivo:", urlErr);
            if (active) {
              setPublicUrl(null);
            }
          }
        } else if (active) {
          setPublicUrl(null);
        }
      } catch (err) {
        console.error("Erro ao carregar documento:", err);
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "N?o foi poss?vel carregar o documento.",
          );
          setRegistro(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchRegistro();

    return () => {
      active = false;
    };
  }, [authLoading, accessLoading, user, params.id, router, hasDocumentsAccess]);


  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) {
      setStoredSignature(null);
      setActiveSignature(null);
      setSignatureSource(null);
      return;
    }

    const key = `${SIGNATURE_STORAGE_PREFIX}${user.id}`;

    const loadFromStorage = () => {
      try {
        const saved = window.localStorage.getItem(key);
        setStoredSignature(saved ?? null);
      } catch {
        setStoredSignature(null);
      }
    };

    loadFromStorage();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === key) {
        setStoredSignature(event.newValue ?? null);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [user?.id]);

  useEffect(() => {
    if (storedSignature && signatureSource !== "upload") {
      setActiveSignature(storedSignature);
      setSignatureSource("profile");
    }
    if (!storedSignature && signatureSource === "profile") {
      setActiveSignature(null);
      setSignatureSource(null);
    }
  }, [storedSignature, signatureSource]);

  const handleSignatureUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Envie apenas arquivos de imagem (PNG, JPG ou SVG).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setActiveSignature(reader.result);
        setSignatureSource("upload");
        setUploadedSignatureName(file.name);
        setError(null);
      }
    };
    reader.onerror = () => {
      setError("Não foi possível ler o arquivo selecionado.");
    };
    reader.readAsDataURL(file);
  };

  const usarAssinaturaDoPerfil = () => {
    if (storedSignature) {
      setActiveSignature(storedSignature);
      setSignatureSource("profile");
      setUploadedSignatureName(null);
      setError(null);
    }
  };

  const descartarAssinaturaEnviada = () => {
    if (signatureSource === "upload") {
      if (storedSignature) {
        setActiveSignature(storedSignature);
        setSignatureSource("profile");
      } else {
        setActiveSignature(null);
        setSignatureSource(null);
      }
      setUploadedSignatureName(null);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    if (registro?.status === "assinado") {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (!registro) {
        setError("Documento não encontrado.");
        return;
      }

      const assinaturaAtual = activeSignature ?? storedSignature ?? null;

      if (!assinaturaAtual) {
        setError(
          "Nenhuma assinatura ativa foi encontrada. Carregue um arquivo ou utilize a salva no Perfil antes de continuar.",
        );
        return;
      }

      if (!user) {
        router.replace("/login");
        return;
      }

      const originalPath = getArquivoOriginalPath();
      if (!originalPath) {
        setError("Arquivo original indisponível.");
        return;
      }

      startSignProgress();

      const signedOriginalUrl = await getSignedFileUrl(originalPath);
      const originalResponse = await fetch(signedOriginalUrl);
      if (!originalResponse.ok) {
        resetSignProgress();
        setError("Não foi possível baixar o documento original.");
        return;
      }

      const originalContentType =
        originalResponse.headers.get("content-type") ?? "";
      const originalBuffer = await originalResponse.arrayBuffer();
      const pathLower = originalPath.toLowerCase();
      const contentLower = originalContentType.toLowerCase();
      const documentoEhPdf =
        contentLower.includes("pdf") || pathLower.endsWith(".pdf");
      const documentoEhImagem =
        contentLower.startsWith("image/") ||
        /\.(png|jpe?g|webp|gif)$/i.test(pathLower);

      if (!documentoEhPdf && !documentoEhImagem) {
        resetSignProgress();
        setError(
          "Somente arquivos PDF ou imagens (PNG/JPG) podem receber a assinatura digital no momento.",
        );
        return;
      }

      const assinaturaBytes = await fetch(assinaturaAtual).then((res) =>
        res.arrayBuffer(),
      );

      const pdfDoc = documentoEhPdf
        ? await PDFDocument.load(originalBuffer)
        : await PDFDocument.create();

      if (documentoEhImagem) {
        const imageIsPng =
          contentLower.includes("png") || pathLower.endsWith(".png");
        const embeddedImage = imageIsPng
          ? await pdfDoc.embedPng(originalBuffer)
          : await pdfDoc.embedJpg(originalBuffer);
        const assinaturaPadding = 180;
        const pageWidth = embeddedImage.width;
        const pageHeight = embeddedImage.height + assinaturaPadding;
        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        page.drawImage(embeddedImage, {
          x: 0,
          y: assinaturaPadding,
          width: embeddedImage.width,
          height: embeddedImage.height,
        });
      }
      const assinaturaImagem = assinaturaAtual.includes("image/png")
        ? await pdfDoc.embedPng(assinaturaBytes)
        : await pdfDoc.embedJpg(assinaturaBytes);

      const paginas = pdfDoc.getPages();
      const paginaAlvo = paginas[paginas.length - 1];
      const { width } = paginaAlvo.getSize();
      const margem = 40;
      const larguraMaxima = Math.min(width - margem * 2, 320);
      const escala =
        assinaturaImagem.width > larguraMaxima
          ? larguraMaxima / assinaturaImagem.width
          : 1;
      const larguraAssinatura = assinaturaImagem.width * escala;
      const alturaAssinatura = assinaturaImagem.height * escala;
      const posicaoX = (width - larguraAssinatura) / 2;
      const posicaoY = margem;

      paginaAlvo.drawImage(assinaturaImagem, {
        x: posicaoX,
        y: posicaoY,
        width: larguraAssinatura,
        height: alturaAssinatura,
      });

      const fonte = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const textoAssinatura = `Assinado digitalmente por ${
        user.email ?? "usuário"
      } em ${new Date().toLocaleString("pt-BR")}`;

      paginaAlvo.drawText(textoAssinatura, {
        x: margem,
        y: posicaoY + alturaAssinatura + 12,
        size: 10,
        font: fonte,
        color: rgb(0.2, 0.2, 0.2),
      });

      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([pdfBytes.buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const fileBasePath = `${user.id}/${registro.tipo}/assinados/${registro.id}-${Date.now()}`;
      const pdfStoragePath = `${fileBasePath}.pdf`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("formularios")
        .upload(pdfStoragePath, pdfBlob, {
          contentType: "application/pdf",
        });

      if (uploadError || !uploadData) {
        resetSignProgress();
        setError(
          uploadError?.message ||
            "Erro ao fazer upload do arquivo assinado para o Storage.",
        );
        return;
      }

      const signedPdfPath = uploadData.path ?? pdfStoragePath;

      const { data: pdfPublicData } = supabase.storage
        .from("formularios")
        .getPublicUrl(signedPdfPath);
      const signedPdfPublicUrl = pdfPublicData?.publicUrl ?? null;

      const htmlPath = `${fileBasePath}-view.html`;
      const tipoDescricao = tipoLabel[registro.tipo] ?? registro.tipo;
      const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Documento assinado - ${registro.id}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px; }
    .wrapper { max-width: 960px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .meta { font-size: 13px; color: #475569; margin-bottom: 24px; }
    iframe { width: 100%; height: 640px; border: 1px solid #e2e8f0; border-radius: 12px; background: #1e293b08; }
    .signature-section { margin-top: 32px; }
    .signature-box { border: 1px dashed #94a3b8; padding: 24px; border-radius: 12px; background: #f1f5f9; text-align: center; }
    .signature-box img { max-width: 100%; max-height: 230px; display: inline-block; }
    .signature-footer { font-size: 13px; color: #475569; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <h1>Documento assinado</h1>
    <p class="meta">${tipoDescricao}</p>
    <section>
      <h2>Arquivo assinado</h2>
      ${
        signedPdfPublicUrl
          ? `<iframe src="${signedPdfPublicUrl}" title="Documento assinado"></iframe>`
          : `<p style="font-size:13px;color:#ef4444;">Não foi possível embutir o PDF assinado automaticamente. Faça o download pelo portal para visualizar.</p>`
      }
    </section>
    <section class="signature-section">
      <h2>Assinatura aplicada</h2>
      <div class="signature-box">
        <img src="${assinaturaAtual}" alt="Assinatura aplicada" />
        <p class="signature-footer">Assinado por ${user.email ?? "usuário"} em ${new Date().toLocaleString("pt-BR")}</p>
      </div>
    </section>
  </div>
</body>
</html>`;

      const htmlBlob = new Blob([htmlContent], { type: "text/html" });

      const { data: htmlUploadData, error: htmlUploadError } =
        await supabase.storage
          .from("formularios")
          .upload(htmlPath, htmlBlob, {
            contentType: "text/html",
          });

      if (htmlUploadError || !htmlUploadData) {
        resetSignProgress();
        setError(
          htmlUploadError?.message ||
            "Erro ao criar a visualização HTML do documento assinado.",
        );
        return;
      }

      const signedHtmlPath = htmlUploadData.path ?? htmlPath;

      const { error: updateError } = await supabase
        .from("formularios")
        .update({
          status: "assinado",
          arquivo_assinado_path: signedHtmlPath,
          assinado_por: user.email ?? null,
        })
        .eq("id", registro.id);

      if (updateError) {
        resetSignProgress();
        setError(updateError.message);
        return;
      }

      setRegistro((prev) =>
        prev
          ? {
              ...prev,
              status: "assinado",
              arquivo_assinado_path: signedHtmlPath,
              assinado_por: user.email ?? null,
            }
          : prev,
      );

      try {
        const signedUrl = await getSignedFileUrl(signedHtmlPath);
        setPublicUrl(signedUrl);
      } catch (linkErr) {
        console.error("Erro ao gerar link do arquivo assinado:", linkErr);
      }

      completeSignProgress();
      setSuccess("Documento assinado enviado com sucesso!");
      if (batchActive) {
        const queueAfterSubmit = [...remainingAfterCurrent];
        setTimeout(() => {
          goToQueue(queueAfterSubmit);
        }, 1200);
      }
    } catch (err) {
      console.error("Erro ao salvar documento assinado:", err);
      resetSignProgress();
      setError("Não foi possível salvar o documento assinado.");
    } finally {
      setSaving(false);
    }
  };

  const downloadActiveSignature = () => {
    const source = activeSignature ?? storedSignature;
    if (!source) {
      return;
    }

    const link = document.createElement("a");
    link.href = source;
    link.download = `assinatura-${user?.email ?? "documento"}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (authLoading || accessLoading || loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando documento...
      </div>
    );
  }

  if (!registro) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-slate-300">
        <p className="text-slate-700">
          {error ?? authError ?? "Documento não encontrado."}
        </p>
        <button
          type="button"
          onClick={() => router.push("/documentos")}
          className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 shadow-lg shadow-emerald-500/40 transition hover:bg-emerald-400"
        >
          Voltar para documentos
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <Script src="/signature.js" strategy="afterInteractive" />

      <div className="flex items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-2 text-xs text-slate-500 hover:text-emerald-600"
          >
            Voltar
          </button>
          <div className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-slate-700" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Assinar documento
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {tipoLabel[registro.tipo] ?? registro.tipo} |{" "}
            {new Date(registro.created_at).toLocaleString("pt-BR")}
          </p>
        </div>
        <span
          className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${
            registro.status === "assinado"
              ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
          }`}
        >
          {registro.status === "assinado" ? "Assinado" : "Pendente"}
        </span>
      </div>

      {batchActive && (
        <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 text-xs text-slate-600 shadow-sm shadow-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Processo em lote
              </p>
              {currentIndexInBatch >= 0 ? (
                <p className="text-[11px] text-slate-500">
                  Documento {currentIndexInBatch + 1} de {loteQueue.length}
                </p>
              ) : (
                <p className="text-[11px] text-amber-600">
                  Este documento não estava na fila; selecione abaixo para
                  reorganizar.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSkipCurrent}
                disabled={remainingAfterCurrent.length === 0}
                className="rounded-full border border-slate-300 px-3 py-1 text-[11px] text-slate-700 transition hover:border-slate-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {remainingAfterCurrent.length === 0
                  ? "Fila concluída"
                  : "Ir para próximo"}
              </button>
              <button
                type="button"
                onClick={() => handleRemoveFromBatch(params.id)}
                className="rounded-full border border-red-200 px-3 py-1 text-[11px] text-red-600 transition hover:border-red-300 hover:bg-red-50"
              >
                Remover atual da fila
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {loteQueue.map((id) => (
              <div
                key={id}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] ${
                  id === params.id
                    ? "border-sky-300 bg-sky-50 text-sky-700"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleChooseFromBatch(id)}
                  className="font-semibold"
                  title="Ir para este documento"
                >
                  {id.slice(0, 8)}...
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveFromBatch(id)}
                  className="rounded-full bg-slate-200 px-1 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-300"
                  title="Remover da fila"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {signProgress > 0 && (
        <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-xs text-slate-600 shadow-sm shadow-sky-100">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-600">
              Processando assinatura
            </p>
            <span className="text-[11px] font-semibold text-sky-700">
              {Math.min(signProgress, 100).toFixed(0)}%
            </span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-white">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-sky-400 via-emerald-400 to-sky-400 transition-all"
              style={{ width: `${Math.min(signProgress, 100)}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Mantemos o documento aberto para revisao enquanto aplicamos sua
            assinatura.
          </p>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Documento original
          </h2>
          {publicUrl ? (
            <>
              <iframe
                src={publicUrl}
                className="h-80 w-full rounded-lg border border-slate-200 bg-slate-50"
              />
              <div className="mt-3 flex gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => void abrirEmNovaAba()}
                  className="rounded-full border border-slate-300 px-3 py-1 text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
                >
                  Abrir em nova aba
                </button>
                <button
                  type="button"
                  onClick={() => void baixarArquivoAtual()}
                  className="rounded-full border border-slate-300 px-3 py-1 text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  Baixar
                </button>
                <button
                  type="button"
                  onClick={() => void refreshPublicUrl()}
                  className="rounded-full border border-slate-200 px-3 py-1 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                >
                  Atualizar visualização
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              Não foi possível gerar a visualização do arquivo. Você ainda pode
              baixá-lo pela página de documentos.
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Tela de assinatura
          </h2>
          <div
            id="signature-root"
            className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-[11px] text-slate-500"
          >
            {activeSignature ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
                <img
                  src={activeSignature}
                  alt="Assinatura selecionada"
                  className="h-32 max-w-full rounded-xl border border-slate-200 bg-white object-contain p-2"
                />
                <p className="text-[11px] text-slate-500">
                  {signatureSource === "upload"
                    ? "Arquivo enviado nesta tela. Ele é usado apenas neste documento."
                    : "Assinatura vinda da aba Perfil. Atualize por lá se precisar alterar permanentemente."}
                </p>
                <div className="flex flex-wrap justify-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={downloadActiveSignature}
                    className="rounded-full border border-slate-300 px-3 py-1 text-slate-700 transition hover:border-slate-500 hover:bg-white"
                  >
                    Baixar assinatura atual
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/perfil")}
                    className="rounded-full border border-sky-300 px-3 py-1 text-sky-700 transition hover:border-sky-400 hover:bg-sky-50"
                  >
                    Abrir aba Perfil
                  </button>
                </div>
                {signatureSource === "upload" && uploadedSignatureName && (
                  <p className="text-[10px] text-slate-400">
                    Arquivo enviado:{" "}
                    <span className="font-semibold text-slate-600">
                      {uploadedSignatureName}
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                <p>
                  Nenhuma assinatura carregada. Envie um arquivo abaixo ou abra a
                  aba Perfil para criar uma assinatura padrão.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/perfil")}
                  className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-semibold text-white shadow-sm shadow-slate-400/60 transition hover:bg-slate-700"
                >
                  Criar assinatura no perfil
                </button>
                <p className="text-[10px] text-slate-400">
                  Mantemos o elemento com ID{" "}
                  <span className="font-mono text-slate-600">
                    signature-root
                  </span>{" "}
                  para integrações customizadas se você usar um script próprio.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-[11px] text-slate-600">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Como deseja aplicar a assinatura?
            </p>
            <p>
              Você pode escolher a assinatura salva no Perfil ou enviar um arquivo
              (PNG, JPG ou SVG) exclusivo para este documento.
            </p>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <label className="inline-flex cursor-pointer items-center rounded-full border border-dashed border-slate-300 bg-white px-4 py-1.5 text-slate-600 transition hover:border-slate-400">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={handleSignatureUpload}
                />
                Enviar arquivo de assinatura
              </label>
              <button
                type="button"
                onClick={usarAssinaturaDoPerfil}
                disabled={!storedSignature}
                className="rounded-full border border-sky-300 px-4 py-1.5 text-sky-700 transition hover:border-sky-400 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Usar assinatura do perfil
              </button>
              {signatureSource === "upload" && (
                <button
                  type="button"
                  onClick={descartarAssinaturaEnviada}
                  className="rounded-full border border-red-200 px-4 py-1.5 text-red-600 transition hover:border-red-300 hover:bg-red-50"
                >
                  Descartar upload
                </button>
              )}
            </div>
            {uploadedSignatureName && (
              <p className="text-[10px] text-slate-500">
                Arquivo selecionado:{" "}
                <span className="font-semibold text-slate-700">
                  {uploadedSignatureName}
                </span>
              </p>
            )}
            {!storedSignature && (
              <p className="text-[10px] text-slate-500">
                Sem assinatura no Perfil ainda. Use o botão acima para criar uma
                antes ou carregue um arquivo manualmente.
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3 pt-2 text-sm">
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Upload do arquivo assinado
              </p>
              <p className="text-[11px] text-slate-500">
                Usaremos a assinatura exibida acima para gerar o arquivo que será
                enviado ao Supabase. Garanta que a pré-visualização esteja correta
                antes de enviar.
              </p>
              {activeSignature ? (
                <p className="text-[11px] text-emerald-700">
                  Pronto! Uma assinatura está carregada para este documento.
                </p>
              ) : (
                <p className="text-[11px] text-red-600">
                  Nenhuma assinatura ativa. Faça upload ou use a opção do Perfil
                  antes de continuar.
                </p>
              )}
            </div>

            {(error || authError) && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error ?? authError}
              </p>
            )}
            {success && (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {success}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => router.push("/documentos")}
                className="rounded-full border border-slate-300 px-4 py-1.5 text-[11px] text-slate-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
              >
                Voltar
              </button>
              <button
                type="submit"
                disabled={saving || registro.status === "assinado"}
                className="rounded-full bg-sky-500 px-4 py-1.5 text-[11px] font-semibold text-white shadow-md shadow-sky-300/80 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {registro.status === "assinado"
                  ? "Documento já assinado"
                  : saving
                    ? "Salvando..."
                    : "Enviar documento assinado"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}


