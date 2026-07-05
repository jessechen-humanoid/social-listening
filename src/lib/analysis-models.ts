// Single source of truth for light-mode model choices. The UI renders these
// options and the task-creation API rejects anything outside this list —
// the model is server-side configuration, not free client input.
export const LIGHT_MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
] as const;

export const ALLOWED_LIGHT_MODELS: readonly string[] = LIGHT_MODELS.map((m) => m.value);
