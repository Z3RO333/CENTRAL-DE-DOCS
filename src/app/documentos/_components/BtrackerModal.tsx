"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { BtrackerAuth } from "@/app/documentos/btracker/_components/BtrackerAuth";
import { NfseReview } from "@/app/documentos/btracker/_components/NfseReview";
import type { NfseExtracted } from "@/lib/nfseExtractor";
import type { BtrackerNfse } from "@/lib/btrackerApi";

type ExtractionResult =
  | { source: "xml" | "ocr+ai"; data: NfseExtracted }
  | { source: "btracker"; data: BtrackerNfse };

type Props = {
  documentoId: string;
  fileName: string;
  cnpj?: string | null;
  accessToken: string;
  onClose: () => void;
};

export function BtrackerModal({ documentoId, fileName, cnpj, accessToken, onClose }: Props) {
  const [btConnected, setBtConnected] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchedPedido, setMatchedPedido] = useState<BtrackerNfse | null>(null);

  // Check BTracker connection
  useEffect(() => {
    fetch("/api/btracker/auth")
      .then((r) => r.json())
      .then((d: { connected: boolean }) => setBtConnected(d.connected))
      .catch(() => {});
  }, []);

  // Auto-extract when modal opens
  const extract = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/btracker/extrair-documento/${documentoId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = (await res.json()) as ExtractionResult & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `Status ${res.status}`);
      setExtraction(json);

      // Try to match open pedido by CNPJ
      const extractedCnpj =
        json.source !== "btracker"
          ? (json.data as NfseExtracted).emitente?.cnpj?.value ?? cnpj
          : cnpj;

      if (extractedCnpj && btConnected) {
        const pRes = await fetch(
          `/api/btracker/pedidos?cnpj=${encodeURIComponent(extractedCnpj)}`,
        );
        if (pRes.ok) {
          const pJson = (await pRes.json()) as { results?: BtrackerNfse[] };
          const valorNf =
            json.source !== "btracker"
              ? (json.data as NfseExtracted).servico.valorServicos.value
              : null;
          const match = pJson.results?.find((p) => {
            if (!valorNf) return false;
            const diff = Math.abs(parseFloat(p.valorServicos ?? "0") - valorNf) / valorNf;
            return diff < 0.01;
          });
          setMatchedPedido(match ?? pJson.results?.[0] ?? null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na extração");
    } finally {
      setLoading(false);
    }
  }, [documentoId, accessToken, btConnected, cnpj]);

  useEffect(() => {
    void extract();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  const isNfse = extraction?.source === "xml" || extraction?.source === "ocr+ai";
  const reviewData = isNfse ? (extraction.data as NfseExtracted) : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">Enviar ao BTracker</p>
            <p className="text-xs text-slate-500">{fileName}</p>
          </div>
          <div className="flex items-center gap-3">
            <BtrackerAuth
              connected={btConnected}
              onConnected={() => setBtConnected(true)}
              onDisconnected={() => setBtConnected(false)}
            />
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
              <p className="text-sm text-slate-500">Extraindo dados da NF...</p>
              <p className="text-xs text-slate-400">Document Intelligence + IA fiscal</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col gap-3 py-8 text-center">
              <p className="text-sm font-medium text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => void extract()}
                className="mx-auto rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {!loading && !error && reviewData && (
            <NfseReview
              data={reviewData}
              btrackerConnected={btConnected}
              matchedPedido={matchedPedido}
              fileName={fileName}
              onReset={() => void extract()}
            />
          )}

          {!loading && !error && extraction?.source === "btracker" && (
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-800">
                Extraído pelo BTracker
              </p>
              <p className="text-xs text-amber-700">
                Extração via OCR proprietário do BTracker. Para maior precisão, solicite o XML da NFS-e ao prestador.
              </p>
              <a
                href="https://btracker.bemol.com.br/notas/recebimento"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1.5 rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
              >
                Ver no BTracker
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
