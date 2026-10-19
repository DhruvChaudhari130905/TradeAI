"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/layout/Sidebar";

interface NavbarProps {
  onMenuClick?: () => void;
}

/** Phone/tablet top bar — on desktop the sidebar carries logo and account */
export function Navbar({ onMenuClick }: NavbarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-2 sm:px-4 lg:hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onMenuClick}
        className="h-10 w-10 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Link href="/dashboard" aria-label="TradeAI dashboard">
        <Logo />
      </Link>
    </header>
  );
}
