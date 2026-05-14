import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2];

if (!email) {
  console.error("Usage: node scripts/send-recovery.mjs <email>");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const redirectTo =
  process.argv[3] ||
  "https://formscentral-frbnd8hxhkhjh5hn.brazilsouth-01.azurewebsites.net/";

const { data, error } = await admin.auth.admin.generateLink({
  type: "recovery",
  email,
  options: { redirectTo },
});

if (error) {
  console.error("Erro:", error.message);
  process.exit(1);
}

console.log("OK — email de recuperação enviado para", email);
console.log("Link (válido por ~1h):", data?.properties?.action_link);
