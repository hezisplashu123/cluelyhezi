import type { DesktopConfig, DesktopState, Message, VoiceRecognitionStatus } from '../types/protocol';

export class DesktopApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'DesktopApiError';
  }
}

async function request<T>(config: DesktopConfig | null, path: string, init: RequestInit = {}): Promise<T> {
  if (!config) throw new Error('Not connected.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), path.endsWith('/capture') ? 90000 : 20000);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, { ...init, signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`, ...(init.headers || {}) } });
    const body = await response.json();
    if (!response.ok || !body.success) {
      throw new DesktopApiError(body.error?.message || `Desktop returned ${response.status}.`, response.status, body.error?.code);
    }
    return body.data as T;
  } catch (error: any) { if (error?.name === 'AbortError') throw new Error('The result is unknown. Check the conversation before retrying; the same request will be reused.'); throw error; }
  finally { clearTimeout(timer); }
}

export const api = {
  login: async (baseUrl: string, password: string) => {
    const response = await fetch(`${baseUrl}/api/v1/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, deviceName: 'Phone' }) });
    const body = await response.json();
    if (!response.ok || !body.success) throw new DesktopApiError(body.error?.message || 'Login failed.', response.status, body.error?.code);
    return body.data;
  },
  state: (c: DesktopConfig) => request<DesktopState>(c, '/api/v1/state'),
  voiceStatus: (c: DesktopConfig) => request<VoiceRecognitionStatus>(c, '/api/v1/voice-profile'),
  conversations: (c: DesktopConfig, cursor?: string) => request<any>(c, `/api/v1/conversations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  messages: (c: DesktopConfig, id: string, cursor?: string) => request<{items: Message[]; nextCursor: string | null}>(c, `/api/v1/conversations/${id}/messages?limit=40${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  post: (c: DesktopConfig, path: string, value: any = {}) => request<any>(c, path, { method: 'POST', body: JSON.stringify({ requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...value }) })
};
