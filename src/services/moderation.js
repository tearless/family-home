const englishBadWords = [
  'hate',
  'stupid',
  'idiot',
  'dumb',
  'trash',
  'ugly',
  'shut up',
  'fool'
];

const koreanBadWords = [
  '바보',
  '멍청',
  '꺼져',
  '죽어',
  '재수없',
  '싫어'
];

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsHarshWords(text) {
  const normalized = normalize(text);
  const all = [...englishBadWords, ...koreanBadWords];
  return all.some((word) => normalized.includes(word));
}

function sanitizeContent(text) {
  const trimmed = text.trim();
  const filtered = containsHarshWords(trimmed);
  return {
    filtered,
    cleanText: filtered ? null : trimmed
  };
}

module.exports = { sanitizeContent, containsHarshWords };
