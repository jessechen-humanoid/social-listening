"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Route-based navigation (spec "Route-per-view navigation"): tabs are plain
// links — navigation carries NO state-reset side effects, so an accidental
// tab click can never clear an upload draft again.
const TABS = [
  { href: '/', label: '輕度分析' },
  { href: '/deep', label: '深度分析' },
  { href: '/history', label: '歷史紀錄' },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/history') {
    // Result pages are reached from history — keep the tab lit there.
    return (
      pathname.startsWith('/history') ||
      pathname.startsWith('/task/') ||
      pathname.startsWith('/batch/')
    );
  }
  return pathname.startsWith(href);
}

export default function PageHeader() {
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-ink)' }}>
          社群輿情分析
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
          上傳社群資料，AI 自動分析好感度與情緒強度
        </p>
      </div>
      <nav className="flex gap-2">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition"
              style={
                active
                  ? { backgroundColor: 'rgba(0,0,0,0.04)', color: 'var(--color-ink)' }
                  : { color: 'var(--color-muted)' }
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

// Shared page frame: every route renders inside the same width + header.
export function FlowPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <PageHeader />
      {children}
    </div>
  );
}
