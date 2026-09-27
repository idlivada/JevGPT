/** Tokens that attach to the previous word with no leading space. */
const NO_SPACE_BEFORE = new Set([".", ",", "!", "?", ":", ";", "...", "'s"]);
const SENTENCE_END = new Set([".", "!", "?"]);

export const PUNCTUATION = new Set([...NO_SPACE_BEFORE, "-"]);

export function isPunctuation(word: string): boolean {
  return PUNCTUATION.has(word);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * How `word` should be displayed when it follows `previous` tokens, including its
 * leading space. Handles punctuation spacing and sentence-start capitalization.
 */
export function formatToken(previous: readonly string[], word: string): string {
  const prev = previous.at(-1);
  const startsSentence = prev === undefined || SENTENCE_END.has(prev);
  const text = startsSentence && !isPunctuation(word) ? capitalize(word) : word;
  if (prev === undefined || NO_SPACE_BEFORE.has(word)) return text;
  return " " + text;
}

/** Join generated tokens into readable text. */
export function detokenize(tokens: readonly string[]): string {
  let out = "";
  for (let i = 0; i < tokens.length; i++) out += formatToken(tokens.slice(0, i), tokens[i]);
  return out;
}
