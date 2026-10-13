"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui";
import { signIn, type SignInState } from "./actions";

const DEMO_PASSWORD = "pantry123";
const DEMO_ACCOUNTS = [
  { email: "priya@pantry.demo", name: "Priya", role: "Manager" },
  { email: "josh@pantry.demo", name: "Josh", role: "Employee" },
  { email: "mei@pantry.demo", name: "Mei", role: "Employee" },
  { email: "tom@pantry.demo", name: "Tom", role: "Employee" },
];

const initialState: SignInState = { error: null };

const inputClass =
  "h-11 w-full rounded-lg border border-line bg-surface px-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>

        {state.error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {state.error}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="mt-6 border-t border-line pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Demo accounts (tap to fill)</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
              }}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm hover:border-accent hover:bg-accent-soft"
            >
              <span className="block font-medium">{account.name}</span>
              <span className="block text-xs text-muted">{account.role}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
