import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, aiEnabled, anthropic } from "./client";

export type DocketConfidence = "high" | "medium" | "low";
export type DocketMediaType = "image/jpeg" | "image/png" | "image/webp";

export const DOCKET_MEDIA_TYPES: DocketMediaType[] = ["image/jpeg", "image/png", "image/webp"];

/** One line read off the docket. `item_id` is always null or an id from the catalogue passed in. */
export interface DocketLine {
  line_text: string;
  item_id: string | null;
  quantity: number;
  confidence: DocketConfidence;
}

export interface DocketExtraction {
  supplier: string | null;
  docket_number: string | null;
  lines: DocketLine[];
}

export interface CatalogueItem {
  id: string;
  name: string;
  unit: string | null;
}

export type ExtractDocketResult =
  | { ok: true; extraction: DocketExtraction; model: string }
  | { ok: false; reason: "disabled" | "failed" | "empty"; message: string };

const MAX_LINES = 60;
const MAX_QTY = 9999;
const TIME_BUDGET_MS = 55_000;

// The model answers with the short `ref` numbers we hand it, never with database ids,
// so a mis-copied id cannot point at the wrong item. Refs are mapped back in code.
const Output = z.object({
  supplier: z.string().nullable(),
  docket_number: z.string().nullable(),
  lines: z.array(
    z.object({
      line_text: z.string(),
      item_ref: z.number().nullable(),
      quantity: z.number(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

const SYSTEM = `You read a photo or screenshot of a supplier delivery docket for an office pantry, and match each delivered line to the pantry's item catalogue. The office manager checks your result in a review table before any stock changes, so give your best reading and use the confidence field honestly: it decides which rows she double-checks.

Return one entry per product line on the docket, in the order printed. Ignore headers, totals, signatures, addresses and notes that are not product lines.

For each line:
- line_text: the product description as printed, including any pack size written in it. Do not tidy it up or expand abbreviations.
- quantity: the number of units DELIVERED (supplied), as a whole number. Dockets often show both an ordered and a supplied or delivered column, and sometimes a back-order column: use supplied. If only one quantity is shown, use it. A line that was fully back-ordered has quantity 0. The quantity is the count of sellable units, not the pack size: "SPARKLING WATER 24PK" with quantity 4 is 4, not 96.
- item_ref: the ref of the catalogue item this line is, or null when nothing in the catalogue is the same product. Supplier wording is abbreviated and branded ("F/C MILK 2LT" is full cream milk in 2 litre bottles; "ARNOTTS ASSTD BISC" is assorted biscuits), so match on what the product is, and use the catalogue unit to tell sizes apart. Do not force a match: a product the pantry does not stock gets null, and the manager can add it as a new item.
- confidence: high when the text is clearly legible and the match (or the absence of one) is obvious; medium when you had to infer the product or the size; low when the text or the quantity is hard to read or the match is a guess.

supplier and docket_number: as printed, or null when not visible.

If the image is not a delivery docket or no product lines are readable, return an empty lines array.`;

// Server-side fallback on a declined request is only offered on these models.
const SUPPORTS_FALLBACK = /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(AI_MODEL);

/**
 * Read a docket image and match its lines against the catalogue.
 * Never throws. `ok: false` carries a message that is safe to show the manager,
 * and the caller falls back to manual entry.
 */
export async function extractDocket(
  image: { base64: string; mediaType: DocketMediaType },
  catalogue: CatalogueItem[],
): Promise<ExtractDocketResult> {
  if (!aiEnabled) {
    return { ok: false, reason: "disabled", message: "AI reading is not set up on this server." };
  }

  const refs = new Map<number, CatalogueItem>();
  catalogue.forEach((item, i) => refs.set(i + 1, item));
  const catalogueText = JSON.stringify(
    [...refs].map(([ref, item]) => ({ ref, name: item.name, unit: item.unit })),
    null,
    1,
  );

  // One overall deadline covering the SDK's own retry, so a slow call cannot hang the page.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIME_BUDGET_MS);
  try {
    const response = await anthropic.beta.messages.parse(
      {
        model: AI_MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
              {
                type: "text",
                text: `<catalogue>\n${catalogueText}\n</catalogue>\n\nRead the delivery docket in the image and return its lines.`,
              },
            ],
          },
        ],
        output_config: { effort: "low", format: betaZodOutputFormat(Output) },
        ...(SUPPORTS_FALLBACK
          ? { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const }
          : {}),
      },
      { timeout: 45_000, maxRetries: 1, signal: controller.signal },
    );

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      console.error("[extract-docket] no usable output, stop_reason:", response.stop_reason);
      return { ok: false, reason: "failed", message: "The AI could not read that photo." };
    }

    const out = response.parsed_output;
    const lines: DocketLine[] = [];
    for (const raw of out.lines.slice(0, MAX_LINES)) {
      const line_text = clip(raw.line_text, 160);
      if (!line_text || !Number.isFinite(raw.quantity)) continue; // malformed: drop
      const item = raw.item_ref == null ? undefined : refs.get(raw.item_ref);
      lines.push({
        line_text,
        item_id: item?.id ?? null, // unknown refs become "no match"
        quantity: Math.min(MAX_QTY, Math.max(0, Math.round(raw.quantity))),
        confidence: raw.confidence,
      });
    }

    if (lines.length === 0) {
      return { ok: false, reason: "empty", message: "No delivery lines could be read from that photo." };
    }
    return {
      ok: true,
      model: response.model,
      extraction: {
        supplier: out.supplier ? clip(out.supplier, 120) : null,
        docket_number: out.docket_number ? clip(out.docket_number, 60) : null,
        lines,
      },
    };
  } catch (e) {
    console.error("[extract-docket] AI call failed:", e instanceof Error ? e.message : e);
    return {
      ok: false,
      reason: "failed",
      message: controller.signal.aborted
        ? "Reading the photo took too long."
        : "The AI could not read that photo right now.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function clip(value: string, max: number): string {
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}
