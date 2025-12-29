export const SERVICOS_OFICIAIS = [
  "Ar condicionado / climatizacao",
  "Balancas / calibracao",
  "CFTV / seguranca patrimonial",
  "Comunicacao visual / fachada",
  "Controle de pragas / dedetizacao",
  "Elevadores / escadas rolantes",
  "Eletrica",
  "Exaustao / ventilacao",
  "Extintores / combate a incendio",
  "Gas / GLP",
  "Gerador / nobreak",
  "Hidraulica",
  "Iluminacao",
  "Limpeza e conservacao",
  "Manutencao civil",
  "Pintura / reparos",
  "Portas automaticas / sensores",
  "Rede / TI / PDV",
  "Refrigeracao",
  "Residuos / reciclagem",
  "Sinalizacao / comunicacao interna",
];

const normalizeValue = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s/.-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const buildIndex = () => {
  const map = new Map<string, string>();
  SERVICOS_OFICIAIS.forEach((servico) => {
    map.set(normalizeValue(servico), servico);
  });
  return map;
};

const SERVICO_INDEX = buildIndex();

const levenshtein = (a: string, b: string) => {
  if (a === b) {
    return 0;
  }
  if (!a) {
    return b.length;
  }
  if (!b) {
    return a.length;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 0),
  );

  for (let i = 0; i < rows; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
};

const maxDistanceFor = (value: string) => {
  if (value.length <= 6) {
    return 1;
  }
  if (value.length <= 10) {
    return 2;
  }
  return 3;
};

export const resolveServicoOficial = (value: string) => {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return { canonical: value, matched: false };
  }

  const exact = SERVICO_INDEX.get(normalized);
  if (exact) {
    return { canonical: exact, matched: true };
  }

  let best: { servico: string; distance: number } | null = null;
  for (const [normalizedServico, servico] of SERVICO_INDEX.entries()) {
    const distance = levenshtein(normalized, normalizedServico);
    if (!best || distance < best.distance) {
      best = { servico, distance };
    }
  }

  if (!best) {
    return { canonical: value, matched: false };
  }

  const threshold = maxDistanceFor(normalized);
  if (best.distance <= threshold) {
    return { canonical: best.servico, matched: true };
  }

  return { canonical: value, matched: false };
};
