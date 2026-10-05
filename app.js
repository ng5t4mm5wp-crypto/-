import {
  chooseComputerVerse,
  chooseOpeningVerse,
  findBestMatch,
  lastArabicLetter
} from "./game-core.js";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

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
  ignoreRecognitionEnd: false,
  finalTranscripts: [],
  recognition: null,
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
    elements.listen.disabled = !Recognition;
    resumeTimer();
  }
}

function setListening(active) {
  state.listening = active;
  elements.transcriptBox.classList.toggle("is-listening", active);
  elements.listen.classList.toggle("is-listening", active);
  elements.listenLabel.textContent = active ? "أوقف وأرسل" : "ابدأ الاستماع";
  elements.turnPrompt.textContent = active ? "الراوي يسمعك الآن…" : "أنشد بيتك بصوت واضح";
}

function stopRecognition(ignoreEnd = false) {
  if (!state.recognition || !state.listening) return;
  state.ignoreRecognitionEnd = ignoreEnd;
  try {
    state.recognition.abort();
  } catch {
    // The browser may already have ended the session.
  }
  setListening(false);
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
  elements.listen.disabled = !Recognition;
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
  elements.listen.disabled = !Recognition;
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

function initializeRecognition() {
  const readinessText = elements.voiceReadiness.querySelector("span:last-child");
  if (!Recognition) {
    elements.voiceReadiness.classList.add("is-limited");
    readinessText.textContent = "الصوت غير مدعوم هنا؛ استخدم الكتابة أو Chrome.";
    elements.manualEntry.open = true;
    elements.listen.disabled = true;
    return;
  }

  state.recognition = new Recognition();
  state.recognition.lang = "ar-SA";
  state.recognition.continuous = false;
  state.recognition.interimResults = true;
  state.recognition.maxAlternatives = 5;

  state.recognition.onstart = () => {
    state.finalTranscripts = [];
    setListening(true);
    elements.transcript.textContent = "أُنصت…";
    elements.voiceHelp.textContent = "أنشد البيت كاملًا، ثم توقّف لحظة.";
  };

  state.recognition.onresult = event => {
    let interim = "";
    const finals = [];
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) {
        for (let alternative = 0; alternative < result.length; alternative += 1) {
          finals.push(result[alternative].transcript);
        }
      } else {
        interim += result[0].transcript;
      }
    }
    if (finals.length) state.finalTranscripts.push(...finals);
    const visible = finals[0] || interim;
    if (visible) elements.transcript.textContent = visible;
  };

  state.recognition.onerror = event => {
    const messages = {
      "not-allowed": "لم يُسمح باستخدام الميكروفون. فعّل الإذن من إعدادات الموقع.",
      "audio-capture": "لم يعثر المتصفح على ميكروفون يعمل.",
      "no-speech": "لم يُسمع صوت. اضغط الميكروفون وحاول مجددًا.",
      "network": "تعذّر الوصول إلى خدمة التعرف الصوتي."
    };
    elements.voiceHelp.textContent = messages[event.error] || "حدث خطأ في الاستماع؛ حاول مرة أخرى.";
  };

  state.recognition.onend = () => {
    setListening(false);
    if (state.ignoreRecognitionEnd) {
      state.ignoreRecognitionEnd = false;
      state.finalTranscripts = [];
      return;
    }
    const transcripts = [...state.finalTranscripts];
    state.finalTranscripts = [];
    if (transcripts.length) submitPlayerText(transcripts);
  };
}

function toggleListening() {
  if (!state.recognition || state.paused || state.inTransition) return;
  if (state.listening) {
    try {
      state.recognition.stop();
    } catch {
      setListening(false);
    }
    return;
  }

  state.ignoreRecognitionEnd = false;
  hideFeedback();
  try {
    state.recognition.start();
  } catch {
    elements.voiceHelp.textContent = "انتظر لحظة ثم حاول تشغيل الميكروفون مجددًا.";
  }
}

async function loadVerses() {
  const readinessText = elements.voiceReadiness.querySelector("span:last-child");
  try {
    const response = await fetch("data/verses.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.verses) || data.verses.length !== 1000) {
      throw new Error("Invalid verse inventory");
    }
    state.verses = data.verses;
    elements.start.disabled = false;
    if (Recognition) {
      elements.voiceReadiness.classList.add("is-ready");
      readinessText.textContent = "الديوان والصوت جاهزان";
    } else {
      elements.voiceReadiness.classList.add("is-limited");
      readinessText.textContent = "الديوان جاهز؛ الصوت غير مدعوم في هذا المتصفح";
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
initializeRecognition();
showScreen("start");
loadVerses();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
