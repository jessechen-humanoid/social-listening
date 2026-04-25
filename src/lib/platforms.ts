// Pure type/value module — safe to import from client components.
// (lib/brands.ts pulls in `pg`, so client code must import Platform from here.)

export type Platform = 'fb' | 'ig' | 'threads' | 'dcard';

export const SUPPORTED_PLATFORMS: Platform[] = ['fb', 'ig', 'threads', 'dcard'];

export interface PlatformSettings {
  scatter_alpha: Record<Platform, number>;
  timeline_colors: { positive: string; negative: string };
}
