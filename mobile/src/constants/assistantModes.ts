export const assistantModes = [
  { mode: 'normal', label: 'Normal' },
  { mode: 'behavioral_star', label: 'STAR Behavioral' },
  { mode: 'case_interview', label: 'Case' }
] as const;

export function assistantModeLabel(mode: string) {
  return assistantModes.find(item => item.mode === mode)?.label || mode;
}
