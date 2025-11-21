"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Files, Filter, Search } from "lucide-react";

type FormularioRecord = {
  id: string;
  tipo: string;
  status: string;
  arquivo_path: string;
  arquivo_assinado_path?: string | null;
  created_at: string;
  dados: Record<string, unknown> | null;
  assinado_por?: string | null;
};

const tipoLabel: Record<string, string> = {
  retencao_trabalhista: "Retenção Trabalhista",
  registro_laudos: "Registro e Laudos",
  notas_fiscais: "Notas Fiscais",
};

export default function DocumentosPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [registros, setRegistros] = useState<FormularioRecord[]>([]);
  const [tipoFilter, setTipoFilter] = useState<string>("todos");
  const [prestadorFilter, setPrestadorFilter] = useState<string>("");
  const [anoFilter, setAnoFilter] = useState<string>("todos");
  const [dataInicial, setDataInicial] = useState<string>("");

  useEffect(() => {
    const load = async () => {
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

      const { data, error: listError } = await supabase
        .from("formularios")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (listError) {
        setError(listError.message);
        setLoading(false);
        return;
      }

      const parsed: FormularioRecord[] =
        data?.map((row) => {
          const dadosParsed =
            typeof row.dados === "string"
              ? (JSON.parse(row.dados) as Record<string, unknown>)
              : (row.dados as Record<string, unknown> | null);

          return {
            id: row.id as string,
            tipo: row.tipo as string,
            status: row.status as string,
            arquivo_path: row.arquivo_path as string,
            arquivo_assinado_path: row.arquivo_assinado_path as string | null,
            created_at: row.created_at as string,
            dados: dadosParsed,
            assinado_por: row.assinado_por as string | null,
          };
        }) ?? [];

      setRegistros(parsed);
      setLoading(false);
    };

    void load();
  }, [router]);

  const abrirDocumento = (registro: FormularioRecord) => {
    const path = registro.arquivo_assinado_path ?? registro.arquivo_path;
    const { data } = supabase.storage.from("formularios").getPublicUrl(path);

    if (data?.publicUrl) {
      window.open(data.publicUrl, "_blank");
    }
  };

  const baixarDocumento = (registro: FormularioRecord) => {
    const path = registro.arquivo_assinado_path ?? registro.arquivo_path;
    const { data } = supabase.storage.from("formularios").getPublicUrl(path);

    if (!data?.publicUrl) return;

    const link = document.createElement("a");
    link.href = data.publicUrl;
    const nomeArquivo = path.split("/").pop() ?? "documento.pdf";
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const anosDisponiveis = Array.from(
    new Set(
      registros.map((r) => new Date(r.created_at).getFullYear().toString()),
    ),
  ).sort((a, b) => Number(b) - Number(a));

  const registrosFiltrados = registros.filter((registro) => {
    if (tipoFilter !== "todos" && registro.tipo !== tipoFilter) {
      return false;
    }

    if (anoFilter !== "todos") {
      const anoRegistro = new Date(registro.created_at)
        .getFullYear()
        .toString();
      if (anoRegistro !== anoFilter) {
        return false;
      }
    }

    if (dataInicial) {
      const dataReg = new Date(registro.created_at);
      const dataIni = new Date(`${dataInicial}T00:00:00`);
      if (dataReg < dataIni) {
        return false;
      }
    }

    if (prestadorFilter.trim()) {
      const query = prestadorFilter.toLowerCase();
      const dados = registro.dados ?? {};
      const camposPossiveis = [
        dados.empresa,
        dados.responsavel,
        dados.cnpj,
        dados.cnpj_emitente,
      ]
        .filter((v) => typeof v === "string")
        .map((v) => (v as string).toLowerCase());

      const temMatch = camposPossiveis.some((valor) => valor.includes(query));
      if (!temMatch) {
        return false;
      }
    }

    return true;
  });

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        Carregando documentos...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Files className="h-5 w-5 text-slate-700" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Documentos enviados
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Consulte, visualize e assine os documentos enviados pelos
            formulários.
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {registros.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
          <p>Nenhum documento encontrado.</p>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="mt-4 rounded-full bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-sky-300/80 transition hover:bg-sky-400"
          >
            Enviar primeiro documento
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-sm shadow-slate-200">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <Filter className="h-3.5 w-3.5" />
              Filtros
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-500">
                  Tipo de formulário
                </label>
                <select
                  value={tipoFilter}
                  onChange={(e) => setTipoFilter(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none ring-sky-500/30 focus:border-sky-500 focus:ring"
                >
                  <option value="todos">Todos</option>
                  <option value="retencao_trabalhista">
                    Retenção Trabalhista
                  </option>
                  <option value="registro_laudos">Registro e Laudos</option>
                  <option value="notas_fiscais">Notas Fiscais</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-500">
                  Prestador (empresa / responsável / CNPJ)
                </label>
                <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5">
                  <Search className="h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={prestadorFilter}
                    onChange={(e) => setPrestadorFilter(e.target.value)}
                    placeholder="Buscar por nome ou CNPJ"
                    className="w-full bg-transparent text-xs text-slate-800 outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-500">
                  Data mínima (envio)
                </label>
                <input
                  type="date"
                  value={dataInicial}
                  onChange={(e) => setDataInicial(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none ring-sky-500/30 focus:border-sky-500 focus:ring"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-500">
                  Ano do serviço (envio)
                </label>
                <select
                  value={anoFilter}
                  onChange={(e) => setAnoFilter(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none ring-sky-500/30 focus:border-sky-500 focus:ring"
                >
                  <option value="todos">Todos</option>
                  {anosDisponiveis.map((ano) => (
                    <option key={ano} value={ano}>
                      {ano}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200">
          <table className="min-w-full text-left text-xs text-slate-800">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Criado em</th>
                <th className="px-4 py-3">Assinado por</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {registrosFiltrados.map((registro) => (
                <tr
                  key={registro.id}
                  className="border-t border-slate-800/80 odd:bg-slate-900/40 even:bg-slate-900/20"
                >
                  <td className="px-4 py-3 text-[11px] font-medium text-slate-900">
                    {tipoLabel[registro.tipo] ?? registro.tipo}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-500">
                    {new Date(registro.created_at).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-500">
                    {registro.assinado_por ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-[11px]">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        registro.status === "assinado"
                          ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
                          : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                      }`}
                    >
                      {registro.status === "assinado"
                        ? "Assinado"
                        : "Pendente de assinatura"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[11px]">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => abrirDocumento(registro)}
                        className="rounded-full border border-slate-300 px-3 py-1 text-[11px] text-slate-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
                      >
                        {registro.status === "assinado"
                          ? "Abrir arquivo assinado"
                          : "Abrir arquivo"}
                      </button>
                      <button
                        type="button"
                        onClick={() => baixarDocumento(registro)}
                        className="rounded-full border border-slate-300 px-3 py-1 text-[11px] text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                      >
                        Baixar
                      </button>
                      {registro.status !== "assinado" && (
                        <button
                          type="button"
                          onClick={() =>
                            router.push(`/documentos/${registro.id}`)
                          }
                          className="rounded-full bg-sky-500 px-3 py-1 text-[11px] font-semibold text-white shadow-md shadow-sky-300/80 transition hover:bg-sky-400"
                        >
                          Assinar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
