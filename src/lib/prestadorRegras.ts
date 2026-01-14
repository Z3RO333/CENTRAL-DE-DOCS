export type RegraPeriodo = "mensal" | "anual";
export type RegraTipo = "formulario" | "tipo_servico";

export type PrestadorRegra = {
  id: string;
  prestador_id: string;
  tipo_regra: RegraTipo;
  alvo: string;
  periodo: RegraPeriodo;
  quantidade: number;
  label?: string | null;
  aplica_anteriores?: boolean;
  aplica_desde?: string | null;
  modo_conflito?: "multi" | "single";
  ativo?: boolean;
  created_at?: string;
};

export const isInPeriodo = (
  dateValue: string,
  periodo: RegraPeriodo,
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
