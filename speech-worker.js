import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriberPromise = null;

function reportProgress(update) {
  if (update?.status !== "progress") return;
  self.postMessage({
    type: "progress",
    progress: Number(update.progress) || 0,
    file: update.file || ""
  });
}

async function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny",
      {
        quantized: true,
        progress_callback: reportProgress
      }
    );
  }
  return transcriberPromise;
}

async function loadModel() {
  try {
    await getTranscriber();
    self.postMessage({ type: "ready" });
  } catch (error) {
    transcriberPromise = null;
    self.postMessage({ type: "error", error: String(error?.message || error) });
  }
}

async function transcribe(message) {
  try {
    const transcriber = await getTranscriber();
    const output = await transcriber(message.audio, {
      language: "arabic",
      task: "transcribe",
      top_k: 0,
      do_sample: false,
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false
    });
    self.postMessage({
      type: "result",
      requestId: message.requestId,
      sessionId: message.sessionId,
      final: Boolean(message.final),
      text: String(output?.text || "").trim()
    });
  } catch (error) {
    self.postMessage({ type: "error", error: String(error?.message || error) });
  }
}

self.addEventListener("message", event => {
  const message = event.data || {};
  if (message.type === "load") {
    loadModel();
  } else if (message.type === "transcribe") {
    transcribe(message);
  }
});
