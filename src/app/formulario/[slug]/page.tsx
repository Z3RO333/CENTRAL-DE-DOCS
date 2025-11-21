"use client";

import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { FilePlus2 } from "lucide-react";

type FormField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "date";
  placeholder?: string;
};

type FormConfig = {
  slug: string;
  tipo: string;
  title: string;
  description: string;
  fields: FormField[];
};

const FORM_CONFIGS: FormConfig[] = [
  {
    slug: "retencao-trabalhista",
    tipo: "retencao_trabalhista",
    title: "Retenção Trabalhista",
    description:
      "Informe os dados necessários para análise e controle de retenções trabalhistas.",
    fields: [
      {
        name: "empresa",
        label: "Empresa",
        type: "text",
        placeholder: "Razão social ou nome fantasia",
      },
      {
        name: "cnpj",
        label: "CNPJ",
        type: "text",
        placeholder: "00.000.000/0000-00",
      },
      {
        name: "competencia",
        label: "Competência",
        type: "text",
        placeholder: "MM/AAAA",
      },
      {
        name: "observacoes",
        label: "Observações",
        type: "textarea",
        placeholder: "Detalhes adicionais sobre a retenção",
      },
    ],
  },
  {
    slug: "registro-laudos",
    tipo: "registro_laudos",
    title: "Registro e Laudos",
    description:
      "Envie laudos e registros técnicos para armazenamento e controle interno.",
    fields: [
      {
        name: "tipo_laudo",
        label: "Tipo de laudo",
        type: "text",
        placeholder: "Ex.: Laudo Técnico, PPRA, LTCAT, etc.",
      },
      {
        name: "responsavel",
        label: "Responsável",
        type: "text",
        placeholder: "Nome do responsável técnico",
      },
      {
        name: "data_emissao",
        label: "Data de emissão",
        type: "date",
      },
      {
        name: "observacoes",
        label: "Observações",
        type: "textarea",
        placeholder: "Informações adicionais importantes",
      },
    ],
  },
  {
    slug: "notas-fiscais",
    tipo: "notas_fiscais",
    title: "Notas Fiscais",
    description:
      "Cadastre e armazene notas fiscais emitidas para controle e auditoria.",
    fields: [
      {
        name: "numero_nf",
        label: "Número da nota",
        type: "text",
        placeholder: "Número completo da nota fiscal",
      },
      {
        name: "cnpj_emitente",
        label: "CNPJ do emitente",
        type: "text",
        placeholder: "00.000.000/0000-00",
      },
      {
        name: "valor",
        label: "Valor",
        type: "number",
        placeholder: "0,00",
      },
      {
        name: "descricao",
        label: "Descrição / Histórico",
        type: "textarea",
        placeholder: "Descrição dos serviços/produtos",
      },
    ],
  },
];

type FormValues = Record<string, string>;

export default function FormularioPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();

  const config = useMemo(
    () => FORM_CONFIGS.find((f) => f.slug === params.slug),
    [params.slug],
  );

  const [values, setValues] = useState<FormValues>({});
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const ensureAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
      }
    };

    void ensureAuth();
  }, [router]);

  useEffect(() => {
    if (config) {
      const initial: FormValues = {};
      config.fields.forEach((f) => {
        initial[f.name] = "";
      });
      setValues(initial);
    }
  }, [config]);

  if (!config) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-sm text-slate-300">
        <p>Formulário não encontrado.</p>
      </div>
    );
  }

  const handleChange = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      if (!file) {
        setError("Selecione um arquivo para enviar (PDF, PNG ou JPEG).");
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setError("Sessão expirada. Faça login novamente.");
        router.push("/login");
        return;
      }

      const fileExt = file.name.split(".").pop();
      const filePath = `${user.id}/${config.tipo}/${Date.now()}.${fileExt}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("formularios")
        .upload(filePath, file);

      if (uploadError || !uploadData) {
        setError(
          uploadError?.message ||
            "Erro ao fazer upload do arquivo para o Storage.",
        );
        return;
      }

      const payload = {
        user_id: user.id,
        tipo: config.tipo,
        dados: values,
        arquivo_path: uploadData.path ?? filePath,
        status: "pendente",
      };

      const { error: insertError } = await supabase
        .from("formularios")
        .insert(payload);

      if (insertError) {
        setError(insertError.message);
        return;
      }

      setSuccess("Formulário enviado com sucesso!");
      setFile(null);
      setValues((prev) =>
        Object.fromEntries(Object.keys(prev).map((key) => [key, ""])),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div>
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-3 text-xs text-slate-500 hover:text-sky-600"
        >
          ← Voltar
        </button>
        <div className="flex items-center gap-2">
          <FilePlus2 className="h-5 w-5 text-slate-700" />
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {config.title}
          </h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">{config.description}</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200"
      >
        <div className="grid gap-4 md:grid-cols-2">
          {config.fields.map((field) => (
            <div key={field.name} className="space-y-1.5 text-sm">
              <label
                htmlFor={field.name}
                className="block text-xs font-medium uppercase tracking-wide text-slate-600"
              >
                {field.label}
              </label>
              {field.type === "textarea" ? (
                <textarea
                  id={field.name}
                  required={field.name !== "observacoes" && field.name !== "descricao"}
                  value={values[field.name] ?? ""}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  className="min-h-[96px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500/40 placeholder:text-slate-400 focus:border-sky-500 focus:ring"
                />
              ) : (
                <input
                  id={field.name}
                  type={field.type}
                  required
                  value={values[field.name] ?? ""}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-sky-500/40 placeholder:text-slate-400 focus:border-sky-500 focus:ring"
                />
              )}
            </div>
          ))}
        </div>

        <div className="mt-2 space-y-2 text-sm">
          <label
            htmlFor="arquivo"
            className="block text-xs font-medium uppercase tracking-wide text-slate-600"
          >
            Arquivo (PDF, PNG ou JPEG)
          </label>
          <input
            id="arquivo"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            required
            onChange={(e) => {
              const selectedFile = e.target.files?.[0] ?? null;
              setFile(selectedFile);
            }}
            className="block w-full cursor-pointer rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-sky-500 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:border-sky-500"
          />
          <p className="text-[11px] text-slate-500">
            Tamanho máximo definido no Storage da sua instância Supabase.
          </p>
        </div>

        {error && (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        {success && (
          <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
            {success}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <p className="text-[11px] text-slate-500">
            Ao enviar, o documento será salvo na tabela{" "}
            <span className="font-semibold text-slate-700">formularios</span>{" "}
            e no bucket{" "}
            <span className="font-semibold text-slate-700">
              formularios
            </span>{" "}
            do Supabase Storage.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-sky-300/70 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "Enviando..." : "Enviar formulário"}
          </button>
        </div>
      </form>
    </div>
  );
}
