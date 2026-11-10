export type DesktopConfig = { baseUrl: string; token: string; device?: { id: string; name: string } };
export type Display = { id: number; bounds: { x: number; y: number; width: number; height: number }; size: { width: number; height: number } };
export type Message = { id: string; conversationId: string; turnId: string; role: 'user' | 'assistant' | 'system'; source: string; content: string; createdAt: string; updatedAt: string; status: string; relatedMessageId?: string; skill?: string; error?: string; attachmentCount?: number };
export type CaptureTarget = { kind: 'window' | 'screen'; sourceId: string; displayName: string; displayId?: string; application?: string; crop?: { x: number; y: number; width: number; height: number } | null };
export type DesktopState = { ready: boolean; displays: Display[]; selectedDisplayId: number | null; targets: CaptureTarget[]; selectedTarget: CaptureTarget | null; screenshotQueueCount: number; captureStatus: string; activeAIRequest: boolean; activeSkill: string; currentConversationId: string; eventSequence: number };
export type LiveEvent = { id: string; sequence: number; type: string; timestamp: string; payload: any };
