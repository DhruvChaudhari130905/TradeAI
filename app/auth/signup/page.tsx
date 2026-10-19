"use client";

import { useActionState } from "react";
import { signup, signInWithOAuth } from "@/lib/actions/auth";
import Link from "next/link";
import { TrendingUp } from "lucide-react";
import type { AuthResponse } from "@/lib/types/auth";

const initialState: AuthResponse | null = null;

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  const showConfirmation =
    state?.success && state.data.emailConfirmationNeeded;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2 rounded" aria-label="TradeAI home">
            <TrendingUp className="h-6 w-6 text-primary" aria-hidden />
            <span className="text-xl font-semibold tracking-tight text-foreground">TradeAI</span>
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">
            Create your account
          </p>
        </div>

        {showConfirmation && (
          <div className="mb-6 rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
            A confirmation email has been sent to your inbox. Please verify
            your email to continue.
          </div>
        )}

        {/* OAuth Buttons */}
        <div className="space-y-3">
          <form action={async () => { await signInWithOAuth("google") }}>
            <button
              type="submit"
              className="flex h-10 w-full items-center justify-center gap-3 rounded-md border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>
          </form>

          <form action={async () => { await signInWithOAuth("apple") }}>
            <button
              type="submit"
              className="flex h-10 w-full items-center justify-center gap-3 rounded-md border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C3.79 16.17 4.36 9.63 8.7 9.4c1.23.06 2.08.68 2.8.73.82-.17 1.62-.74 2.71-.67 1.14.07 2.01.56 2.59 1.44-2.34 1.4-1.79 4.48.4 5.36-.56 1.49-1.32 2.96-2.69 4.02h.54zM12.04 9.37c-.15-2.23 1.66-4.07 3.74-4.25.29 2.34-2.13 4.3-3.74 4.25z" />
              </svg>
              Continue with Apple
            </button>
          </form>
        </div>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-background px-2 text-muted-foreground">or</span>
          </div>
        </div>

        {/* Email/Password Form */}
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="username"
              className="text-sm font-medium text-foreground"
            >
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              className="flex h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="trader42"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium text-foreground"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="flex h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium text-foreground"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              className="flex h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="••••••••"
            />
          </div>

          {state && !state.success && (
            <p className="text-sm text-loss" role="alert">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="flex h-10 w-full items-center justify-center rounded-md bg-primary font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? "Creating account…" : "Sign up"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/auth/login"
            className="text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
