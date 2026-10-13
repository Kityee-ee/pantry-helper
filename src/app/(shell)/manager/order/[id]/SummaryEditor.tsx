"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { saveSummaryTextAction } from "../actions";
import { MAX_SUMMARY_TEXT } from "../shared";

/** The supplier-ready order text: edit, save, copy. */
export function SummaryEditor({ orderId, initialText }: { orderId: string; initialText: string }) {
  const [text, setText] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = text !== savedText;

  function save() {
    if (pending || !dirty) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await saveSummaryTextAction(orderId, text);
        if (!res.ok) {
          setMessage({ tone: "error", text: res.error });
          return;
        }
        setSavedText(text);
        setMessage({ tone: "ok", text: "Saved." });
      } catch {
        setMessage({ tone: "error", text: "The text could not be saved. Check your connection and try again." });
      }
    });
  }

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Clipboard API unavailable (older browser or not a secure context): select and copy the old way.
      const el = area.current;
      if (el) {
        el.focus();
        el.select();
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
      }
    }
    if (!ok) {
      setMessage({ tone: "error", text: "Could not copy automatically. The text is selected: copy it by hand." });
      return;
    }
    setMessage(null);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="grid gap-3">
      <textarea
        ref={area}
        aria-label="Order text for the supplier"
        value={text}
        maxLength={MAX_SUMMARY_TEXT}
        rows={Math.min(24, Math.max(10, text.split("\n").length + 1))}
        onChange={(e) => {
          setText(e.target.value);
          setMessage(null);
        }}
        className="w-full rounded-lg border border-line bg-background p-3 font-mono text-sm leading-relaxed outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" onClick={copy} className="min-w-28">
          {copied ? "Copied ✓" : "Copy"}
        </Button>
        <Button size="lg" variant="secondary" disabled={pending || !dirty} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <p
          aria-live="polite"
          className={`text-sm ${message?.tone === "error" ? "text-danger" : "text-muted"}`}
        >
          {message?.text ?? (dirty ? "Unsaved changes" : "")}
        </p>
      </div>
    </div>
  );
}
