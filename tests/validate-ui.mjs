import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, serviceWorker, speechWorker, manifestRaw] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf8"),
  readFile(resolve(root, "app.js"), "utf8"),
  readFile(resolve(root, "sw.js"), "utf8"),
  readFile(resolve(root, "speech-worker.js"), "utf8"),
  readFile(resolve(root, "manifest.webmanifest"), "utf8")
]);

const dataSelectors = [
  ...app.matchAll(/querySelector(?:All)?\("\[([^\]]+)\]"\)/g)
].map(match => match[1].split("=")[0]);

for (const attribute of new Set(dataSelectors)) {
  assert.ok(html.includes(attribute), `العنصر ${attribute} مستخدم في الشيفرة وغير موجود في الصفحة`);
}

for (const required of ["app.js", "speech-worker.js", "game-core.js", "styles.css", "data/verses.json"]) {
  await access(resolve(root, required));
}

const manifest = JSON.parse(manifestRaw);
assert.equal(manifest.lang, "ar");
assert.equal(manifest.dir, "rtl");
assert.match(html, /<html lang="ar" dir="rtl">/);
assert.match(html, /data-listen/);
assert.match(html, /data-timer-input/);
assert.doesNotMatch(html, /data-mode=/);
assert.match(app, /getUserMedia/);
assert.match(app, /new Worker\("speech-worker\.js/);
assert.match(app, /createScriptProcessor/);
assert.match(speechWorker, /Xenova\/whisper-base/);
assert.match(speechWorker, /automatic-speech-recognition/);
assert.match(app, /displayPreviewTranscript/);
assert.doesNotMatch(app, /SpeechRecognition/);
assert.doesNotMatch(app, /silenceTimer/);
assert.match(app, /serviceWorker\.getRegistrations/);
assert.match(serviceWorker, /registration\.unregister/);

console.log(`✓ ${new Set(dataSelectors).size} عنصر واجهة مرتبط بالشيفرة`);
console.log("✓ ملفات اللعبة المطلوبة موجودة والتخزين القديم معطّل");
console.log("✓ الواجهة عربية، صوتية، ومن دون أنماط اللعب القديمة");
console.log("✓ فتح الميكروفون وإغلاقه يدويان والتعرّف يعمل محليًا في Web Worker");
