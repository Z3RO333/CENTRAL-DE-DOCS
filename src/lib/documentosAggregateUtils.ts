export type DateRange = {
  startAt: string | null;
  endAt: string | null;
};

export function resolveDateRange(
  anoFilter: string | null,
  mesFilter: string | null,
): DateRange {
  if (!anoFilter || anoFilter === "todos") {
    return { startAt: null, endAt: null };
  }

  const ano = Number(anoFilter);
  if (Number.isNaN(ano)) {
    return { startAt: null, endAt: null };
  }

  if (mesFilter && mesFilter !== "todos") {
    const mes = Number(mesFilter);
    if (!Number.isNaN(mes) && mes >= 1 && mes <= 12) {
      return {
        startAt: new Date(ano, mes - 1, 1).toISOString(),
        endAt: new Date(ano, mes, 1).toISOString(),
      };
    }
    return { startAt: null, endAt: null };
  }

  return {
    startAt: new Date(ano, 0, 1).toISOString(),
    endAt: new Date(ano + 1, 0, 1).toISOString(),
  };
}

export function toNullableArray<T>(values: T[]): T[] | null {
  return values.length > 0 ? values : null;
}
