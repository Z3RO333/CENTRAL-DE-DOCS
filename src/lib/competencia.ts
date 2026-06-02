export type Competencia = {
  ano: string;
  mes: string;
  label: string;
};

export function parseCompetencia(value: unknown): Competencia | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/^(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const mesNumber = Number(match[1]);
  if (!Number.isInteger(mesNumber) || mesNumber < 1 || mesNumber > 12) {
    return null;
  }

  const mes = String(mesNumber).padStart(2, "0");
  const ano = match[2];
  return {
    ano,
    mes,
    label: `${mes}/${ano}`,
  };
}

export function getCompetenciaFromDados(
  dados: Record<string, unknown> | null | undefined,
): Competencia | null {
  return parseCompetencia(dados?.competencia);
}
