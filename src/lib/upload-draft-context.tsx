"use client";

import { createContext, useContext, useEffect, useState } from 'react';
import type { AnalysisConfig, DeepAnalysisConfig, UploadedFile } from './types';

// Upload drafts live above the route tree (spec "Upload draft persistence
// across navigation"): File objects can't be serialized, so drafts survive
// client-side navigation via this provider and are lost on full reload —
// which is why the provider warns before unload when files are pending.

export const DEFAULT_LIGHT_CONFIG: AnalysisConfig = {
  mode: 'brand',
  projectName: '',
  conditionText: '',
  conditionFilterEnabled: false,
  xAxis: { name: '好感度', zeroDescription: '對品牌完全負面', tenDescription: '對品牌高度正面' },
  yAxis: { name: '情緒強度', zeroDescription: '平淡無情緒', tenDescription: '情緒非常激烈' },
  model: 'gpt-4o',
  dotColor: '#404040',
  maxRows: 0,
};

export const DEFAULT_DEEP_CONFIG: DeepAnalysisConfig = {
  mode: 'deep',
  projectName: '',
  brandId: '',
  brandName: '',
  timeRangeStart: '',
  timeRangeEnd: '',
};

interface UploadDraftState {
  lightFiles: UploadedFile[];
  setLightFiles: (files: UploadedFile[]) => void;
  lightConfig: AnalysisConfig;
  setLightConfig: (config: AnalysisConfig) => void;
  deepFiles: UploadedFile[];
  setDeepFiles: (files: UploadedFile[]) => void;
  deepConfig: DeepAnalysisConfig;
  setDeepConfig: (config: DeepAnalysisConfig) => void;
  deepStep: 'config' | 'mapping';
  setDeepStep: (step: 'config' | 'mapping') => void;
  resetLight: () => void;
  resetDeep: () => void;
}

const UploadDraftContext = createContext<UploadDraftState | null>(null);

export function UploadDraftProvider({ children }: { children: React.ReactNode }) {
  const [lightFiles, setLightFiles] = useState<UploadedFile[]>([]);
  const [lightConfig, setLightConfig] = useState<AnalysisConfig>(DEFAULT_LIGHT_CONFIG);
  const [deepFiles, setDeepFiles] = useState<UploadedFile[]>([]);
  const [deepConfig, setDeepConfig] = useState<DeepAnalysisConfig>(DEFAULT_DEEP_CONFIG);
  const [deepStep, setDeepStep] = useState<'config' | 'mapping'>('config');

  // Warn before losing un-submitted uploads on reload/close
  // (spec "Upload draft persistence across navigation", unload scenario).
  const hasPendingFiles = lightFiles.length > 0 || deepFiles.length > 0;
  useEffect(() => {
    if (!hasPendingFiles) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasPendingFiles]);

  const value: UploadDraftState = {
    lightFiles, setLightFiles,
    lightConfig, setLightConfig,
    deepFiles, setDeepFiles,
    deepConfig, setDeepConfig,
    deepStep, setDeepStep,
    resetLight: () => { setLightFiles([]); setLightConfig(DEFAULT_LIGHT_CONFIG); },
    resetDeep: () => { setDeepFiles([]); setDeepConfig(DEFAULT_DEEP_CONFIG); setDeepStep('config'); },
  };

  return <UploadDraftContext.Provider value={value}>{children}</UploadDraftContext.Provider>;
}

export function useUploadDraft(): UploadDraftState {
  const ctx = useContext(UploadDraftContext);
  if (!ctx) throw new Error('useUploadDraft must be used within UploadDraftProvider');
  return ctx;
}
