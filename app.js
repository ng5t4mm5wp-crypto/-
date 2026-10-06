import {
  chooseComputerVerse,
  chooseOpeningVerse,
  findBestMatch,
  lastArabicLetter
} from "./game-core.js?v=7";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const LOCAL_SPEECH_SUPPORTED = Boolean(
  navigator.mediaDevices?.getUserMedia && AudioContextClass && window.Worker
);
const SPEECH_SAMPLE_RATE = 16000;
const SPEECH_PREVIEW_INTERVAL = 6000;

const elements = {
  screens: [...document.querySelectorAll("[data-screen]")],
  homeButtons: [...document.querySelectorAll("[data-go-home]")],
  aboutButtons: [...document.querySelectorAll("[data-open-about]")],
  aboutDialog: document.querySelector("[data-about-dialog]"),
  closeAbout: document.querySelector("[data-close-about]"),
  start: document.querySelector("[data-start]"),
  replay: document.querySelector("[data-replay]"),
  quit: document.querySelector("[data-quit]"),
  endDuel: document.querySelector("[data-end-duel]"),
  timerInput: document.querySelector("[data-timer-input]"),
  timerOutput: document.querySelector("[data-timer-output]"),
  durationButtons: [...document.querySelectorAll("[data-duration]")],
  voiceReadiness: document.querySelector("[data-voice-readiness]"),
  bestChains: [...document.querySelectorAll("[data-best-chain]")],
  chain: document.querySelector("[data-chain]"),
  score: document.querySelector("[data-score]"),
  timerControl: document.querySelector("[data-timer-control]"),
  timerTrack: document.querySelector("[data-timer-track]"),
  timerBar: document.querySelector("[data-timer-bar]"),
  time: document.querySelector("[data-time]"),
  timeMinus: document.querySelector("[data-time-minus]"),
  timePlus: document.querySelector("[data-time-plus]"),
  pause: document.querySelector("[data-pause]"),
  roundLabel: document.querySelector("[data-round-label]"),
  narratorFirst: document.querySelector("[data-narrator-first]"),
  narratorSecond: document.querySelector("[data-narrator-second]"),
  requiredLetter: document.querySelector("[data-required-letter]"),
  turnPrompt: document.querySelector("[data-turn-prompt]"),
  transcriptBox: document.querySelector("[data-transcript-box]"),
  transcript: document.querySelector("[data-transcript]"),
  listen: document.querySelector("[data-listen]"),
  listenLabel: document.querySelector("[data-listen-label]"),
  voiceHelp: document.querySelector("[data-voice-help]"),
  modelProgress: document.querySelector("[data-model-progress]"),
  manualEntry: document.querySelector(".manual-entry"),
  manualInput: document.querySelector("[data-manual-input]"),
  checkText: document.querySelector("[data-check-text]"),
  feedback: document.querySelector("[data-feedback]"),
  feedbackIcon: document.querySelector("[data-feedback-icon]"),
  feedbackTitle: document.querySelector("[data-feedback-title]"),
  feedbackText: document.querySelector("[data-feedback-text]"),
  finalScore: document.querySelector("[data-final-score]"),
  finalChain: document.querySelector("[data-final-chain]"),
  finalRounds: document.querySelector("[data-final-rounds]"),
  finalBest: document.querySelector("[data-final-best]"),
  resultGrade: document.querySelector("[data-result-grade]"),
  resultTitle: document.querySelector("[data-result-title]"),
  resultMessage: document.querySelector("[data-result-message]"),
  toast: document.querySelector("[data-toast]")
};

const state = {
  verses: [],
  selectedDuration: 30,
  turnTotalMs: 30000,
  remainingMs: 30000,
  deadline: 0,
  timerId: null,
  paused: false,
  listening: false,
  speechWorker: null,
  speechModelState: "idle",
  speechBusy: false,
  speechRequestId: 0,
  speechSessionId: 0,
  speechPreviewTimer: null,
  activeSpeechRequest: null,
  pendingFinalAudio: null,
  microphoneStream: null,
  audioContext: null,
  audioSource: null,
  audioProcessor: null,
  audioSink: null,
  audioChunks: [],
  audioSampleRate: SPEECH_SAMPLE_RATE,
  lastPreviewSamples: 0,
  usedIds: new Set(),
  narrator: null,
  requiredLetter: "",
  chain: 0,
  score: 0,
  rounds: 0,
  inTransition: false,
  duelActive: false
};

