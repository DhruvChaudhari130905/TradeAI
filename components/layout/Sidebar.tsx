"use client";

import {
  LayoutDashboard,
  BookOpen,
  FlaskConical,
  Settings,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

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

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-zinc-800 bg-[#0A0B0E]">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4">
        <TrendingUp className="h-5 w-5 text-[#00FF9C]" />
        <span className="text-lg font-bold tracking-tight text-white">
          TradeAI
        </span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[#12141A] text-[#00FF9C]"
                  : "text-zinc-400 hover:bg-[#12141A] hover:text-white"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
