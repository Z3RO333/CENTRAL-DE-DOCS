import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const TARGET_URL = process.env.TARGET_URL;
const TARGET_KEY = process.env.TARGET_KEY;
const LIST_PATH = process.env.LIST_PATH ?? 'C:/formulario/tmp-migration/objects.jsonl';
const SAMPLE_SIZE = Number(process.env.SAMPLE_SIZE ?? 10);

const tgt = createClient(TARGET_URL, TARGET_KEY, { auth: { persistSession: false } });
const objects = readFileSync(LIST_PATH, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));

// Pick random sample
const shuffled = [...objects].sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);
console.log(`Sampling ${shuffled.length}/${objects.length} files...\n`);

let ok = 0, mismatch = 0, missing = 0;
for (const obj of shuffled) {
  const dl = await tgt.storage.from(obj.bucket).download(obj.name);
  if (dl.error) {
    missing++;
    console.log(`MISSING: ${obj.name} (${dl.error.message})`);
    continue;
  }
  const actualSize = dl.data.size;
  if (actualSize !== obj.size) {
    mismatch++;
    console.log(`SIZE MISMATCH: ${obj.name} expected=${obj.size} actual=${actualSize}`);
  } else {
    ok++;
    console.log(`OK ${obj.size}b ${obj.name}`);
  }
}

console.log(`\n=== ${ok} ok / ${mismatch} mismatch / ${missing} missing (of ${shuffled.length}) ===`);
process.exit(mismatch + missing > 0 ? 1 : 0);
