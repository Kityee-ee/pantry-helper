import { NextResponse } from "next/server";
import { updateEntryStatus, type EntryStatus } from "@/lib/db";

const STATUSES: EntryStatus[] = ["open", "done"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = body.status;
  if (typeof status !== "string" || !STATUSES.includes(status as EntryStatus)) {
    return NextResponse.json({ error: "status must be 'open' or 'done'" }, { status: 400 });
  }

  const entry = updateEntryStatus(numericId, status as EntryStatus);
  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(entry);
}
