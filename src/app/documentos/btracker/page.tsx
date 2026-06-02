"use client";

import { useCallback, useEffect, useState } from "react";
import { BtrackerAuth } from "./_components/BtrackerAuth";
import { NfseUploader } from "./_components/NfseUploader";
import { NfseReview } from "./_components/NfseReview";
import type { NfseExtracted } from "@/lib/nfseExtractor";
import type { BtrackerNfse } from "@/lib/btrackerApi";

type ExtractionResult =
  | { source: "xml" | "ocr+ai"; data: NfseExtracted }
  | { source: "btracker"; data: BtrackerNfse };

export default function BtrackerPage() {
  const [btConnected, setBtConnected] = useState(false);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [matchedPedido, setMatchedPedido] = useState<BtrackerNfse | null>(null);

  // Check cookie-based BTracker connection on mount
  useEffect(() => {
    fetch("/api/btracker/auth")
      .then((r) => r.json())
      .then((d: { connected: boolean }) => setBtConnected(d.connected))
      .catch(() => {});
  }, []);

  const handleExtracted = useCallback(
    async (result: ExtractionResult, f: File) => {
      setExtraction(result);
      setFile(f);
      setMatchedPedido(null);

      if (!btConnected) return;
      if (result.source === "btracker") return; // BTracker already knows the data

      // Try to find matching open pedido by emitente CNPJ
      const cnpj =
        result.source === "xml" || result.source === "ocr+ai"
          ? (result.data as NfseExtracted).emitente?.cnpj?.value
          : null;

      if (!cnpj) return;

      try {
        const res = await fetch(`/api/btracker/pedidos?cnpj=${encodeURIComponent(cnpj)}`);
        if (!res.ok) return;
        const json = (await res.json()) as { results?: BtrackerNfse[] };
        const nfse = (result.data as NfseExtracted);

        // Match by approximate value (within 1%)
        const valorNf = nfse.servico.valorServicos.value;
        const match = json.results?.find((p) => {
          if (!valorNf) return false;
          const diff = Math.abs(parseFloat(p.valorServicos ?? "0") - valorNf) / valorNf;
          return diff < 0.01;
        });
        setMatchedPedido(match ?? json.results?.[0] ?? null);
      } catch {
        // non-critical
      }
    },
    [btConnected],
  );

  const isNfseExtracted = extraction?.source === "xml" || extraction?.source === "ocr+ai";
  const reviewData = isNfseExtracted ? (extraction.data as NfseExtracted) : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Adicionar NFS-e ao BTracker</h1>
          <p className="mt-1 text-sm text-slate-500">
            Extração inteligente com XML, OCR e IA — revisão antes de enviar.
          </p>
        </div>
        <BtrackerAuth
          connected={btConnected}
          onConnected={() => setBtConnected(true)}
          onDisconnected={() => setBtConnected(false)}
        />
      </div>

      {/* Upload or Review */}
      {!extraction ? (
        <NfseUploader
          btrackerConnected={btConnected}
          onExtracted={(r, f) => void handleExtracted(r, f)}
        />
      ) : reviewData ? (
        <NfseReview
          data={reviewData}
          btrackerConnected={btConnected}
          matchedPedido={matchedPedido}
          fileName={file?.name ?? ""}
          onReset={() => { setExtraction(null); setFile(null); setMatchedPedido(null); }}
        />
      ) : (
        // BTracker native extraction result — show simple summary
        <BtrackerNativeResult
          data={extraction.data as BtrackerNfse}
          fileName={file?.name ?? ""}
          onReset={() => { setExtraction(null); setFile(null); }}
        />
      )}
    </div>
  );
}

function BtrackerNativeResult({
  data,
  fileName,
  onReset,
}: {
  data: BtrackerNfse;
  fileName: string;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-800">
          NFS-e {data.numero} — extraída pelo BTracker
        </p>
        <button
          onClick={onReset}
          className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50"
        >
          Trocar arquivo
        </button>
      </div>
      <p className="text-xs text-slate-600">
        Prestador: {data.prestador?.razaoSocial} ({data.prestador?.documento})
      </p>
      <p className="text-xs text-slate-600">
        Valor: R${" "}
        {parseFloat(data.valorServicos ?? "0").toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
        })}{" "}
        · Líquido: R${" "}
        {parseFloat(data.valorLiquidoNfse ?? "0").toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
        })}
      </p>
      <p className="text-[11px] text-amber-700">
        Arquivo: {fileName} — extração via BTracker (OCR proprietário). Para maior precisão, use
        o XML da NFS-e.
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
  );
}
