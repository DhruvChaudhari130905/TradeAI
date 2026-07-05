import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Navbar } from "@/components/layout/Navbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Double-check auth (middleware should catch this, but defense in depth)
  if (!user) {
    redirect("/auth/login");
  }

  // Fetch profile for username
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex h-screen bg-[#0A0B0E]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Navbar
          username={profile?.username ?? null}
          email={user.email ?? null}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
