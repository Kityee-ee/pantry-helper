import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "accent" | "warn" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-black/5 text-muted",
  accent: "bg-accent-soft text-accent-strong",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function Badge({
  tone = "neutral",
  className = "",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`.trim()}
      {...props}
    />
  );
}
