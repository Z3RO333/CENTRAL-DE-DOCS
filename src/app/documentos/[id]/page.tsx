"use client";

import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import Script from "next/script";
import { supabase } from "@/lib/supabaseClient";
import { FileSignature } from "lucide-react";

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

export default function AssinaturaDocumentoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [registro, setRegistro] = useState<FormularioRecord | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [signedFile, setSignedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const fetchRegistro = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const email = user.email?.toLowerCase() ?? "";
      const isBemolEmail = email.endsWith("@bemol.com.br");

      if (!isBemolEmail) {
        setError(
          "Você não tem acesso a esta área. Procure por richardoliveira@bemol.com para solicitar acesso.",
        );
        setLoading(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from("formularios")
        .select("*")
        .eq("id", params.id)
        .eq("user_id", user.id)
        .single();

      if (fetchError || !data) {
        setError("Documento não encontrado.");
        setLoading(false);
        return;
      }

      const record: FormularioRecord = {
        id: data.id,
        tipo: data.tipo,
        status: data.status,
        arquivo_path: data.arquivo_path,
        arquivo_assinado_path: data.arquivo_assinado_path,
        created_at: data.created_at,
        assinado_por: data.assinado_por,
      };

      setRegistro(record);

      const path = record.arquivo_assinado_path ?? record.arquivo_path;
      const { data: urlData } = supabase.storage
        .from("formularios")
        .getPublicUrl(path);
      setPublicUrl(urlData?.publicUrl ?? null);

      setLoading(false);
    };

    void fetchRegistro();
  }, [params.id, router]);

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
      if (!registro) return;
      if (!signedFile) {
        setError("Selecione o arquivo assinado (PDF, PNG ou JPEG).");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const fileExt = signedFile.name.split(".").pop();
      const filePath = `${user.id}/${registro.tipo}/assinados/${registro.id}-${Date.now()}.${fileExt}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("formularios")
        .upload(filePath, signedFile);

      if (uploadError || !uploadData) {
        setError(
          uploadError?.message ||
            "Erro ao fazer upload do arquivo assinado para o Storage.",
        );
        return;
      }

      const { error: updateError } = await supabase
        .from("formularios")
        .update({
          status: "assinado",
          arquivo_assinado_path: uploadData.path ?? filePath,
          assinado_por: user.email ?? null,
        })
        .eq("id", registro.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setRegistro((prev) =>
        prev
          ? {
              ...prev,
              status: "assinado",
              arquivo_assinado_path: uploadData.path ?? filePath,
              assinado_por: user.email ?? null,
            }
          : prev,
      );
      setSuccess("Documento assinado enviado com sucesso!");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
          {error ?? "Documento não encontrado."}
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
            ← Voltar
          </button>
          <div className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-slate-700" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Assinar documento
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {tipoLabel[registro.tipo] ?? registro.tipo} •{" "}
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
                  onClick={() => window.open(publicUrl, "_blank")}
                  className="rounded-full border border-slate-300 px-3 py-1 text-slate-700 transition hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700"
                >
                  Abrir em nova aba
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const link = document.createElement("a");
                    link.href = publicUrl;
                    link.download = "documento.pdf";
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="rounded-full border border-slate-300 px-3 py-1 text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                >
                  Baixar
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
            className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-[11px] text-slate-500"
          >
            Seu script de assinatura JS deve inicializar aqui. Coloque o arquivo{" "}
            <span className="font-semibold text-slate-300">
              /public/signature.js
            </span>{" "}
            e use o elemento com ID{" "}
            <span className="font-mono text-slate-700">signature-root</span>.
          </div>

          <form onSubmit={handleSubmit} className="space-y-3 pt-2 text-sm">
            <div className="space-y-2">
              <label
                htmlFor="arquivo_assinado"
                className="block text-xs font-medium uppercase tracking-wide text-slate-600"
              >
                Upload do arquivo assinado
              </label>
              <input
                id="arquivo_assinado"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                required={registro.status !== "assinado"}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSignedFile(file);
                }}
                disabled={registro.status === "assinado"}
                className="block w-full cursor-pointer rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-500 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="text-[11px] text-slate-500">
                Após salvar, o status será atualizado para{" "}
                <span className="font-semibold text-slate-700">assinado</span>.
                {registro.status === "assinado" &&
                  " Este documento já foi assinado; novo envio está desativado."}
              </p>
            </div>

            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
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
