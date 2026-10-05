const ROUND_COUNT = 10;
const QUESTION_SECONDS = 20;
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const MODE_LABELS = {
  complete: "أكمل البيت",
  meter: "اعرف البحر",
  mixed: "مجلس الراوي"
};

const elements = {
  screens: [...document.querySelectorAll("[data-screen]")],
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  homeButtons: [...document.querySelectorAll("[data-go-home]")],
  aboutButtons: [...document.querySelectorAll("[data-open-about]")],
  aboutDialog: document.querySelector("[data-about-dialog]"),
  closeAbout: document.querySelector("[data-close-about]"),
  loadStatus: document.querySelector("[data-load-status]"),
  bestScores: [...document.querySelectorAll("[data-best-score]")],
  roundCurrent: document.querySelector("[data-round-current]"),
  progressBar: document.querySelector("[data-progress-bar]"),
  score: document.querySelector("[data-score]"),
  questionKind: document.querySelector("[data-question-kind]"),
  promptLabel: document.querySelector("[data-prompt-label]"),
  questionText: document.querySelector("[data-question-text]"),
  questionMark: document.querySelector("[data-question-mark]"),
  answers: document.querySelector("[data-answers]"),
  time: document.querySelector("[data-time]"),
  timerBar: document.querySelector("[data-timer-bar]"),
  feedback: document.querySelector("[data-feedback]"),
  feedbackTitle: document.querySelector("[data-feedback-title]"),
  feedbackText: document.querySelector("[data-feedback-text]"),
  next: document.querySelector("[data-next]"),
  quit: document.querySelector("[data-quit]"),
  replay: document.querySelector("[data-replay]"),
  finalScore: document.querySelector("[data-final-score]"),
  correctCount: document.querySelector("[data-correct-count]"),
  bestStreak: document.querySelector("[data-best-streak]"),
  resultBest: document.querySelector("[data-result-best]"),
  resultGrade: document.querySelector("[data-result-grade]"),
  resultTitle: document.querySelector("[data-result-title]"),
  resultMessage: document.querySelector("[data-result-message]"),
  toast: document.querySelector("[data-toast]")
};

const state = {
  verses: [],
  meters: [],
  mode: "complete",
  round: 0,
  questions: [],
  score: 0,
  correct: 0,
  streak: 0,
  bestStreak: 0,
  answered: false,
  timerId: null,
  deadline: 0
};

function toArabicNumber(value) {
  return String(Math.max(0, Math.round(value))).replace(/\d/g, digit => ARABIC_DIGITS[digit]);
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    const swapWith = Math.floor(random * (index + 1));
    [copy[index], copy[swapWith]] = [copy[swapWith], copy[index]];
  }
  return copy;
}

function sample(items, amount) {
  return shuffle(items).slice(0, amount);
}

function getBestScore() {
  try {
    return Number(localStorage.getItem("sajil-best-score")) || 0;
  } catch {
    return 0;
  }
}

function saveBestScore(score) {
  const best = Math.max(score, getBestScore());
  try {
    localStorage.setItem("sajil-best-score", String(best));
  } catch {
    // The game still works when storage is disabled.
  }
  updateBestScore(best);
  return best;
}

function updateBestScore(score = getBestScore()) {
  elements.bestScores.forEach(element => {
    element.textContent = toArabicNumber(score);
  });
}

