import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import SessionWrapper from "@/components/SessionWrapper";
import AppShell from "@/components/AppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "只要輿情 — 社群輿情分析工具",
  description: "AI 驅動的社群輿情分析，上傳資料即可產出好感度與情緒強度散佈圖",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" style={{ backgroundColor: '#fafaf8' }}>
        <SessionWrapper>
          <AppShell>
            {children}
          </AppShell>
        </SessionWrapper>
      </body>
    </html>
  );
}
