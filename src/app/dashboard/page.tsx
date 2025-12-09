"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  BriefcaseBusiness,
  Building2,
  FileBadge,
  ReceiptText,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDocumentsAccess } from "@/hooks/useDocumentsAccess";
import { usePrestadores } from "@/hooks/usePrestadores";

type DashboardCard = {
  slug: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
  border: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading, error: authError } = useAuth();
  const { modules: modulesAccess } = useDocumentsAccess();
  const canManagePrestadores = modulesAccess.documentos;
  const {
    prestadores,
    loading: prestadoresLoading,
    error: prestadoresError,
    createPrestador,
  } = usePrestadores({ enabled: canManagePrestadores });
  const [prestadorForm, setPrestadorForm] = useState({
    nome: "",
    tipoServico: "",
    cnpj: "",
    usuarios: "",
  });
  const [prestadorFeedback, setPrestadorFeedback] = useState<{
    error: string | null;
    success: string | null;
  }>({ error: null, success: null });
  const [creatingPrestador, setCreatingPrestador] = useState(false);
  const [selectedPrestadorId, setSelectedPrestadorId] = useState<string>("");

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (
      prestadores.length > 0 &&
      !prestadores.find((item) => item.id === selectedPrestadorId)
    ) {
      setSelectedPrestadorId(prestadores[0].id);
    }
  }, [prestadores, selectedPrestadorId]);

  const selectedPrestador =
    prestadores.find((item) => item.id === selectedPrestadorId) ?? null;

  if (isLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        {authError ?? "Carregando formularios..."}
      </div>
    );
  }

  const baseCards: DashboardCard[] = useMemo(
    () => [
      {
        slug: "retencao-trabalhista",
        title: "Retencao Trabalhista",
        description:
          "Envio de documentos relacionados a retencao de tributos trabalhistas.",
        href: "/formulario/retencao-trabalhista",
        icon: BriefcaseBusiness,
        accent: "from-sky-100 via-sky-50 to-transparent",
        border: "border-sky-200",
      },
      {
        slug: "registro-laudos",
        title: "Registro e Laudos",
        description: "Formularios para registros tecnicos e laudos emitidos.",
        href: "/formulario/registro-laudos",
        icon: FileBadge,
        accent: "from-sky-100 via-sky-50 to-transparent",
        border: "border-sky-200",
      },
      {
        slug: "notas-fiscais",
        title: "Notas Fiscais",
        description: "Upload e controle de notas fiscais emitidas.",
        href: "/formulario/notas-fiscais",
        icon: ReceiptText,
        accent: "from-sky-100 via-sky-50 to-transparent",
        border: "border-sky-200",
      },
    ],
    [],
  );

  const handlePrestadorFieldChange = (
    field: keyof typeof prestadorForm,
    value: string,
  ) => {
    setPrestadorForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    setPrestadorFeedback({ error: null, success: null });
  };

  const handlePrestadorSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPrestadorFeedback({ error: null, success: null });

    if (!prestadorForm.nome.trim()) {
      setPrestadorFeedback({
        error: "Informe o nome do prestador.",
        success: null,
      });
      return;
    }
    if (!prestadorForm.tipoServico.trim()) {
      setPrestadorFeedback({
        error: "Informe o tipo de serviço.",
        success: null,
      });
      return;
    }
    if (!prestadorForm.cnpj.trim()) {
      setPrestadorFeedback({
        error: "Informe o CNPJ do prestador.",
        success: null,
      });
      return;
    }
    const usuariosList = prestadorForm.usuarios
      .split(/[,;\n]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    if (usuariosList.length === 0) {
      setPrestadorFeedback({
        error:
          "Informe pelo menos um e-mail de usuário autorizado, separados por vírgula.",
        success: null,
      });
      return;
    }

    setCreatingPrestador(true);
    try {
      const created = await createPrestador({
        nome: prestadorForm.nome.trim(),
        tipo_servico: prestadorForm.tipoServico.trim(),
        cnpj: prestadorForm.cnpj.trim(),
        usuarios: usuariosList,
      });
      setPrestadorFeedback({
        error: null,
        success: created
          ? `Prestador ${created.nome} cadastrado com sucesso!`
          : "Prestador cadastrado.",
      });
      setPrestadorForm({
        nome: "",
        tipoServico: "",
        cnpj: "",
        usuarios: "",
      });
      if (created) {
        setSelectedPrestadorId(created.id);
      }
    } catch (err) {
      setPrestadorFeedback({
        error:
          err instanceof Error
            ? err.message
            : "Não foi possível cadastrar o prestador.",
        success: null,
      });
    } finally {
      setCreatingPrestador(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Formularios
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Escolha um tipo de formulario para iniciar o envio de documentos.
          </p>
        </div>
        <Link
          href="/documentos"
          className="inline-flex items-center rounded-full border border-sky-500/70 bg-sky-50 px-4 py-1.5 text-xs font-medium text-sky-700 shadow-sm shadow-sky-200/80 transition hover:bg-sky-100"
        >
          Ver documentos enviados
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {baseCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group relative overflow-hidden rounded-3xl bg-white p-6 shadow-md shadow-slate-200 transition hover:-translate-y-1 hover:shadow-lg"
          >
            <div
              className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${card.accent} opacity-80 blur-2xl`}
            />
            <div className="relative flex h-full flex-col gap-3">
              <div className="flex items-center gap-2">
                <card.icon className="h-6 w-6 text-slate-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  {card.title}
                </h2>
              </div>
              <p className="flex-1 text-sm text-slate-500">
                {card.description}
              </p>
              <span className="mt-1 inline-flex items-center text-sm font-semibold text-emerald-700">
                Abrir formulario
                <span className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[11px] text-emerald-700">
                  &gt;
                </span>
              </span>
            </div>
          </Link>
        ))}
      </div>

      {canManagePrestadores && (
        <section className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-sm shadow-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Building2 className="h-4 w-4 text-slate-600" />
                Cadastro de prestadores
              </p>
              <p className="text-[11px] text-slate-500">
                Administre quais prestadores e usuários podem enviar laudos.
              </p>
            </div>
            <span className="text-[11px] font-semibold text-slate-500">
              Visível apenas para administradores
            </span>
          </div>

          {(prestadorFeedback.error ||
            prestadorFeedback.success ||
            prestadoresError) && (
            <div
              className={`mt-4 rounded-2xl border px-4 py-3 text-xs ${
                prestadorFeedback.error || prestadoresError
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              {prestadorFeedback.error ||
                prestadoresError ||
                prestadorFeedback.success}
            </div>
          )}

          <div className="mt-4 grid gap-6 lg:grid-cols-[3fr_2fr]">
            <form
              onSubmit={handlePrestadorSubmit}
              className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4"
            >
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <UserPlus className="h-4 w-4 text-slate-600" />
                Novo prestador
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">
                  Nome do prestador
                  <input
                    type="text"
                    value={prestadorForm.nome}
                    onChange={(event) =>
                      handlePrestadorFieldChange("nome", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: Laboratório XPTO"
                    required
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Tipo de serviço
                  <input
                    type="text"
                    value={prestadorForm.tipoServico}
                    onChange={(event) =>
                      handlePrestadorFieldChange(
                        "tipoServico",
                        event.target.value,
                      )
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Ex.: Laudos técnicos"
                    required
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  CNPJ do prestador
                  <input
                    type="text"
                    value={prestadorForm.cnpj}
                    onChange={(event) =>
                      handlePrestadorFieldChange("cnpj", event.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="00.000.000/0000-00"
                    required
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Usuários autorizados
                  <textarea
                    value={prestadorForm.usuarios}
                    onChange={(event) =>
                      handlePrestadorFieldChange("usuarios", event.target.value)
                    }
                    className="mt-1 min-h-[90px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    placeholder="Informe os e-mails separados por vírgula"
                  />
                  <span className="text-[11px] text-slate-500">
                    Digite os e-mails de quem poderá usar esse prestador no
                    formulário.
                  </span>
                </label>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={creatingPrestador}
                  className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-sky-200 transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {creatingPrestador ? "Salvando..." : "Cadastrar prestador"}
                </button>
              </div>
            </form>

            <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Lista de prestadores
              </p>
              {prestadoresLoading ? (
                <p className="mt-3 text-xs text-slate-500">
                  Carregando prestadores...
                </p>
              ) : prestadores.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  Nenhum prestador cadastrado ainda.
                </p>
              ) : (
                <>
                  <label className="mt-3 block text-xs font-semibold text-slate-600">
                    Selecionar prestador
                    <select
                      value={selectedPrestadorId}
                      onChange={(event) =>
                        setSelectedPrestadorId(event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    >
                      {prestadores.map((prestador) => (
                        <option key={prestador.id} value={prestador.id}>
                          {prestador.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedPrestador && (
                    <div className="mt-4 space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-xs text-slate-600">
                      <p>
                        <span className="font-semibold text-slate-700">
                          Tipo de serviço:
                        </span>{" "}
                        {selectedPrestador.tipo_servico}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-700">
                          CNPJ:
                        </span>{" "}
                        {selectedPrestador.cnpj}
                      </p>
                      <div>
                        <span className="font-semibold text-slate-700">
                          Usuários vinculados:
                        </span>
                        <ul className="mt-1 list-disc pl-4 text-[11px]">
                          {selectedPrestador.usuarios.map((usuario) => (
                            <li key={usuario} className="text-slate-600">
                              {usuario}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
