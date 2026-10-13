import { NextResponse, connection } from "next/server";
import { createEntry, listEntries } from "@/lib/db";
import { categorise } from "@/lib/categorise";

export async function GET() {
  // Opt out of build-time prerendering: the list must reflect the live database.
  await connection();
  return NextResponse.json(listEntries());
}

export async function POST(request: Request) {
  let body: { text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "text is too long (max 2000 chars)" }, { status: 400 });
  }

  const category = await categorise(text);
  const entry = createEntry(text, category);
  return NextResponse.json(entry, { status: 201 });
}
