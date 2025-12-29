export type MetaPeriodo = "mensal" | "anual";

export type PrestadorBase = {
  id: string;
  nome: string;
  tipo_servico: string;
};

export type PrestadorMeta = {
  periodo: MetaPeriodo;
  quantidade: number;
  label: string;
};

type PrestadorMetaConfig = PrestadorMeta & {
  match: {
    prestadorId?: string;
    prestadorNome?: string;
    tipoServico?: string;
  };
};

const PRESTADOR_METAS: PrestadorMetaConfig[] = [
  {
    match: { prestadorNome: "Prestem" },
    periodo: "mensal",
    quantidade: 12,
    label: "Refrigeracao das lojas",
  },
];

const DEFAULT_META: PrestadorMeta = {
  periodo: "mensal",
  quantidade: 12,
  label: "Documentos",
};

export const resolvePrestadorMeta = (prestador: PrestadorBase): PrestadorMeta => {
  const byId = PRESTADOR_METAS.find(
    (meta) => meta.match.prestadorId === prestador.id,
  );
  if (byId) {
    return byId;
  }
  const byName = PRESTADOR_METAS.find(
    (meta) => meta.match.prestadorNome === prestador.nome,
  );
  if (byName) {
    return byName;
  }
  const byTipoServico = PRESTADOR_METAS.find(
    (meta) => meta.match.tipoServico === prestador.tipo_servico,
  );
  if (byTipoServico) {
    return byTipoServico;
  }
  return {
    ...DEFAULT_META,
    label: prestador.tipo_servico || DEFAULT_META.label,
  };
};

export const isInPeriodo = (
  dateValue: string,
  periodo: MetaPeriodo,
  reference: Date,
) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  if (periodo === "mensal") {
    return (
      date.getFullYear() === reference.getFullYear() &&
      date.getMonth() === reference.getMonth()
    );
  }

  return date.getFullYear() === reference.getFullYear();
};
