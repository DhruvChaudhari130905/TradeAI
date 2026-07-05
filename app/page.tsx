import Link from "next/link";
import { TrendingUp } from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0A0B0E] px-4">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-6">
          <TrendingUp className="h-8 w-8 text-[#00FF9C]" />
          <h1 className="text-4xl font-bold tracking-tight text-white">
            TradeAI
          </h1>
        </div>
        <p className="max-w-md text-lg text-zinc-400 mb-8">
          AI-powered trade journal and backtesting platform for Forex and Crypto
          traders.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/auth/login"
            className="rounded-md bg-[#00FF9C] px-6 py-3 text-sm font-medium text-black transition-colors hover:bg-[#00FF9C]/90"
          >
            Sign in
          </Link>
          <Link
            href="/auth/signup"
            className="rounded-md border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          >
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
