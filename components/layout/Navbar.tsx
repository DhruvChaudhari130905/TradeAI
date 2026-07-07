"use client";

import { Menu, User } from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

interface NavbarProps {
  username: string | null;
  email: string | null;
  onMenuClick?: () => void;
}

export function Navbar({ username, email, onMenuClick }: NavbarProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-zinc-800 bg-[#0A0B0E] px-4 sm:px-6">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onMenuClick}
        className="lg:hidden text-zinc-400 hover:bg-[#12141A] hover:text-white"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#12141A]">
            <User className="h-4 w-4 text-zinc-400" />
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-white">
              {username ?? "Trader"}
            </p>
            <p className="text-xs text-zinc-500">{email ?? ""}</p>
          </div>
        </div>

        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-[#12141A] hover:text-white"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