function toArabicNumber(value) {
  return String(Math.max(0, Math.round(value))).replace(/\d/g, digit => ARABIC_DIGITS[digit]);
}

function getBestChain() {
  try {
    return Number(localStorage.getItem("sajil-best-chain")) || 0;
  } catch {
    return 0;
  }
}

function saveBestChain(value) {
  const best = Math.max(value, getBestChain());
  try {
    localStorage.setItem("sajil-best-chain", String(best));
  } catch {
    // The duel works without persistent storage.
  }
  elements.bestChains.forEach(element => {
    element.textContent = toArabicNumber(best);
  });
  return best;
}

function showScreen(name) {
  elements.screens.forEach(screen => {
    const active = screen.dataset.screen === name;
    screen.classList.toggle("is-active", active);
    screen.setAttribute("aria-hidden", String(!active));
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2300);
}

function setDuration(seconds) {
  state.selectedDuration = seconds;
  const unlimited = seconds === 0;
  elements.timerInput.disabled = unlimited;
  if (!unlimited) elements.timerInput.value = String(seconds);
  elements.timerOutput.textContent = unlimited ? "بلا مؤقّت" : `${toArabicNumber(seconds)} ثانية`;
  elements.durationButtons.forEach(button => {
    button.classList.toggle("is-selected", Number(button.dataset.duration) === seconds);
  });
}

function stopTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
  if (state.deadline) {
    state.remainingMs = Math.max(0, state.deadline - performance.now());
    state.deadline = 0;
  }
}

function updateTimerDisplay() {
  if (state.selectedDuration === 0) {
    elements.time.textContent = "∞";
    elements.timerBar.style.width = "100%";
    elements.timerBar.classList.remove("is-urgent");
    return;
  }
  const seconds = Math.ceil(state.remainingMs / 1000);
  const percentage = Math.max(0, Math.min(100, state.remainingMs / state.turnTotalMs * 100));
  elements.time.textContent = toArabicNumber(seconds);
  elements.timerBar.style.width = `${percentage}%`;
  elements.timerBar.classList.toggle("is-urgent", seconds <= 5);
}

function resumeTimer() {
  if (state.selectedDuration === 0 || state.paused || !state.duelActive || state.inTransition) return;
  stopTimer();
  state.deadline = performance.now() + state.remainingMs;
  state.timerId = window.setInterval(() => {
    state.remainingMs = Math.max(0, state.deadline - performance.now());
    updateTimerDisplay();
    if (state.remainingMs <= 0) {
      stopTimer();
      finishDuel("timeout");
    }
  }, 100);
}

function resetTurnTimer() {
  stopTimer();
  state.paused = false;
  state.turnTotalMs = state.selectedDuration * 1000;
  state.remainingMs = state.turnTotalMs;
  elements.timerControl.classList.toggle("is-unlimited", state.selectedDuration === 0);
  elements.timerTrack.classList.toggle("is-hidden", state.selectedDuration === 0);
  elements.pause.disabled = state.selectedDuration === 0;
  elements.pause.textContent = "إيقاف";
  updateTimerDisplay();
  resumeTimer();
}

function adjustTurnTime(seconds) {
  if (state.selectedDuration === 0 || state.inTransition) return;
  stopTimer();
  state.remainingMs = Math.max(5000, Math.min(120000, state.remainingMs + seconds * 1000));
  state.turnTotalMs = Math.max(state.remainingMs, Math.min(120000, state.turnTotalMs + seconds * 1000));
  updateTimerDisplay();
  resumeTimer();
}

function togglePause() {
  if (state.selectedDuration === 0 || state.inTransition) return;
  if (!state.paused) {
    stopTimer();
    stopRecognition(true);
    state.paused = true;
    elements.pause.textContent = "استئناف";
    elements.turnPrompt.textContent = "المجلس متوقّف مؤقتًا";
    elements.listen.disabled = true;
  } else {
    state.paused = false;
    elements.pause.textContent = "إيقاف";
    elements.turnPrompt.textContent = "أنشد بيتك بصوت واضح";
    elements.listen.disabled = !LOCAL_SPEECH_SUPPORTED;
    resumeTimer();
  }
}

