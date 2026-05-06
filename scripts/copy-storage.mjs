import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const SOURCE_URL = process.env.SOURCE_URL;
const SOURCE_KEY = process.env.SOURCE_KEY;
const TARGET_URL = process.env.TARGET_URL;
const TARGET_KEY = process.env.TARGET_KEY;
const LIST_PATH = process.env.LIST_PATH ?? 'C:/formulario/tmp-migration/objects.jsonl';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);

if (!SOURCE_URL || !SOURCE_KEY || !TARGET_URL || !TARGET_KEY) {
  console.error('Missing env: SOURCE_URL, SOURCE_KEY, TARGET_URL, TARGET_KEY');
  process.exit(1);
}

const src = createClient(SOURCE_URL, SOURCE_KEY, { auth: { persistSession: false } });
const tgt = createClient(TARGET_URL, TARGET_KEY, { auth: { persistSession: false } });

const lines = readFileSync(LIST_PATH, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
const objects = lines.map(l => JSON.parse(l));
console.log(`Loaded ${objects.length} objects from ${LIST_PATH}`);

let done = 0;
let skipped = 0;
let failed = 0;
const failures = [];
const totalBytes = objects.reduce((a, o) => a + (o.size ?? 0), 0);
let copiedBytes = 0;
const startedAt = Date.now();

async function copyOne(obj) {
  const { bucket, name, mime } = obj;
  try {
    const dl = await src.storage.from(bucket).download(name);
    if (dl.error) throw new Error(`download: ${dl.error.message}`);
    const blob = dl.data;

    const up = await tgt.storage.from(bucket).upload(name, blob, {
      contentType: mime,
      upsert: true,
    });
    if (up.error) throw new Error(`upload: ${up.error.message}`);

    copiedBytes += obj.size ?? 0;
    done++;
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
  } finally {
    const total = done + failed + skipped;
    if (total % 10 === 0 || total === objects.length) {
      const pct = ((total / objects.length) * 100).toFixed(1);
      const mb = (copiedBytes / 1024 / 1024).toFixed(1);
      const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`[${pct}%] ${total}/${objects.length} | ${done} ok, ${failed} failed | ${mb}/${totalMb} MB | ${elapsed}s`);
    }
  }
}

// Simple concurrency pool
async function runPool(items, n, fn) {
  const queue = items.slice();
  const workers = Array.from({ length: n }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item) await fn(item);
    }
  });
  await Promise.all(workers);
}

await runPool(objects, CONCURRENCY, copyOne);

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
console.log('\n=== DONE ===');
console.log(`OK:      ${done}`);
console.log(`Failed:  ${failed}`);
console.log(`Skipped: ${skipped}`);
console.log(`Time:    ${elapsed}s`);

if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
