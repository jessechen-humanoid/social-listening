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
    <div className="w-full max-w-sm rounded-xl p-8 text-center" style={{ backgroundColor: "#ffffff", border: "1px solid #e8e8e5" }}>
      <h1 className="text-xl font-bold mb-1" style={{ color: "#1a1a1a" }}>
        只要輿情
      </h1>
      <p className="text-sm mb-6" style={{ color: "#c75c5c" }}>
        {message}
      </p>
      <button
        onClick={() => signIn("google", { callbackUrl: "/" })}
        className="w-full py-2 rounded-lg text-sm font-medium transition"
        style={{ backgroundColor: "#1a1a1a", color: "#ffffff" }}
      >
        重新登入
      </button>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#fafaf8" }}>
      <Suspense>
        <ErrorContent />
      </Suspense>
    </div>
  );
}
