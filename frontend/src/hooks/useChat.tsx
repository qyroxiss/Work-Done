import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { APP_NAME } from '../components/Brand';
import { api } from '../services/api';
import type { ChatEvent } from '../types';
import { useAuth } from './useAuth';
import { useToast } from './useToast';

interface ChatState {
  /** Unread messages across all conversations */
  unread: number;
  refreshUnread: () => void;
  /** Listen to live events; returns the unsubscribe function */
  subscribe: (listener: (event: ChatEvent) => void) => () => void;
  /** Conversation currently open on screen: its new messages do not count as unread */
  setActiveConversation: (conversationId: number | null) => void;
}

const ChatContext = createContext<ChatState | null>(null);

/** Keeps one live connection to the server per tab and tracks unread chat messages. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const listeners = useRef(new Set<(event: ChatEvent) => void>());
  const active = useRef<number | null>(null);
  const onChatPage = useRef(false);
  onChatPage.current = location.pathname.startsWith('/chat');

  const refreshUnread = useCallback(() => {
    api
      .get<{ unread: number }>('/chat/unread')
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshUnread();
    const source = new EventSource('/api/chat/events');
    const emit = (event: ChatEvent) => listeners.current.forEach((l) => l(event));

    source.addEventListener('message', (e) => {
      const message = JSON.parse((e as MessageEvent).data);
      emit({ type: 'message', message });
      if (message.senderUserId === user.userId) return;
      const viewing = active.current === message.conversationId && document.visibilityState === 'visible';
      if (!viewing) setUnread((n) => n + 1);
      if (!onChatPage.current) toast.info(`💬 ${message.senderName}: ${message.body ? message.body.slice(0, 80) : `📎 ${message.attachment?.fileName ?? 'File'}`}`);
    });
    source.addEventListener('read', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      emit({ type: 'read', ...data });
      refreshUnread();
    });
    source.addEventListener('message-updated', (e) => {
      emit({ type: 'message-updated', message: JSON.parse((e as MessageEvent).data) });
      refreshUnread(); // a deleted message no longer counts as unread
    });
    source.addEventListener('conversation', (e) => {
      emit({ type: 'conversation', ...JSON.parse((e as MessageEvent).data) });
      refreshUnread();
    });
    // Work notifications travel on the same connection (see useNotifications)
    source.addEventListener('notification', (e) => emit({ type: 'notification', notification: JSON.parse((e as MessageEvent).data) }));
    source.addEventListener('notifications-read', (e) => emit({ type: 'notifications-read', ...JSON.parse((e as MessageEvent).data) }));
    // After a dropped connection the browser reconnects by itself; catch up on what was missed
    source.addEventListener('open', refreshUnread);
    return () => source.close();
  }, [user, refreshUnread, toast]);

  // "(3) Q-WorkDone" in the browser tab while there are unread messages
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${APP_NAME}` : APP_NAME;
  }, [unread]);

  const subscribe = useCallback((listener: (event: ChatEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const setActiveConversation = useCallback((id: number | null) => {
    active.current = id;
  }, []);

  const value = useMemo<ChatState>(
    () => ({ unread, refreshUnread, subscribe, setActiveConversation }),
    [unread, refreshUnread, subscribe, setActiveConversation],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
