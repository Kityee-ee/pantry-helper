import type { Category } from "./db";

export const CATEGORY_LABELS: Record<Category, string> = {
  low_stock: "Low stock",
  new_request: "New request",
  maintenance: "Maintenance",
  complaint: "Complaint",
  other: "Other",
};

/**
 * Deterministic, keyword-based categorisation.
 *
 * This is the fallback and the baseline to compare an AI categoriser against.
 * Swap or layer an AI call in `categorise()` below without changing callers.
 */
export function categoriseByRules(text: string): Category {
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
  if (has("complain", "unhappy", "annoy", "frustrat", "always", "never")) {
    return "complaint";
  }
  return "other";
}

/**
 * Single entry point used by the API. Currently rule-based only.
 * TODO: optionally call an LLM here and fall back to rules on error.
 */
export async function categorise(text: string): Promise<Category> {
  return categoriseByRules(text);
}
