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
  const [audioEvent, setAudioEvent] = useState<any>(null);
  const [voiceEvent, setVoiceEvent] = useState<any>(null);
  const [interim, setInterim] = useState('');
  const seq = useRef(0);
  const socket = useRef<DesktopSocket | undefined>(undefined);
  const fullRefresh = useRef<Promise<void> | null>(null);
  const stateRefresh = useRef<Promise<void> | null>(null);

  const forgetExpiredLogin = useCallback(async () => {
    await clearConnection();
    setConfig(null);
    setState(null);
    setMessages([]);
    setConnected(false);
    setError('This phone login was revoked. Enter password 9898 to reconnect.');
  }, []);

  const applyStateSnapshot = useCallback((nextState: DesktopState) => {
    setState(previous => {
      if (!previous || nextState.eventSequence >= seq.current) return nextState;
      // A live socket event arrived while this request was in flight. Keep its
      // latency-sensitive fields instead of overwriting them with an older HTTP
      // snapshot, while still accepting refreshed display/target metadata.
      return {
        ...nextState,
        listening: previous.listening,
        speech: previous.speech,
        screenshotQueueCount: previous.screenshotQueueCount,
        captureStatus: previous.captureStatus,
        activeAIRequest: previous.activeAIRequest,
        activeSkill: previous.activeSkill,
        currentConversationId: previous.currentConversationId,
        eventSequence: seq.current
      };
    });
  }, []);

  const handleRefreshError = useCallback((failure: any) => {
    if (failure instanceof DesktopApiError && failure.status === 401) {
      void forgetExpiredLogin();
      return;
    }
    setError(failure.message);
  }, [forgetExpiredLogin]);

  const refreshState = useCallback((override?: DesktopConfig) => {
    const current = override || config;
    if (!current) return Promise.resolve();
    if (stateRefresh.current) return stateRefresh.current;
    const pending = api.state(current)
      .then(nextState => { applyStateSnapshot(nextState); setError(''); })
      .catch(handleRefreshError)
      .finally(() => { if (stateRefresh.current === pending) stateRefresh.current = null; });
    stateRefresh.current = pending;
    return pending;
  }, [config, applyStateSnapshot, handleRefreshError]);

  const refresh = useCallback((override?: DesktopConfig) => {
    const current = override || config;
    if (!current) return Promise.resolve();
    if (fullRefresh.current) return fullRefresh.current;
    const pending = (async () => {
      try {
        const nextState = await api.state(current);
        const history = await api.messages(current, nextState.currentConversationId);
        applyStateSnapshot(nextState);
        setMessages(history.items);
        setNextCursor(history.nextCursor);
        setError('');
      } catch (failure: any) {
        handleRefreshError(failure);
      }
    })().finally(() => { if (fullRefresh.current === pending) fullRefresh.current = null; });
    fullRefresh.current = pending;
    return pending;
  }, [config, applyStateSnapshot, handleRefreshError]);

  const onEvent = useCallback((event: LiveEvent) => {
    if (event.sequence <= seq.current) return;
    seq.current = event.sequence;

    if (event.type === 'queue.updated') {
      setState(value => value ? { ...value, screenshotQueueCount: Number(event.payload.count) || 0, eventSequence: event.sequence } : value);
    }
    if (event.type === 'status.updated') {
      // Status payloads already contain the canonical listening/speech state.
      // Applying them directly avoids two HTTP requests for every transition.
      setState(value => value ? { ...value, ...event.payload, eventSequence: event.sequence } : value);
    }
    if (event.type === 'job.started') {
      setState(value => value ? { ...value, activeAIRequest: true, captureStatus: 'processing', eventSequence: event.sequence } : value);
    }
    if (event.type === 'job.completed' || event.type === 'job.failed') {
      setState(value => value ? { ...value, activeAIRequest: false, captureStatus: event.type === 'job.failed' ? 'error' : 'ready', eventSequence: event.sequence } : value);
    }
    if (event.type === 'conversation.created') {
      setMessages([]);
      setState(value => value ? { ...value, currentConversationId: event.payload.id, eventSequence: event.sequence } : value);
    }
    if (event.type === 'transcription.interim') setInterim(event.payload.text || '');
    if (event.type === 'transcription.final') setInterim('');
    if (event.type.startsWith('voice.')) setVoiceEvent(event);
    if (event.type === 'message.created' || event.type === 'response.started') {
      setMessages(items => items.some(message => message.id === event.payload.id) ? items : [...items, event.payload]);
    }
    if (event.type === 'response.delta') {
      setMessages(items => items.map(message => message.id === event.payload.messageId ? { ...message, content: message.content + event.payload.delta, status: 'streaming' } : message));
    }
    if (event.type === 'response.completed' || event.type === 'response.failed') {
      setMessages(items => items.map(message => message.id === event.payload.id ? event.payload : message));
    }
  }, []);

  useEffect(() => {
    (async () => {
      const saved = await loadConnection();
      if (saved) setConfig(saved);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    socket.current?.stop();
    if (!config) return;
    const next = new DesktopSocket(
      config,
      () => seq.current,
      onEvent,
      (ok, serverSequence, reason) => {
        setConnected(ok);
        if (reason === 'unauthorized') void forgetExpiredLogin();
        if (ok && typeof serverSequence === 'number' && serverSequence < seq.current) seq.current = serverSequence;
      },
      value => {
        if (value.type === 'replay.completed') void refresh(config);
        else if (value.type?.startsWith('voice.recording.')) setVoiceEvent({ type: value.type, timestamp: new Date().toISOString(), payload: value });
        else setAudioEvent(value);
      }
    );
    socket.current = next;
    next.start();
    return () => next.stop();
  }, [config, onEvent, forgetExpiredLogin, refresh]);

  const updateConfig = (value: DesktopConfig | null) => {
    setConfig(value);
    if (!value) {
      setState(null);
      setMessages([]);
      setConnected(false);
    }
  };
  const action = async (path: string, body?: any) => {
    if (!config) throw new Error('Not connected.');
    const result = await api.post(config, path, body);
    // Socket events update the fast UI path. One coalesced state request is a
    // fallback for packet loss and for actions without a dedicated event.
    void refreshState(config);
    return result;
  };
  const loadOlder = async () => {
    if (!config || !state || !nextCursor) return;
    const page = await api.messages(config, state.currentConversationId, nextCursor);
    setMessages(items => [...page.items, ...items]);
    setNextCursor(page.nextCursor);
  };
  const sendSocket = useCallback((value: object) => socket.current?.send(value) || false, []);

  return { config, updateConfig, state, messages, connected, loading, error, refresh, action, loadOlder, hasOlder: !!nextCursor, sendSocket, audioEvent, voiceEvent, interim };
}
