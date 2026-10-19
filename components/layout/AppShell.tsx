"use client";

import { useState } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Account, Logo, NavLinks, Sidebar } from "@/components/layout/Sidebar";
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
    <div className="flex h-screen bg-background">
      <div className="hidden lg:flex">
        <Sidebar username={username} email={email} />
      </div>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="flex w-72 max-w-[85vw] flex-col gap-0 border-border bg-card p-0 text-foreground"
        >
          <SheetHeader className="px-4 py-0">
            <SheetTitle className="flex h-14 items-center">
              <Logo />
            </SheetTitle>
          </SheetHeader>
          <nav className="flex-1 space-y-0.5 px-2 py-2" aria-label="Main">
            <NavLinks onNavigate={() => setNavOpen(false)} />
          </nav>
          <Account username={username} email={email} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Navbar onMenuClick={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}