function setListening(active) {
  state.listening = active;
  elements.transcriptBox.classList.toggle("is-listening", active);
  elements.listen.classList.toggle("is-listening", active);
  elements.listenLabel.textContent = active ? "أغلق واعتمد البيت" : "افتح الميكروفون";
  elements.turnPrompt.textContent = active ? "الراوي يسمعك الآن…" : "أنشد بيتك بصوت واضح";
}

function clearSpeechPreviewTimer() {
  if (!state.speechPreviewTimer) return;
  window.clearInterval(state.speechPreviewTimer);
  state.speechPreviewTimer = null;
}

function formatModelProgress(progress) {
  const value = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  elements.modelProgress.hidden = false;
  elements.modelProgress.value = value;
  return toArabicNumber(value);
}

function explainSpeechError(error) {
  const message = String(error?.message || error || "");
  if (/NotAllowed|Permission|denied/i.test(message)) {
    return "لم يُسمح باستخدام الميكروفون. فعّل الإذن من إعدادات الموقع ثم حاول مجددًا.";
  }
  if (/NotFound|DevicesNotFound/i.test(message)) {
    return "لم يعثر المتصفح على ميكروفون يعمل.";
  }
  if (/network|fetch|load|import/i.test(message)) {
    return "تعذّر تنزيل نموذج الصوت المحلي. تحقق من الاتصال ثم أعد المحاولة؛ بعد تنزيله يعمل من ذاكرة المتصفح.";
  }
  return `تعذّر تشغيل التعرّف المحلي${message ? `: ${message}` : "."}`;
}

function handleSpeechFailure(error) {
  console.error(error);
  const explanation = explainSpeechError(error);
  stopLocalCapture();
  setListening(false);
  state.speechModelState = "error";
  state.speechBusy = false;
  state.activeSpeechRequest = null;
  state.pendingFinalAudio = null;
  elements.modelProgress.hidden = true;
  elements.listen.disabled = !LOCAL_SPEECH_SUPPORTED || state.paused || state.inTransition;
  elements.voiceHelp.textContent = explanation;
  elements.manualEntry.open = true;
  showFeedback("error", "تعذّر التعرّف المحلي", `${explanation} ويمكنك كتابة البيت الآن.`);
  resumeTimer();
}

function dispatchQueuedFinal() {
  if (!state.pendingFinalAudio || state.speechModelState !== "ready" || state.speechBusy) return;
  const pending = state.pendingFinalAudio;
  state.pendingFinalAudio = null;
  requestTranscription(pending.audio, true, pending.sessionId);
}

function handleSpeechWorkerMessage(event) {
  const message = event.data || {};
  if (message.type === "progress") {
    const percent = formatModelProgress(message.progress);
    elements.voiceHelp.textContent = `جار تنزيل نموذج الصوت المحلي: ${percent}٪ — يحدث هذا في أول استعمال فقط.`;
    return;
  }
  if (message.type === "ready") {
    state.speechModelState = "ready";
    elements.modelProgress.hidden = true;
    elements.voiceHelp.textContent = state.listening
      ? "الميكروفون مفتوح. أنشد، ثم اضغط «أغلق واعتمد البيت» بنفسك."
      : "نموذج الصوت المحلي جاهز.";
    if (state.listening) resumeTimer();
    dispatchQueuedFinal();
    return;
  }
  if (message.type === "error") {
    handleSpeechFailure(new Error(message.error || "Local speech error"));
    return;
  }
  if (message.type !== "result") return;

  const request = state.activeSpeechRequest;
  state.speechBusy = false;
  state.activeSpeechRequest = null;
  if (
    !request ||
    request.id !== message.requestId ||
    request.sessionId !== message.sessionId ||
    request.sessionId !== state.speechSessionId
  ) {
    dispatchQueuedFinal();
    return;
  }

  const transcript = String(message.text || "").trim();
  if (request.final) {
    elements.listen.disabled = !LOCAL_SPEECH_SUPPORTED;
    elements.voiceHelp.textContent = "اكتمل تحليل التسجيل محليًا.";
    if (transcript) {
      elements.transcript.textContent = transcript;
      submitPlayerText(transcript);
    } else {
      showFeedback("error", "لم أسمع بيتًا واضحًا", "افتح الميكروفون وحاول مرة أخرى، أو اكتب البيت يدويًا.");
      resumeTimer();
    }
  } else if (state.listening && transcript) {
    elements.transcript.textContent = transcript;
  }
  dispatchQueuedFinal();
}

