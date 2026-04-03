"use client";

import { signOut, useSession } from "next-auth/react";

export default function UserMenu() {
  const { data: session } = useSession();

  if (!session?.user) return null;

  return (
    <div className="flex items-center gap-3">
      {session.user.image && (
        <img
          src={session.user.image}
          alt=""
          width={32}
          height={32}
          className="rounded-full"
          referrerPolicy="no-referrer"
        />
      )}
      <span className="text-sm" style={{ color: "#6b6b6b" }}>
        {session.user.name || session.user.email}
      </span>
      <button
        onClick={() => signOut({ callbackUrl: "/auth/signin" })}
        className="text-xs px-3 py-1 rounded-md transition"
        style={{ border: "1px solid #e8e8e5", color: "#6b6b6b" }}
      >
        登出
      </button>
    </div>
  );
}
