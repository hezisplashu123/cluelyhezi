export type DisplayPart = { kind: 'text' | 'code'; content: string; language: string };
export function plainProse(value: string): string;
export function parts(value: string, options?: { plain?: boolean }): DisplayPart[];
export function toHtml(value: string): string;
export function toText(value: string): string;
