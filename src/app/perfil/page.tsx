"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  PenLine,
  ShieldCheck,
  Undo2,
  Upload,
  Wand2,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";

const SIGNATURE_STORAGE_PREFIX = "digital-signature:";

type StatusBanner = {
  type: "success" | "error";
  message: string;
};

export default function PerfilPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, error: authError } = useAuth();
  const {
    hasAccess: hasDocumentsAccess,
    loading: accessLoading,
  } = useDocumentsAccess();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusBanner | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const storageKey = user?.id
    ? `${SIGNATURE_STORAGE_PREFIX}${user.id}`
    : null;

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
    }
  }, [authLoading, accessLoading, user, hasDocumentsAccess, router]);

  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) {
      return;
    }

    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSignaturePreview(stored);
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [storageKey]);

  const resetCanvasSurface = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.restore();
  }, []);

  useEffect(() => {
    resetCanvasSurface();
  }, [resetCanvasSurface]);

  const getRelativePosition = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    const { x, y } = getRelativePosition(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
    setStatus(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (!drawingRef.current) {
      return;
    }
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    const { x, y } = getRelativePosition(event);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const endDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return;
    }
    event.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx) {
      ctx.closePath();
    }
    drawingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const isCanvasBlank = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return true;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return true;
    }
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buffer = new Uint32Array(pixels.data.buffer);
    return buffer.every((color) => color === 0xffffffff);
  };

  const handleSaveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !storageKey) {
      setStatus({
        type: "error",
        message: "Não foi possível acessar a tela de assinatura.",
      });
      return;
    }

    if (!hasDrawn || isCanvasBlank()) {
      setStatus({
        type: "error",
        message: "Desenhe sua assinatura antes de salvar.",
      });
      return;
    }

    const dataUrl = canvas.toDataURL("image/png");

    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, dataUrl);
    }

    setSignaturePreview(dataUrl);
    setHasDrawn(false);
    setUploadName(null);
    setStatus({
      type: "success",
      message:
        "Assinatura salva. Use o botao abaixo para baixar e anexar aos documentos.",
    });
  };

  const handleSignatureUpload = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!storageKey) {
      setStatus({
        type: "error",
        message: "Não foi possível acessar o navegador para salvar o arquivo.",
      });
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStatus({
        type: "error",
        message: "Envie apenas imagens (PNG, JPG ou SVG).",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(storageKey, result);
        }
        setSignaturePreview(result);
        setUploadName(file.name);
        setHasDrawn(false);
        resetCanvasSurface();
        setStatus({
          type: "success",
          message: "Arquivo importado e armazenado para usar nas assinaturas.",
        });
      }
    };
    reader.onerror = () => {
      setStatus({
        type: "error",
        message: "Falha ao processar o arquivo enviado.",
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadSignature = () => {
    const source =
      signaturePreview || canvasRef.current?.toDataURL("image/png") || null;

    if (!source) {
      setStatus({
        type: "error",
        message: "Nenhuma assinatura disponível para download.",
      });
      return;
    }

    const link = document.createElement("a");
    link.href = source;
    link.download = `assinatura-${user?.email ?? "documento"}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatus({
      type: "success",
      message: "Download iniciado. Anexe o arquivo no momento da assinatura.",
    });
  };

  const handleClearCanvas = () => {
    resetCanvasSurface();
    setHasDrawn(false);
    setStatus(null);
  };

  if (authLoading || accessLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        {authError ?? "Carregando perfil..."}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-slate-700" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Perfil e assinatura
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Atualize seus dados e gere uma assinatura digital para anexar aos
            documentos.
          </p>
        </div>
      </div>

      {(status || authError) && (
        <div
          className={`rounded-2xl border px-4 py-3 text-xs ${
            status?.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : status?.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {status?.message ?? authError}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm shadow-slate-200">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <PenLine className="h-4 w-4 text-slate-600" />
            Assinatura digital
          </div>
          <p className="text-[11px] text-slate-500">
            Use o mouse ou o dedo (em telas touch) para desenhar a assinatura que
            sera usada ao enviar documentos assinados.
          </p>
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3">
            <canvas
              ref={canvasRef}
              width={900}
              height={280}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrawing}
              onPointerLeave={endDrawing}
              className="h-48 w-full rounded-xl border border-slate-200 bg-white shadow-inner"
            />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 text-[11px] text-slate-600">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Upload className="h-3.5 w-3.5 text-slate-600" />
              Ou anexe sua assinatura pronta
            </div>
            <p className="mt-1">
              Envie um arquivo PNG, JPG ou SVG para reutilizar sempre que
              precisar. Ele fica salvo somente no seu navegador.
            </p>
            <label className="mt-3 block">
              <span className="sr-only">Upload de assinatura</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={handleSignatureUpload}
                className="block w-full cursor-pointer rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-600 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-sky-500 file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:border-sky-400"
              />
            </label>
            {uploadName && (
              <p className="mt-2 text-[10px] text-slate-500">
                Ultimo arquivo importado:{" "}
                <span className="font-semibold text-slate-700">
                  {uploadName}
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <button
              type="button"
              onClick={handleClearCanvas}
              className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Limpar tela
            </button>
            <button
              type="button"
              onClick={handleSaveSignature}
              className="inline-flex items-center gap-1 rounded-full bg-sky-500 px-4 py-1 font-semibold text-white shadow-md shadow-sky-300/80 transition hover:bg-sky-400"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Salvar assinatura
            </button>
            <button
              type="button"
              onClick={handleDownloadSignature}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-400/70 px-3 py-1 text-emerald-700 transition hover:bg-emerald-50"
            >
              <Download className="h-3.5 w-3.5" />
              Baixar PNG
            </button>
          </div>
        </div>

        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm shadow-slate-200">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Seus dados
            </span>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-600">
              <p className="font-semibold text-slate-900">
                {user.user_metadata?.name ?? user.email}
              </p>
              <p className="text-slate-500">{user.email}</p>
              <p className="mt-2 text-[11px] text-slate-500">
                Dominio liberado para assinar:{" "}
                <span className="font-semibold text-emerald-600">
                {hasDocumentsAccess ? "@bemol.com.br" : "não autorizado"}
                </span>
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Assinatura salva
            </span>
            {signaturePreview ? (
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-3">
                <img
                  src={signaturePreview}
                  alt="Pré-visualização da assinatura"
                  className="h-28 w-full rounded-xl border border-slate-100 bg-white object-contain p-2"
                />
                <p className="mt-2 text-[11px] text-slate-500">
                  Essa imagem fica salva somente no seu navegador para agilizar o
                  envio de documentos. Utilize o botao de download para anexa-la
                  no fluxo de assinatura dos documentos.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-[11px] text-slate-500">
                Nenhuma assinatura salva ainda. Depois de desenhar e salvar, ela
                aparecera aqui para download rapido.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}





