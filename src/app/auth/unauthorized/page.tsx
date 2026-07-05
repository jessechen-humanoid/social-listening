"use client";

import { signOut } from "next-auth/react";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-paper)' }}>
      <div className="w-full max-w-sm rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--color-card)', border: "1px solid var(--color-line)" }}>
        <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--color-ink)' }}>
          只要輿情
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--color-danger)' }}>
          你沒有存取權限
        </p>
        <p className="text-xs mb-6" style={{ color: 'var(--color-muted)' }}>
          請使用公司 Google Workspace 帳號登入；如果你認為這是錯誤，請聯絡管理員
        </p>
        <button
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className="w-full py-2 rounded-lg text-sm font-medium transition"
          style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }}
        >
          登出並換帳號
        </button>
      </div>
    </div>
  );
}
