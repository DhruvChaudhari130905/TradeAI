"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { NavLinks, Sidebar } from "@/components/layout/Sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface AppShellProps {
  children: React.ReactNode;
  username: string | null;
  email: string | null;
}

export function AppShell({ children, username, email }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-screen bg-[#0A0B0E]">
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="w-72 max-w-[85vw] gap-0 border-zinc-800 bg-[#0A0B0E] p-0 text-zinc-200"
        >
          <SheetHeader className="border-b border-zinc-800 px-4 py-0">
            <SheetTitle className="flex h-14 items-center gap-2 text-lg font-bold tracking-tight text-white">
              <TrendingUp className="h-5 w-5 text-[#00FF9C]" />
              TradeAI
            </SheetTitle>
          </SheetHeader>
          <nav className="space-y-1 px-3 py-4">
            <NavLinks onNavigate={() => setNavOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Navbar
          username={username}
          email={email}
          onMenuClick={() => setNavOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
