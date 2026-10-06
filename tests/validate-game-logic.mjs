import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  chooseComputerVerse,
  chooseOpeningVerse,
  findBestMatch,
  firstArabicLetter,
  lastArabicLetter,
  normalizeArabic,
  textSimilarity
} from "../game-core.js";

const data = JSON.parse(
  await readFile(new URL("../data/verses.json", import.meta.url), "utf8")
);
const verses = data.verses;

assert.equal(normalizeArabic("أَلا يا لَيْلُ"), "الا يا ليل");
assert.equal(firstArabicLetter("إمام الصبح"), "ا");
assert.equal(lastArabicLetter("هذه قصيدة"), "ت");
assert.equal(lastArabicLetter("إلى المدى"), "ي");
assert.ok(textSimilarity("ألا يا ليل", "الا يا ليل") > 0.95);

const mutanabbiVerse = verses.find(verse =>
  verse.first === "أنا الذي نظر الأعمى إلى أدبي"
);
assert.ok(mutanabbiVerse, "بيت المتنبي المرجعي غير موجود في الديوان");
const noisySpeechResult = findBestMatch(
  "أنا اللذين غير الأعمى إلى أدبي",
  verses,
  "ا"
);
assert.equal(
  noisySpeechResult.match?.id,
  mutanabbiVerse.id,
  "لم تُصحّح زلة التعرّف الصوتي إلى بيت المتنبي"
);

for (const verse of verses) {
  assert.ok(firstArabicLetter(verse.first), `لا أول حرف للبيت ${verse.id}`);
  assert.ok(lastArabicLetter(verse.second), `لا آخر حرف للبيت ${verse.id}`);
}

const opening = chooseOpeningVerse(verses, new Set(), () => 0);
assert.ok(opening, "يجب العثور على فاتحة قابلة للمساجلة");
const required = lastArabicLetter(opening.second);
const exactReply = verses.find(
  verse => verse.id !== opening.id && firstArabicLetter(verse.first) === required
);
assert.ok(exactReply, `لا يوجد رد للحرف ${required}`);

const exactResult = findBestMatch(
  `${exactReply.first} ${exactReply.second}`,
  verses,
  required,
  new Set([opening.id])
);
assert.equal(exactResult.match?.id, exactReply.id, "فشلت مطابقة البيت الصحيح");

const usedResult = findBestMatch(
  `${exactReply.first} ${exactReply.second}`,
  verses,
  required,
  new Set([opening.id, exactReply.id])
);
assert.notEqual(usedResult.match?.id, exactReply.id, "قُبل بيت مستخدم سابقًا");

const replyLetter = lastArabicLetter(exactReply.second);
const computerReply = chooseComputerVerse(
  verses,
  replyLetter,
  new Set([opening.id, exactReply.id]),
  () => 0
);
if (computerReply) {
  assert.equal(firstArabicLetter(computerReply.first), replyLetter);
}

const transitionCount = verses.filter(verse => {
  const letter = lastArabicLetter(verse.second);
  return verses.some(candidate => candidate.id !== verse.id && firstArabicLetter(candidate.first) === letter);
}).length;
assert.ok(transitionCount > 900, `التغطية الحرفية منخفضة: ${transitionCount}`);

console.log("✓ تطبيع الحروف العربية يعمل");
console.log("✓ مطابقة البيت الصحيح ومنع التكرار يعملان");
console.log(`✓ ${transitionCount} بيتًا لها رد محتمل في الديوان`);
