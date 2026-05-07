// Heurística para extrair "Nome Sobrenome" de um e-mail quando o usuário não
// tem metadata.name. Os primeiros nomes mais comuns no Brasil são tentados como
// prefixo do handle; se houver casamento, separa em duas partes. Caso contrário,
// só capitaliza o que veio.

const COMMON_BR_FIRST_NAMES = [
  "ana",
  "andre",
  "antonio",
  "andrea",
  "adriana",
  "adriano",
  "alessandra",
  "alexandre",
  "alex",
  "amanda",
  "aline",
  "beatriz",
  "bianca",
  "bruna",
  "bruno",
  "camila",
  "carla",
  "carlos",
  "caroline",
  "cristiano",
  "cristina",
  "daniel",
  "daniela",
  "danilo",
  "diego",
  "eduardo",
  "elaine",
  "eric",
  "erick",
  "fabio",
  "felipe",
  "fernanda",
  "fernando",
  "flavia",
  "flavio",
  "gabriel",
  "gabriela",
  "geovana",
  "guilherme",
  "gustavo",
  "henrique",
  "hugo",
  "isabela",
  "isabella",
  "jessica",
  "joao",
  "jose",
  "juliana",
  "juliano",
  "julio",
  "karina",
  "larissa",
  "leandro",
  "leonardo",
  "leticia",
  "lucas",
  "luciana",
  "luciano",
  "luis",
  "luiz",
  "luana",
  "marcela",
  "marcelo",
  "marcio",
  "marcos",
  "maria",
  "mariana",
  "mateus",
  "matheus",
  "mauricio",
  "michele",
  "miguel",
  "natalia",
  "patricia",
  "paulo",
  "pedro",
  "rafael",
  "rafaela",
  "raquel",
  "renato",
  "renata",
  "ricardo",
  "roberta",
  "roberto",
  "rodrigo",
  "sandra",
  "sergio",
  "tatiana",
  "thais",
  "thiago",
  "tiago",
  "vanessa",
  "victor",
  "vinicius",
  "vitor",
  "vitoria",
];

const NAME_SET = new Set(COMMON_BR_FIRST_NAMES.sort((a, b) => b.length - a.length));

const stripDiacritics = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "");

const capitalize = (value: string) =>
  value.length === 0 ? value : value[0].toUpperCase() + value.slice(1).toLowerCase();

const splitByDelimiters = (handle: string) =>
  handle
    .split(/[._\-+0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const tryHeuristicSplit = (single: string): string[] => {
  const lowered = stripDiacritics(single.toLowerCase());
  if (lowered.length < 5) return [single];
  for (const candidate of NAME_SET) {
    if (lowered.startsWith(candidate) && lowered.length > candidate.length + 1) {
      return [
        single.slice(0, candidate.length),
        single.slice(candidate.length),
      ];
    }
  }
  return [single];
};

export function formatPersonName(input: {
  name?: string | null;
  fullName?: string | null;
  email?: string | null;
}): string {
  const explicit = input.name?.trim() || input.fullName?.trim();
  if (explicit) {
    return explicit
      .split(/\s+/)
      .map(capitalize)
      .join(" ");
  }

  const handle = input.email?.split("@")[0]?.trim();
  if (!handle) return "";

  let parts = splitByDelimiters(handle);
  if (parts.length === 1) {
    parts = tryHeuristicSplit(parts[0]);
  }

  return parts.map(capitalize).join(" ");
}

export function formatFirstName(input: {
  name?: string | null;
  fullName?: string | null;
  email?: string | null;
}): string {
  const full = formatPersonName(input);
  return full.split(" ")[0] ?? "";
}
