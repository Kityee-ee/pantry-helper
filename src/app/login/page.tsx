import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · Pantry Helper" };

// Fully static page: no session read here. Signed-out users are sent here by src/proxy.ts.
export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <p className="text-2xl font-semibold tracking-tight text-accent-strong">Pantry Helper</p>
        <p className="mt-1 text-sm text-muted">Sign in to keep the office pantry stocked.</p>
      </div>
      <Card>
        <LoginForm />
      </Card>
    </main>
  );
}
