import { ApiHttpError, type GerenteAccessRow } from "@/lib/apiAuth";
import { sanitizeId } from "@/lib/documentosApiUtils";

type BuildAccessOrInput = {
  canAccess: boolean;
  allowedPrestadores: string[];
  gerenteEntries: GerenteAccessRow[];
  userId: string;
  filterUserId?: string | null;
  filterPrestadores: string[];
  filterLojas: string[];
};

// Cláusula que nunca casa → resultado vazio (sem vazar dados, sem 403 na tela).
const NO_MATCH = "id.eq.00000000-0000-0000-0000-000000000000";

export function buildDocumentosAccessOr(
  input: BuildAccessOrInput,
): string[] {
  const {
    canAccess,
    allowedPrestadores,
    gerenteEntries,
    userId,
    filterUserId,
    filterPrestadores,
    filterLojas,
  } = input;

  if (canAccess) {
    return [];
  }

  const hasPrestadorAccess = allowedPrestadores.length > 0;
  const hasGerenteAccess = gerenteEntries.length > 0;
  const isSelfFilter = Boolean(filterUserId && filterUserId === userId);

  if (!hasPrestadorAccess && !hasGerenteAccess && !isSelfFilter) {
    throw new ApiHttpError(
      403,
      "Voce nao possui permissao para acessar esses documentos.",
    );
  }

  const accessOr: string[] = [];

  if (hasPrestadorAccess) {
    const allowedPrestadorSet = new Set(allowedPrestadores);
    const prestadoresPermitidos =
      filterPrestadores.length > 0
        ? filterPrestadores.filter((id) => allowedPrestadorSet.has(id))
        : allowedPrestadores;

    if (filterPrestadores.length > 0 && prestadoresPermitidos.length === 0) {
      // Filtro aponta para prestador fora do escopo → lista vazia (não bloqueia a tela)
      return [NO_MATCH];
    }

    if (prestadoresPermitidos.length === 1) {
      accessOr.push(`prestador_id.eq.${prestadoresPermitidos[0]}`);
    } else if (prestadoresPermitidos.length > 1) {
      accessOr.push(`prestador_id.in.(${prestadoresPermitidos.join(",")})`);
    }
  }

  if (hasGerenteAccess) {
    const lojasAll = new Set<string>();
    const lojasLimited = new Map<string, Set<string>>();

    gerenteEntries.forEach((entry) => {
      const lojaId = entry.loja_id ? sanitizeId(entry.loja_id) : "";
      if (!lojaId) {
        return;
      }
      if (entry.can_view_all) {
        lojasAll.add(lojaId);
        lojasLimited.delete(lojaId);
        return;
      }
      if (!entry.prestador_id) {
        return;
      }
      if (lojasAll.has(lojaId)) {
        return;
      }
      const set = lojasLimited.get(lojaId) ?? new Set<string>();
      set.add(sanitizeId(entry.prestador_id));
      lojasLimited.set(lojaId, set);
    });

    const filterLojaSet = new Set(filterLojas);
    const filterPrestadorSet = new Set(filterPrestadores);

    const lojasAllList =
      filterLojas.length > 0
        ? Array.from(lojasAll).filter((id) => filterLojaSet.has(id))
        : Array.from(lojasAll);

    const lojasLimitedList =
      filterLojas.length > 0
        ? Array.from(lojasLimited.keys()).filter((id) => filterLojaSet.has(id))
        : Array.from(lojasLimited.keys());

    if (
      filterLojas.length > 0 &&
      lojasAllList.length === 0 &&
      lojasLimitedList.length === 0
    ) {
      return [NO_MATCH];
    }

    const buildCondition = (lojaId: string, prestadores?: string[]) => {
      if (prestadores && prestadores.length > 0) {
        if (prestadores.length === 1) {
          return `and(dados->>loja_id.eq.${lojaId},prestador_id.eq.${prestadores[0]})`;
        }
        return `and(dados->>loja_id.eq.${lojaId},prestador_id.in.(${prestadores.join(",")}))`;
      }
      return `dados->>loja_id.eq.${lojaId}`;
    };

    lojasAllList.forEach((lojaId) => {
      if (filterPrestadores.length > 0) {
        accessOr.push(buildCondition(lojaId, filterPrestadores));
      } else {
        accessOr.push(buildCondition(lojaId));
      }
    });

    lojasLimitedList.forEach((lojaId) => {
      const allowedByLoja = Array.from(lojasLimited.get(lojaId) ?? []);
      const filteredAllowed =
        filterPrestadores.length > 0
          ? allowedByLoja.filter((id) => filterPrestadorSet.has(id))
          : allowedByLoja;
      if (filteredAllowed.length > 0) {
        accessOr.push(buildCondition(lojaId, filteredAllowed));
      }
    });

    if (filterPrestadores.length > 0 && accessOr.length === 0) {
      return [NO_MATCH];
    }
  }

  if (isSelfFilter) {
    accessOr.push(`user_id.eq.${userId}`);
  }

  if (accessOr.length === 0) {
    // Sem cláusula aplicável (ex: gerente sem loja casável) → lista vazia
    return [NO_MATCH];
  }

  return accessOr;
}