function ensureSpeechWorker() {
  if (state.speechWorker && state.speechModelState !== "error") return;
  if (state.speechWorker) state.speechWorker.terminate();
  state.speechModelState = "loading";
  state.speechWorker = new Worker("speech-worker.js?v=7", { type: "module" });
  state.speechWorker.addEventListener("message", handleSpeechWorkerMessage);
  state.speechWorker.addEventListener("error", event => {
    handleSpeechFailure(new Error(event.message || "تعذّر تحميل عامل الصوت"));
  });
  elements.modelProgress.hidden = false;
  elements.modelProgress.value = 0;
  elements.voiceHelp.textContent = "يُنزّل نموذج الصوت المحلي لأول مرة… يمكنك البدء بالإنشاد الآن.";
  state.speechWorker.postMessage({ type: "load" });
}

function combineAudioChunks() {
  const length = state.audioChunks.reduce((total, chunk) => total + chunk.length, 0);
  const combined = new Float32Array(length);
  let offset = 0;
  for (const chunk of state.audioChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

function resampleAudio(input, inputRate, outputRate = SPEECH_SAMPLE_RATE) {
  if (!input.length || inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const mix = position - left;
    output[index] = input[left] * (1 - mix) + input[right] * mix;
  }
  return output;
}

function recordedAudio(maxSeconds = 0) {
  const resampled = resampleAudio(combineAudioChunks(), state.audioSampleRate);
  if (!maxSeconds || resampled.length <= maxSeconds * SPEECH_SAMPLE_RATE) return resampled;
  return resampled.slice(-maxSeconds * SPEECH_SAMPLE_RATE);
}

function requestTranscription(audio, final, sessionId = state.speechSessionId) {
  if (!audio?.length || !state.speechWorker || state.speechModelState !== "ready" || state.speechBusy) return false;
  const requestId = ++state.speechRequestId;
  state.speechBusy = true;
  state.activeSpeechRequest = { id: requestId, sessionId, final };
  state.speechWorker.postMessage(
    { type: "transcribe", requestId, sessionId, final, audio },
    [audio.buffer]
  );
  return true;
}

function requestSpeechPreview() {
  if (!state.listening || state.speechModelState !== "ready" || state.speechBusy) return;
  const samples = state.audioChunks.reduce((total, chunk) => total + chunk.length, 0);
  if (samples - state.lastPreviewSamples < state.audioSampleRate * 3) return;
  state.lastPreviewSamples = samples;
  requestTranscription(recordedAudio(30), false);
}

function stopLocalCapture() {
  clearSpeechPreviewTimer();
  if (state.audioProcessor) {
    state.audioProcessor.onaudioprocess = null;
    state.audioProcessor.disconnect();
  }
  state.audioSource?.disconnect();
  state.audioSink?.disconnect();
  state.microphoneStream?.getTracks().forEach(track => track.stop());
  if (state.audioContext && state.audioContext.state !== "closed") {
    state.audioContext.close().catch(() => {});
  }
  state.microphoneStream = null;
  state.audioContext = null;
  state.audioSource = null;
  state.audioProcessor = null;
  state.audioSink = null;
}

async function finishListeningAndSubmit() {
  if (!state.listening) return;
  const sessionId = state.speechSessionId;
  setListening(false);
  stopTimer();
  const audio = recordedAudio();
  stopLocalCapture();
  elements.listen.disabled = true;
  elements.voiceHelp.textContent = state.speechModelState === "ready"
    ? "جار تحليل التسجيل على جهازك…"
    : "اكتمل التسجيل؛ سأحلله فور اكتمال تنزيل النموذج المحلي.";
  if (audio.length < SPEECH_SAMPLE_RATE / 2) {
    elements.listen.disabled = false;
    showFeedback("error", "التسجيل قصير جدًا", "افتح الميكروفون وأنشد بيتًا كاملًا قبل إغلاقه.");
    resumeTimer();
    return;
  }
  state.pendingFinalAudio = { audio, sessionId };
  dispatchQueuedFinal();
}

function stopRecognition() {
  state.speechSessionId += 1;
  state.pendingFinalAudio = null;
  stopLocalCapture();
  setListening(false);
  state.audioChunks = [];
  state.lastPreviewSamples = 0;
}

function showFeedback(type, title, message) {
  const isError = type === "error";
  elements.feedback.hidden = false;
  elements.feedback.classList.toggle("is-error", isError);
  elements.feedbackIcon.textContent = isError ? "!" : "✓";
  elements.feedbackTitle.textContent = title;
  elements.feedbackText.textContent = message;
}

function hideFeedback() {
  elements.feedback.hidden = true;
  elements.feedback.classList.remove("is-error");
}

function renderNarratorTurn() {
  elements.narratorFirst.textContent = state.narrator.first;
  elements.narratorSecond.textContent = state.narrator.second;
  elements.requiredLetter.textContent = state.requiredLetter;
  elements.roundLabel.textContent = state.rounds === 1
    ? "فاتحة المجلس"
    : `الردّ ${toArabicNumber(state.rounds)}`;
  elements.chain.textContent = toArabicNumber(state.chain);
  elements.score.textContent = toArabicNumber(state.score);
}

function preparePlayerTurn() {
  state.inTransition = false;
  elements.transcript.textContent = "سيظهر هنا ما يسمعه الراوي…";
  elements.manualInput.value = "";
  elements.listen.disabled = !LOCAL_SPEECH_SUPPORTED;
  elements.checkText.disabled = false;
  hideFeedback();
  resetTurnTimer();
}

function startDuel() {
  if (!state.verses.length) {
    showToast("لم يكتمل فتح الديوان بعد");
    return;
  }

  stopRecognition(true);
  stopTimer();
  state.usedIds = new Set();
  state.chain = 0;
  state.score = 0;
  state.rounds = 1;
  state.inTransition = false;
  state.duelActive = true;
  state.narrator = chooseOpeningVerse(state.verses, state.usedIds);
  if (!state.narrator) {
    state.duelActive = false;
    showToast("تعذّر اختيار فاتحة للمساجلة");
    return;
  }
  state.usedIds.add(state.narrator.id);
  state.requiredLetter = lastArabicLetter(state.narrator.second);
  renderNarratorTurn();
  showScreen("duel");
  preparePlayerTurn();
}

function pickBestRecognition(transcripts) {
  const evaluated = transcripts.map(transcript => ({
    transcript,
    result: findBestMatch(
      transcript,
      state.verses,
      state.requiredLetter,
      state.usedIds
    )
  }));
  return evaluated.sort((a, b) => b.result.score - a.result.score)[0];
}

function submitPlayerText(transcripts) {
  if (!state.duelActive || state.inTransition || state.paused) return;
  const values = (Array.isArray(transcripts) ? transcripts : [transcripts])
    .map(value => value.trim())
    .filter(Boolean);

  if (!values.length) {
    showFeedback("error", "لم أسمع بيتًا", "حاول مرة أخرى واقترب قليلًا من الميكروفون.");
    return;
  }

  stopTimer();
  stopRecognition(true);
  const best = pickBestRecognition(values);
  elements.transcript.textContent = best.transcript;
  const { result } = best;

  if (result.match) {
    acceptVerse(result.match);
    return;
  }

  if (state.selectedDuration !== 0) {
    state.remainingMs = Math.max(1000, state.remainingMs - 2000);
    updateTimerDisplay();
  }

  if (result.reason === "wrong-letter") {
    showFeedback(
      "error",
      `هذا البيت يبدأ بحرف «${result.heardLetter}»`,
      `المطلوب بيت يبدأ بحرف «${state.requiredLetter}». حاول ببيت آخر.`
    );
  } else if (result.reason === "short") {
    showFeedback("error", "البيت غير مكتمل", "أنشد صدر البيت وعجزه، أو اكتب النص كاملًا.");
  } else {
    showFeedback(
      "error",
      "لم أجد البيت في الديوان",
      "أعد الإنشاد بوضوح أو استخدم الكتابة للتأكد من النص."
    );
  }
  elements.listen.disabled = !LOCAL_SPEECH_SUPPORTED;
  resumeTimer();
}

function acceptVerse(verse) {
  state.inTransition = true;
  state.usedIds.add(verse.id);
  state.chain += 1;
  const timeBonus = state.selectedDuration === 0 ? 0 : Math.ceil(state.remainingMs / 1000) * 2;
  state.score += 100 + timeBonus;
  elements.chain.textContent = toArabicNumber(state.chain);
  elements.score.textContent = toArabicNumber(state.score);
  elements.listen.disabled = true;
  elements.checkText.disabled = true;
  showFeedback(
    "success",
    "صحّ البيت وقُبل",
    `${verse.first} ۞ ${verse.second} — ${verse.meter}`
  );

  window.setTimeout(() => narratorReply(verse), 1450);
}

function narratorReply(playerVerse) {
  if (!state.duelActive) return;
  const needed = lastArabicLetter(playerVerse.second);
  const reply = chooseComputerVerse(state.verses, needed, state.usedIds);

  if (!reply) {
    finishDuel("victory");
    return;
  }

  state.narrator = reply;
  state.usedIds.add(reply.id);
  state.rounds += 1;
  state.requiredLetter = lastArabicLetter(reply.second);
  renderNarratorTurn();
  preparePlayerTurn();
}

function finishDuel(reason = "ended") {
  if (!state.duelActive) return;
  state.duelActive = false;
  state.inTransition = true;
  stopTimer();
  stopRecognition(true);
  const best = saveBestChain(state.chain);

  let grade = state.chain >= 10 ? "خ" : state.chain >= 5 ? "م" : "ب";
  let title = state.chain >= 10 ? "من أهل المساجلة" : state.chain >= 5 ? "مساجلة موفّقة" : "بداية طيبة";
  let message = "كل مجلس يفتح في الذاكرة بابًا جديدًا.";

  if (reason === "timeout") {
    title = "سبقك المؤقّت";
    message = "غيّر مدة الدور وابدأ سلسلة أطول.";
  } else if (reason === "victory") {
    grade = "ظ";
    title = "أعجزتَ الراوي";
    message = "لم يجد الراوي في الديوان ردًا على حرفك الأخير.";
  }

  elements.resultGrade.textContent = grade;
  elements.resultTitle.textContent = title;
  elements.resultMessage.textContent = message;
  elements.finalScore.textContent = toArabicNumber(state.score);
  elements.finalChain.textContent = toArabicNumber(state.chain);
  elements.finalRounds.textContent = toArabicNumber(state.rounds);
  elements.finalBest.textContent = toArabicNumber(best);
  showScreen("result");
}

function goHome() {
  state.duelActive = false;
  stopTimer();
  stopRecognition(true);
  showScreen("start");
}

function initializeLocalSpeech() {
  const readinessText = elements.voiceReadiness.querySelector("span:last-child");
  if (!LOCAL_SPEECH_SUPPORTED) {
    elements.voiceReadiness.classList.add("is-limited");
    readinessText.textContent = "التسجيل المحلي غير مدعوم هنا؛ استخدم الكتابة أو Chrome.";
    elements.manualEntry.open = true;
    elements.listen.disabled = true;
  } else {
    elements.listen.disabled = false;
    readinessText.textContent = "الديوان جاهز؛ نموذج الصوت يُنزّل عند أول استعمال";
  }
}

async function openListeningSession() {
  hideFeedback();
  elements.listen.disabled = true;
  elements.voiceHelp.textContent = "جار فتح الميكروفون…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    if (!state.duelActive || state.paused || state.inTransition) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    state.speechSessionId += 1;
    state.audioChunks = [];
    state.lastPreviewSamples = 0;
    state.microphoneStream = stream;
    state.audioContext = new AudioContextClass({ sampleRate: SPEECH_SAMPLE_RATE });
    state.audioSampleRate = state.audioContext.sampleRate;
    state.audioSource = state.audioContext.createMediaStreamSource(stream);
    state.audioProcessor = state.audioContext.createScriptProcessor(4096, 1, 1);
    state.audioSink = state.audioContext.createGain();
    state.audioSink.gain.value = 0;
    state.audioProcessor.onaudioprocess = event => {
      if (!state.listening) return;
      state.audioChunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    state.audioSource.connect(state.audioProcessor);
    state.audioProcessor.connect(state.audioSink);
    state.audioSink.connect(state.audioContext.destination);
    await state.audioContext.resume();

    elements.transcript.textContent = "الميكروفون مفتوح… ابدأ الإنشاد";
    elements.voiceHelp.textContent = "ستظهر الكلمات على دفعات، ولن يعتمد البيت حتى تغلق الميكروفون بنفسك.";
    setListening(true);
    elements.listen.disabled = false;
    if (state.speechModelState !== "ready") stopTimer();
    ensureSpeechWorker();
    state.speechPreviewTimer = window.setInterval(requestSpeechPreview, SPEECH_PREVIEW_INTERVAL);
  } catch (error) {
    stopLocalCapture();
    elements.listen.disabled = false;
    const explanation = explainSpeechError(error);
    elements.voiceHelp.textContent = explanation;
    showFeedback("error", "تعذّر فتح الميكروفون", explanation);
  }
}

function toggleListening() {
  if (!LOCAL_SPEECH_SUPPORTED || state.paused || state.inTransition) return;
  if (state.listening) {
    finishListeningAndSubmit();
    return;
  }
  openListeningSession();
}

async function loadVerses() {
  const readinessText = elements.voiceReadiness.querySelector("span:last-child");
  try {
    const response = await fetch("data/verses.json?v=7");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.verses) || data.verses.length !== 1000) {
      throw new Error("Invalid verse inventory");
    }
    state.verses = data.verses;
    elements.start.disabled = false;
    if (LOCAL_SPEECH_SUPPORTED) {
      elements.voiceReadiness.classList.add("is-ready");
      readinessText.textContent = "الديوان جاهز؛ نموذج الصوت يُنزّل عند أول استعمال";
    } else {
      elements.voiceReadiness.classList.add("is-limited");
      readinessText.textContent = "الديوان جاهز؛ التسجيل المحلي غير مدعوم في هذا المتصفح";
    }
  } catch (error) {
    console.error(error);
    elements.voiceReadiness.classList.add("is-limited");
    readinessText.textContent = "تعذّر فتح الديوان. أعد تحميل الصفحة.";
  }
}

