import { useCallback, useEffect, useRef, useState } from 'react';
import { api, DesktopApiError } from '../services/api';
import { clearConnection, loadConnection } from '../services/connection';
import { DesktopSocket } from '../services/websocket';
import type { DesktopConfig, DesktopState, LiveEvent, Message } from '../types/protocol';

export function useDesktopConnection() {
  const [config, setConfig] = useState<DesktopConfig | null>(null);
  const [state, setState] = useState<DesktopState | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [audioEvent, setAudioEvent] = useState<any>(null); const [voiceEvent, setVoiceEvent] = useState<any>(null);
  const [interim, setInterim] = useState('');
  const seq = useRef(0); const socket = useRef<DesktopSocket | undefined>(undefined);

  const forgetExpiredPairing = useCallback(async () => {
    await clearConnection();
    setConfig(null); setState(null); setMessages([]); setConnected(false);
    setError('This desktop pairing expired or was revoked. Pair it once again.');
  }, []);

  const refresh = useCallback(async (override?: DesktopConfig) => {
    const current = override || config; if (!current) return;
    try {
      const before = seq.current;
      const nextState = await api.state(current);
      const history = await api.messages(current, nextState.currentConversationId);
      if (seq.current !== before) return;
      setState(nextState); setMessages(history.items); setNextCursor(history.nextCursor); setError('');
    } catch (e: any) {
      if (e instanceof DesktopApiError && e.status === 401) return forgetExpiredPairing();
      setConnected(false); setError(e.message);
    }
  }, [config, forgetExpiredPairing]);

  const onEvent = useCallback((event: LiveEvent) => {
    if (event.sequence <= seq.current) return; seq.current = event.sequence;
    if (event.type === 'queue.updated') refresh();
    if (event.type === 'status.updated') refresh();
    if (event.type === 'job.started') setState(value => value ? { ...value, activeAIRequest: true, captureStatus: 'processing' } : value);
    if (event.type === 'job.completed' || event.type === 'job.failed') { setState(value => value ? { ...value, activeAIRequest: false, captureStatus: event.type === 'job.failed' ? 'error' : 'ready' } : value); refresh(); }
    if (event.type === 'conversation.created') { setMessages([]); setState(value => value ? { ...value, currentConversationId: event.payload.id } : value); }
    if (event.type === 'transcription.interim') setInterim(event.payload.text || '');
    if (event.type === 'transcription.final') setInterim('');
    if (event.type.startsWith('voice.')) { setVoiceEvent(event); if (event.type === 'voice.profile.updated' || event.type === 'voice.filter.status' || event.type === 'voice.enrollment.completed') void refresh(); }
    if (event.type === 'message.created' || event.type === 'response.started') setMessages(items => items.some(m => m.id === event.payload.id) ? items : [...items, event.payload]);
    if (event.type === 'response.delta') setMessages(items => items.map(m => m.id === event.payload.messageId ? { ...m, content: m.content + event.payload.delta, status: 'streaming' } : m));
    if (event.type === 'response.completed' || event.type === 'response.failed') setMessages(items => items.map(m => m.id === event.payload.id ? event.payload : m));
  }, [refresh]);

  useEffect(() => {
    (async () => {
      const saved = await loadConnection();
      if (saved) {
        // Keep a valid saved credential even while the desktop is starting or
        // temporarily offline. The socket retries automatically in the background.
        setConfig(saved); setLoading(false); return;
      }
      setLoading(false);
    })();
  }, []);
  useEffect(() => {
    socket.current?.stop(); if (!config) return;
    const next = new DesktopSocket(config, () => seq.current, onEvent, (ok, serverSequence, reason) => {
      setConnected(ok);
      if (reason === 'unauthorized') { forgetExpiredPairing(); return; }
      if (ok) {
        if (typeof serverSequence === 'number' && serverSequence < seq.current) seq.current = serverSequence;
        void refresh(config);
      }
    }, value => { if (value.type === 'replay.completed') void refresh(config); else if (value.type?.startsWith('voice.recording.')) setVoiceEvent({ type: value.type, timestamp: new Date().toISOString(), payload: value }); else setAudioEvent(value); }); socket.current = next; next.start();
    return () => next.stop();
  }, [config, onEvent, forgetExpiredPairing]);

  const updateConfig = (value: DesktopConfig | null) => { setConfig(value); if (!value) { setState(null); setMessages([]); setConnected(false); } else refresh(value); };
  const action = async (path: string, body?: any) => { if (!config) throw new Error('Not connected.'); const result = await api.post(config, path, body); await refresh(config); return result; };
  const loadOlder = async () => { if (!config || !state || !nextCursor) return; const page = await api.messages(config, state.currentConversationId, nextCursor); setMessages(items => [...page.items, ...items]); setNextCursor(page.nextCursor); };
  const sendSocket = useCallback((value: object) => socket.current?.send(value) || false, []);
  return { config, updateConfig, state, messages, connected, loading, error, refresh, action, loadOlder, hasOlder: !!nextCursor, sendSocket, audioEvent, voiceEvent, interim };
}
