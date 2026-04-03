"use client";

import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import UserMenu from "./UserMenu";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const isAuthPage = pathname.startsWith("/auth/");

  useEffect(() => {
    if (!isAuthPage && status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router, isAuthPage]);

  // Auth pages render without the header/shell
  if (isAuthPage) return <>{children}</>;

  // Loading state
  if (status === "loading") return null;

  // Not authenticated — redirect is happening
  if (!session) return null;

  // Authenticated — render with header
  return (
    <>
      <header className="border-b sticky top-0 z-10" style={{ backgroundColor: '#ffffff', borderColor: '#e8e8e5' }}>
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="text-xl font-bold tracking-tight" style={{ color: '#1a1a1a' }}>
            只要輿情
          </span>
          <UserMenu />
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
    </>
  );
}
