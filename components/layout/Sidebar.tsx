"use client";

import {
  LayoutDashboard,
  BookOpen,
  FlaskConical,
  Settings,
  TrendingUp,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Journal", href: "/journal", icon: BookOpen },
  { label: "Backtest", href: "/backtest", icon: FlaskConical },
  { label: "Settings", href: "/dashboard/settings", icon: Settings },
];

/** Longest matching href wins, so /dashboard/settings doesn't also light up Dashboard */
function activeHref(pathname: string): string | undefined {
  return NAV_ITEMS.map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(href + "/"))
    .sort((a, b) => b.length - a.length)[0];
}

interface NavLinksProps {
  onNavigate?: () => void;
}

export function NavLinks({ onNavigate }: NavLinksProps) {
  const active = activeHref(usePathname());

  return (
    <>
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            <item.icon
              className={cn("h-4 w-4 shrink-0", isActive && "text-primary")}
              aria-hidden
            />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
      <TrendingUp className="h-5 w-5 text-primary" aria-hidden />
      TradeAI
    </span>
  );
}

interface AccountProps {
  username: string | null;
  email: string | null;
}

export function Account({ username, email }: AccountProps) {
  const name = username ?? "Trader";
  return (
    <div className="flex items-center gap-2.5 border-t border-border px-3 py-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-semibold uppercase text-foreground"
        aria-hidden
      >
        {name.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        {email && (
          <p className="truncate text-xs text-muted-foreground" title={email}>
            {email}
          </p>
        )}
      </div>
      <form action={signOut}>
        <button
          type="submit"
          aria-label="Sign out"
          title="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}

export function Sidebar({ username, email }: AccountProps) {
  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center px-4">
        <Link href="/dashboard" aria-label="TradeAI dashboard">
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label="Main">
        <NavLinks />
      </nav>

      <Account username={username} email={email} />
    </aside>
  );
}