function showScreen(name) {
  elements.screens.forEach(screen => {
    const isTarget = screen.dataset.screen === name;
    screen.classList.toggle("is-active", isTarget);
    screen.setAttribute("aria-hidden", String(!isTarget));
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
}

function stopTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function goHome() {
  stopTimer();
  state.answered = true;
  showScreen("start");
}

function buildQuestion(verse, index) {
  const type = state.mode === "mixed"
    ? (index % 2 === 0 ? "complete" : "meter")
    : state.mode;

  if (type === "meter") {
    const alternatives = sample(state.meters.filter(meter => meter !== verse.meter), 3);
    return {
      type,
      verse,
      correct: verse.meter,
      answers: shuffle([verse.meter, ...alternatives])
    };
  }

  const sameMeter = state.verses.filter(
    item => item.meter === verse.meter && item.id !== verse.id && item.second !== verse.second
  );
  const otherVerses = state.verses.filter(
    item => item.id !== verse.id && item.second !== verse.second
  );
  const distractorPool = sameMeter.length >= 3 ? sameMeter : otherVerses;
  const alternatives = sample(distractorPool, 3).map(item => item.second);

  return {
    type,
    verse,
    correct: verse.second,
    answers: shuffle([verse.second, ...alternatives])
  };
}

function startGame(mode) {
  if (state.verses.length < ROUND_COUNT) {
    showToast("لم يكتمل فتح الديوان بعد");
    return;
  }

  state.mode = mode;
  state.round = 0;
  state.score = 0;
  state.correct = 0;
  state.streak = 0;
  state.bestStreak = 0;
  state.questions = sample(state.verses, ROUND_COUNT).map(buildQuestion);
  elements.score.textContent = toArabicNumber(0);
  showScreen("game");
  renderQuestion();
}

function renderQuestion() {
  stopTimer();
  state.answered = false;
  const question = state.questions[state.round];
  const isComplete = question.type === "complete";

  elements.roundCurrent.textContent = toArabicNumber(state.round + 1);
  elements.progressBar.style.width = `${((state.round + 1) / ROUND_COUNT) * 100}%`;
  elements.questionKind.textContent = MODE_LABELS[question.type];
  elements.promptLabel.textContent = isComplete ? "اختر عجز البيت الصحيح" : "حدّد البحر الشعري";
  elements.questionText.textContent = isComplete
    ? question.verse.first
    : `${question.verse.first} ۞ ${question.verse.second}`;
  elements.questionMark.hidden = !isComplete;
  elements.feedback.hidden = true;
  elements.answers.replaceChildren();

  question.answers.forEach((answer, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "answer-button";
    button.dataset.answer = answer;
    button.innerHTML = `<span class="answer-index">${toArabicNumber(index + 1)}</span><span class="answer-text"></span>`;
    button.querySelector(".answer-text").textContent = answer;
    button.addEventListener("click", () => answerQuestion(answer));
    elements.answers.append(button);
  });

  elements.next.textContent = state.round === ROUND_COUNT - 1 ? "عرض النتيجة" : "التالي";
  startTimer();
  elements.answers.querySelector("button")?.focus({ preventScroll: true });
}

function startTimer() {
  state.deadline = performance.now() + QUESTION_SECONDS * 1000;
  updateTimer(QUESTION_SECONDS * 1000);
  state.timerId = window.setInterval(() => {
    const remaining = Math.max(0, state.deadline - performance.now());
    updateTimer(remaining);
    if (remaining <= 0) {
      stopTimer();
      answerQuestion(null);
    }
  }, 100);
}

function updateTimer(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000);
  const percentage = (milliseconds / (QUESTION_SECONDS * 1000)) * 100;
  elements.time.textContent = toArabicNumber(seconds);
  elements.timerBar.style.width = `${percentage}%`;
  elements.timerBar.classList.toggle("is-urgent", seconds <= 5);
}

function answerQuestion(answer) {
  if (state.answered) return;
  state.answered = true;
  stopTimer();

  const question = state.questions[state.round];
  const isCorrect = answer === question.correct;
  const secondsLeft = Math.max(0, Math.ceil((state.deadline - performance.now()) / 1000));

  if (isCorrect) {
    state.streak += 1;
    state.correct += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.score += 100 + (secondsLeft * 3) + Math.min(state.streak - 1, 5) * 20;
    elements.feedbackTitle.textContent = state.streak >= 3
      ? `أحسنت! سلسلة من ${toArabicNumber(state.streak)}`
      : "أصبت يا راوي";
  } else {
    state.streak = 0;
    elements.feedbackTitle.textContent = answer === null ? "انقضى الوقت" : "فاتك هذا البيت";
  }

  elements.score.textContent = toArabicNumber(state.score);
  elements.answers.querySelectorAll(".answer-button").forEach(button => {
    button.disabled = true;
    if (button.dataset.answer === question.correct) button.classList.add("is-correct");
    if (button.dataset.answer === answer && !isCorrect) button.classList.add("is-wrong");
  });

  elements.feedbackText.textContent = question.type === "complete"
    ? `${question.verse.first} ۞ ${question.verse.second} — ${question.verse.meter}`
    : `البحر الصحيح: ${question.verse.meter}`;
  elements.feedback.hidden = false;
  elements.next.focus({ preventScroll: true });
}

function nextQuestion() {
  if (!state.answered) return;
  if (state.round >= ROUND_COUNT - 1) {
    finishGame();
    return;
  }
  state.round += 1;
  renderQuestion();
}

function finishGame() {
  stopTimer();
  const best = saveBestScore(state.score);
  const ratio = state.correct / ROUND_COUNT;
  let grade = "ج";
  let title = "بداية طيبة";
  let message = "كل مجلس يزيد الراوي حفظًا وفطنة.";

  if (ratio === 1) {
    grade = "خ";
    title = "ختمت المجلس بلا خطأ";
    message = "روايتك راسخة وميزانك حاضر.";
  } else if (ratio >= 0.8) {
    grade = "أ";
    title = "أحسنت يا راوي";
    message = "كنت قريبًا من مجلس الخواص.";
  } else if (ratio >= 0.5) {
    grade = "ب";
    title = "لك أذنٌ للشعر";
    message = "جولة أخرى، ويصفو لك الوزن والرواية.";
  }

  elements.resultGrade.textContent = grade;
  elements.resultTitle.textContent = title;
  elements.resultMessage.textContent = message;
  elements.finalScore.textContent = toArabicNumber(state.score);
  elements.correctCount.textContent = `${toArabicNumber(state.correct)} / ${toArabicNumber(ROUND_COUNT)}`;
  elements.bestStreak.textContent = toArabicNumber(state.bestStreak);
  elements.resultBest.textContent = toArabicNumber(best);
  showScreen("result");
}

function replay() {
  startGame(state.mode);
}

function handleKeyboard(event) {
  if (!document.querySelector('[data-screen="game"]').classList.contains("is-active")) return;
  if (!state.answered && ["1", "2", "3", "4", "١", "٢", "٣", "٤"].includes(event.key)) {
    const arabicIndex = ["١", "٢", "٣", "٤"].indexOf(event.key);
    const index = arabicIndex >= 0 ? arabicIndex : Number(event.key) - 1;
    elements.answers.querySelectorAll(".answer-button")[index]?.click();
  } else if (state.answered && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    nextQuestion();
  }
}

async function loadVerses() {
  try {
    const response = await fetch("data/verses.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.verses) || data.verses.length !== 1000) {
      throw new Error("Invalid verse inventory");
    }
    state.verses = data.verses;
    state.meters = [...new Set(data.verses.map(verse => verse.meter))];
    elements.loadStatus.textContent = "الديوان مفتوح — اختر مجلسك";
    elements.modeButtons.forEach(button => { button.disabled = false; });
  } catch (error) {
    console.error(error);
    elements.loadStatus.textContent = "تعذّر فتح الديوان. أعد تحميل الصفحة.";
    elements.modeButtons.forEach(button => { button.disabled = true; });
  }
}

elements.modeButtons.forEach(button => {
  button.disabled = true;
  button.addEventListener("click", () => startGame(button.dataset.mode));
});
elements.homeButtons.forEach(button => button.addEventListener("click", goHome));
elements.aboutButtons.forEach(button => button.addEventListener("click", () => elements.aboutDialog.showModal()));
elements.closeAbout.addEventListener("click", () => elements.aboutDialog.close());
elements.aboutDialog.addEventListener("click", event => {
  if (event.target === elements.aboutDialog) elements.aboutDialog.close();
});
elements.next.addEventListener("click", nextQuestion);
elements.quit.addEventListener("click", goHome);
elements.replay.addEventListener("click", replay);
document.addEventListener("keydown", handleKeyboard);

updateBestScore();
showScreen("start");
loadVerses();

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
