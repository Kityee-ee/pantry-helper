import type { SubmissionType } from "./types";

/**
 * Deterministic, keyword-based categorisation. Pure: no I/O.
 *
 * This is the fallback for when the AI classifier is unavailable or errors,
 * and the baseline to compare it against.
 */
export function categoriseByRules(text: string): SubmissionType {
  const t = text.toLowerCase();

  const has = (...words: string[]) => words.some((w) => t.includes(w));

  if (has("broken", "not working", "leak", "fix", "repair", "jammed", "smell", "clean")) {
    return "maintenance";
  }
  if (has("out of", "running low", "low on", "empty", "none left", "ran out", "no more")) {
    return "low_stock";
  }
  if (has("can we get", "could we get", "would be nice", "request", "please add", "please get", "would like")) {
    return "new_request";
  }
  return "other";
}
