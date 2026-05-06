const WINDOWS_1252_CODEPOINT_TO_BYTE = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

const SUSPECT_MOJIBAKE_PATTERN =
  /(?:Ã[\u0080-\u00bf\u0192\u201a-\u201e\u2020-\u2022]|Â[\u0080-\u00bf]|â[\u0080-\u00bf\u0192\u201a-\u201e\u2020-\u2022])/;

const SUSPECT_MOJIBAKE_PATTERN_GLOBAL =
  /(?:Ã[\u0080-\u00bf\u0192\u201a-\u201e\u2020-\u2022]|Â[\u0080-\u00bf]|â[\u0080-\u00bf\u0192\u201a-\u201e\u2020-\u2022])/g;

const countMatches = (value: string, pattern: RegExp) =>
  value.match(pattern)?.length ?? 0;

const scoreTextEncoding = (value: string) =>
  countMatches(value, SUSPECT_MOJIBAKE_PATTERN_GLOBAL) * 20 +
  countMatches(value, /\uFFFD/g) * 50 +
  countMatches(value, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) * 30;

const encodeWindows1252 = (value: string) => {
  const bytes: number[] = [];
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }
    bytes.push(WINDOWS_1252_CODEPOINT_TO_BYTE.get(codePoint) ?? 0x3f);
  }
  return Uint8Array.from(bytes);
};

const decodeWindows1252MojibakeOnce = (value: string) =>
  new TextDecoder("utf-8", { fatal: false }).decode(encodeWindows1252(value));

export const fixMojibakeText = (value: string) => {
  if (!SUSPECT_MOJIBAKE_PATTERN.test(value)) {
    return value;
  }

  let current = value;
  let currentScore = scoreTextEncoding(current);

  for (let index = 0; index < 3 && currentScore > 0; index += 1) {
    const decoded = decodeWindows1252MojibakeOnce(current);
    const decodedScore = scoreTextEncoding(decoded);
    if (decodedScore >= currentScore) {
      break;
    }
    current = decoded;
    currentScore = decodedScore;
  }

  return current;
};

export const normalizeDisplayData = (value: unknown): unknown => {
  if (typeof value === "string") {
    return fixMojibakeText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeDisplayData(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeDisplayData(item)]),
  );
};
