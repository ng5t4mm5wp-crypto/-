import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const raw = await readFile(new URL("../data/verses.json", import.meta.url), "utf8");
const data = JSON.parse(raw);
const meters = new Map();
const normalized = new Set();

assert.equal(data.meta.count, 1000, "يجب أن يصرّح الوصف بوجود ١٠٠٠ بيت");
assert.equal(data.verses.length, 1000, "يجب أن يحتوي المخزون على ١٠٠٠ بيت بالضبط");

for (const [index, verse] of data.verses.entries()) {
  assert.equal(verse.id, index + 1, `ترقيم غير صحيح عند البيت ${index + 1}`);
  assert.match(verse.first, /[\u0621-\u064A]/, `صدر غير عربي في البيت ${verse.id}`);
  assert.match(verse.second, /[\u0621-\u064A]/, `عجز غير عربي في البيت ${verse.id}`);
  assert.ok(verse.first.trim().length >= 8, `صدر قصير في البيت ${verse.id}`);
  assert.ok(verse.second.trim().length >= 8, `عجز قصير في البيت ${verse.id}`);
  assert.ok(verse.meter && verse.meterKey, `البحر ناقص في البيت ${verse.id}`);

  const key = `${verse.first}${verse.second}`
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[^\u0621-\u064A]/g, "");
  assert.ok(!normalized.has(key), `بيت مكرر: ${verse.id}`);
  normalized.add(key);
  meters.set(verse.meter, (meters.get(verse.meter) || 0) + 1);
}

assert.equal(meters.size, 14, "يجب تمثيل البحور الأربعة عشر");
for (const [meter, count] of meters) {
  assert.ok(count === 71 || count === 72, `توزيع غير متوازن للبحر ${meter}: ${count}`);
}

const total = [...meters.values()].reduce((sum, count) => sum + count, 0);
assert.equal(total, 1000);

console.log(`✓ ${data.verses.length} بيت مختلف`);
console.log(`✓ ${meters.size} بحرًا بواقع ٧١–٧٢ بيتًا لكل بحر`);
console.log("✓ جميع الصدور والأعجاز صالحة وغير فارغة");
