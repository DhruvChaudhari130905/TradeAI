import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

const FEATURES = [
  {
    title: "Journal with five reviewers",
    body: "Log entry, stop, target and outcome. A prop-firm evaluator, psychologist, institutional trader, quant and risk manager each score the trade on entry, risk, psychology, execution and plan — and name the mistake to fix.",
  },
  {
    title: "Bar-by-bar replay",
    body: "Trade historical Forex and Crypto price action as if it were live. Every replay trade lands in your journal, separate from real trades.",
  },
  {
    title: "Progress you can audit",
    body: "Win rate, P&L curve and AI score trend over time, with every score traceable back to the reviewer who gave it.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
          <TrendingUp className="h-5 w-5 text-primary" aria-hidden />
          TradeAI
        </span>
        <Link href="/auth/login" className={buttonVariants({ variant: "ghost" })}>
          Sign in
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Find the mistake you keep making.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          A trade journal and replay simulator for Forex and Crypto traders. Every trade gets
          scored by five reviewers, so you practise discipline, not just entries.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/auth/signup" className={buttonVariants({ size: "lg", className: "h-10 px-4" })}>
            Create free account
          </Link>
          <Link href="/auth/login" className={buttonVariants({ variant: "outline", size: "lg", className: "h-10 px-4" })}>
            Sign in
          </Link>
        </div>

        <dl className="mt-16 grid gap-x-10 gap-y-8 border-t border-border pt-10 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <dt className="text-sm font-semibold text-foreground">{f.title}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</dd>
            </div>
          ))}
        </dl>
      </main>
    </div>
  );
}
