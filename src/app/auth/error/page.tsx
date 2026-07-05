"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const errorMessages: Record<string, string> = {
    VerificationFailed: "權限驗證服務暫時無法使用，請稍後再試",
    Default: "登入過程中發生錯誤，請重試",
  };

  const message = errorMessages[error ?? ""] || errorMessages.Default;

  return (
    <div className="w-full max-w-sm rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--color-card)', border: "1px solid var(--color-line)" }}>
      <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--color-ink)' }}>
        只要輿情
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-danger)' }}>
        {message}
      </p>
      <button
        onClick={() => signIn("google", { callbackUrl: "/" })}
        className="w-full py-2 rounded-lg text-sm font-medium transition"
        style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-card)' }}
      >
        重新登入
      </button>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-paper)' }}>
      <Suspense>
        <ErrorContent />
      </Suspense>
    </div>
  );
}
