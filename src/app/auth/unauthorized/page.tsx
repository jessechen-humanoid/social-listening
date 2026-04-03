"use client";

import { signOut } from "next-auth/react";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#fafaf8" }}>
      <div className="w-full max-w-sm rounded-xl p-8 text-center" style={{ backgroundColor: "#ffffff", border: "1px solid #e8e8e5" }}>
        <h1 className="text-xl font-bold mb-1" style={{ color: "#1a1a1a" }}>
          只要輿情
        </h1>
        <p className="text-sm mb-6" style={{ color: "#c75c5c" }}>
          你沒有存取權限
        </p>
        <p className="text-xs mb-6" style={{ color: "#6b6b6b" }}>
          如果你認為這是錯誤，請聯絡管理員
        </p>
        <button
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className="w-full py-2 rounded-lg text-sm font-medium transition"
          style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}
        >
          登出並換帳號
        </button>
      </div>
    </div>
  );
}