elements.timerInput.addEventListener("input", event => setDuration(Number(event.target.value)));
elements.durationButtons.forEach(button => {
  button.addEventListener("click", () => setDuration(Number(button.dataset.duration)));
});
elements.start.addEventListener("click", startDuel);
elements.replay.addEventListener("click", startDuel);
elements.quit.addEventListener("click", () => finishDuel("ended"));
elements.endDuel.addEventListener("click", () => finishDuel("ended"));
elements.homeButtons.forEach(button => button.addEventListener("click", goHome));
elements.timeMinus.addEventListener("click", () => adjustTurnTime(-5));
elements.timePlus.addEventListener("click", () => adjustTurnTime(5));
elements.pause.addEventListener("click", togglePause);
elements.listen.addEventListener("click", toggleListening);
elements.checkText.addEventListener("click", () => submitPlayerText(elements.manualInput.value));
elements.manualInput.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    submitPlayerText(elements.manualInput.value);
  }
});
elements.aboutButtons.forEach(button => button.addEventListener("click", () => elements.aboutDialog.showModal()));
elements.closeAbout.addEventListener("click", () => elements.aboutDialog.close());
elements.aboutDialog.addEventListener("click", event => {
  if (event.target === elements.aboutDialog) elements.aboutDialog.close();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.duelActive && !state.paused && state.selectedDuration !== 0) {
    togglePause();
  }
});

setDuration(30);
saveBestChain(getBestChain());
initializeLocalSpeech();
showScreen("start");
loadVerses();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith("sajil-alrawi-")).map(key => caches.delete(key)));
    } catch {
      // Cache cleanup is best-effort and does not affect the duel.
    }
  });
}
