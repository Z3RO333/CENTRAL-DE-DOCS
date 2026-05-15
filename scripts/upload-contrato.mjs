import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const FILE_PATH =
  "C:/Users/21664/Downloads/Contrato - Ar Puro MXP Usina de Incinera├º├úo de Residuos - Clicksign.pdf";
const USER_ID = "e06b9559-22d7-4dfe-9a9c-a917f1391cd1"; // gustavoandrade@bemol.com.br
const PRESTADOR = "Ar Puro MXP";
const OBJETO = "Usina de Incineração de Resíduos";

const LOJAS = [
  { id: "a101365c-1f26-4973-bc08-eeeaafece09e", nome: "PORTO VELHO CENTRO" },
  { id: "5ca1ede6-a686-4b52-8e1c-a327994c4e38", nome: "SHOPPING PORTO VELHO" },
  { id: "e5012326-2481-46a7-a2c6-fd8c797cdff6", nome: "JATUARANA" },
  { id: "c88089f9-30c0-41b9-ba93-850dd20b8481", nome: "RIO BRANCO" },
];

// 1. Upload file once, reuse path for all lojas
const fileBuffer = readFileSync(FILE_PATH);
const storagePath = `contratos/2026/${randomUUID()}_Ar-Puro-MXP-Usina-Incineracao.pdf`;

console.log("Uploading file to storage...");
const { error: uploadError } = await admin.storage
  .from("formularios")
  .upload(storagePath, fileBuffer, {
    contentType: "application/pdf",
    upsert: false,
  });

if (uploadError) {
  console.error("Upload error:", uploadError.message);
  process.exit(1);
}
console.log("File uploaded:", storagePath);

// 2. Create one record per loja
for (const loja of LOJAS) {
  const { data, error } = await admin.from("formularios").insert({
    user_id: USER_ID,
    tipo: "contratos",
    status: "em_analise",
    arquivo_path: storagePath,
    dados: {
      prestador: PRESTADOR,
      objeto: OBJETO,
      loja_id: loja.id,
      observacoes: `Contrato válido para: Porto Velho Centro, Shopping Porto Velho, Jatuarana, Rio Branco`,
    },
  }).select("id").single();

  if (error) {
    console.error(`Erro ao criar registro para ${loja.nome}:`, error.message);
  } else {
    console.log(`OK — ${loja.nome}: ${data.id}`);
  }
}

console.log("\nConcluído.");
