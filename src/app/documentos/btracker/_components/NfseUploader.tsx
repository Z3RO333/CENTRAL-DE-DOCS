"use client";

import { useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import type { NfseExtracted } from "@/lib/nfseExtractor";
import type { BtrackerNfse } from "@/lib/btrackerApi";

type ExtractionResult =
  | { source: "xml" | "ocr+ai"; data: NfseExtracted }
  | { source: "btracker"; data: BtrackerNfse };

type Props = {
  btrackerConnected: boolean;
  onExtracted: (result: ExtractionResult, file: File) => void;
};

const ACCEPTED = ".xml,.pdf,.png,.jpg,.jpeg,.webp";

export function NfseUploader({ btrackerConnected, onExtracted }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (btrackerConnected) form.append("btrackerFallback", "1");

      const res = await fetch("/api/btracker/extrair", { method: "POST", body: form });
      const json = (await res.json()) as ExtractionResult & { error?: string };

      if (!res.ok || json.error) throw new Error(json.error ?? `Status ${res.status}`);
      onExtracted(json, file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na extracao");
    } finally {
      setLoading(false);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void handleFile(f);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 transition ${
          dragOver
            ? "border-sky-400 bg-sky-50"
            : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
        } ${loading ? "pointer-events-none opacity-60" : ""}`}
      >
        {loading ? (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
            <p className="text-sm font-medium text-slate-600">Extraindo dados...</p>
          </>
        ) : (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
              <Upload className="h-6 w-6 text-slate-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700">
                Arraste ou clique para selecionar a NFS-e
              </p>
              <p className="mt-1 text-xs text-slate-500">
                XML (preferencial), PDF ou imagem (JPG, PNG)
              </p>
            </div>
            <div className="flex gap-2">
              {["XML", "PDF", "JPG", "PNG"].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500"
                >
                  {t}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      ) : null}

      <div className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        <span className="font-semibold">Dica:</span> use o arquivo XML da NFS-e quando
        disponivel — extração 100% precisa, sem OCR.{" "}
        {!btrackerConnected && (
          <span>Conecte ao BTracker acima para buscar pedidos automaticamente.</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={onInputChange}
      />

      {/* Indicador de origem de qualidade */}
      <div className="flex gap-3 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3 text-green-500" /> XML = 100% preciso
        </span>
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3 text-sky-500" /> PDF/Imagem = OCR + IA (~85-95%)
        </span>
      </div>
    </div>
  );
}
