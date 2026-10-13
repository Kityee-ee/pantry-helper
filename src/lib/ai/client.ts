import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Model used for every AI call. Override with the AI_MODEL env var. */
export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

/** False when ANTHROPIC_API_KEY is missing: callers should use their rule-based fallback. */
export const aiEnabled = Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * Shared Anthropic client. Server only.
 * Constructing it without a key does not throw; the first request does,
 * so wrap calls in try/catch and fall back (see src/lib/categorise.ts).
 */
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "missing-anthropic-api-key",
  maxRetries: 2,
});
