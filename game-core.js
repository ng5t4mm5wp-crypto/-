const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const NON_ARABIC = /[^\u0621-\u064A\s]/g;

export function normalizeArabic(text = "") {
  return String(text)
    .normalize("NFKC")
    .replace(DIACRITICS, "")
    .replace(/\u0640/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(NON_ARABIC, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalLetter(letter = "") {
  const normalized = normalizeArabic(letter).replace(/\s/g, "");
  if (!normalized) return "";
  const value = normalized.at(-1);
  if (value === "ة") return "ت";
  return value;
}

export function firstArabicLetter(text = "") {
  const normalized = normalizeArabic(text).replace(/\s/g, "");
  return normalized ? canonicalLetter(normalized[0]) : "";
}

export function lastArabicLetter(text = "") {
  const normalized = normalizeArabic(text).replace(/\s/g, "");
  return normalized ? canonicalLetter(normalized.at(-1)) : "";
}

export function fullVerse(verse) {
  return `${verse.first} ${verse.second}`.trim();
}

function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array(right.length + 1);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length];
}

function tokenDice(left, right) {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  leftTokens.forEach(token => {
    if (rightTokens.has(token)) shared += 1;
  });
  return (2 * shared) / (leftTokens.size + rightTokens.size);
}

export function textSimilarity(leftText, rightText) {
  const left = normalizeArabic(leftText);
  const right = normalizeArabic(rightText);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const distance = levenshteinDistance(left, right);
  const editScore = 1 - distance / Math.max(left.length, right.length);
  const wordScore = tokenDice(left, right);
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  const containmentScore = shorter.length >= 12 && longer.includes(shorter)
    ? 0.78 + 0.22 * (shorter.length / longer.length)
    : 0;

  return Math.max(editScore * 0.7 + wordScore * 0.3, wordScore, containmentScore);
}

function scoreVerse(transcript, verse) {
  const completeScore = textSimilarity(transcript, fullVerse(verse));
  const firstScore = textSimilarity(transcript, verse.first) * 0.84;
  const secondScore = textSimilarity(transcript, verse.second) * 0.84;
  return Math.max(completeScore, firstScore, secondScore);
}

export function findBestMatch(transcript, verses, requiredLetter, usedIds = new Set(), threshold = 0.52) {
  const normalized = normalizeArabic(transcript);
  if (normalized.length < 8 || normalized.split(" ").length < 2) {
    return { match: null, score: 0, reason: "short", closest: null };
  }

  const unused = verses.filter(verse => !usedIds.has(verse.id));
  const candidates = unused.filter(verse => firstArabicLetter(verse.first) === requiredLetter);
  if (!candidates.length) {
    return { match: null, score: 0, reason: "no-candidates", closest: null };
  }

  const ranked = candidates
    .map(verse => ({ verse, score: scoreVerse(normalized, verse) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];

  if (best.score >= threshold) {
    return { match: best.verse, score: best.score, reason: "matched", closest: best.verse };
  }

  const globalBest = unused
    .map(verse => ({ verse, score: scoreVerse(normalized, verse) }))
    .sort((a, b) => b.score - a.score)[0];

  if (globalBest?.score >= threshold) {
    return {
      match: null,
      score: globalBest.score,
      reason: "wrong-letter",
      closest: globalBest.verse,
      heardLetter: firstArabicLetter(globalBest.verse.first)
    };
  }

  return { match: null, score: best.score, reason: "not-found", closest: best.verse };
}

function randomItem(items, random = Math.random) {
  if (!items.length) return null;
  return items[Math.floor(random() * items.length)];
}

function hasReplyFor(letter, verses, usedIds) {
  return verses.some(verse => !usedIds.has(verse.id) && firstArabicLetter(verse.first) === letter);
}

export function chooseOpeningVerse(verses, usedIds = new Set(), random = Math.random) {
  const playable = verses.filter(verse => {
    if (usedIds.has(verse.id)) return false;
    return hasReplyFor(lastArabicLetter(verse.second), verses, new Set([...usedIds, verse.id]));
  });
  return randomItem(playable, random);
}

export function chooseComputerVerse(verses, requiredLetter, usedIds = new Set(), random = Math.random) {
  const candidates = verses.filter(
    verse => !usedIds.has(verse.id) && firstArabicLetter(verse.first) === requiredLetter
  );
  const playable = candidates.filter(verse =>
    hasReplyFor(lastArabicLetter(verse.second), verses, new Set([...usedIds, verse.id]))
  );
  return randomItem(playable.length ? playable : candidates, random);
}
