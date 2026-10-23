import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActionIcon, Alert, Button, Checkbox, Group, Stack, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { ArrowDown, ArrowLeft, Ban, FileText, MessageSquarePlus, Paperclip, Pencil, Search, Trash2, Users, UsersRound, X } from 'lucide-react';
import { PersonAvatar, Spinner } from '../components/common';
import { Modal } from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import { useChat } from '../hooks/useChat';
import { useConfirm } from '../hooks/useConfirm';
import { useDebounce } from '../hooks/useDebounce';
import { api, errorMessage, megabytes, uploadLimits } from '../services/api';
import type { ChatConversation, ChatMember, ChatMessage, ChatSearchResult, ChatUser } from '../types';
import './chat.css';

const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// ---------------------------------------------------------------- helpers
function Avatar({ name, kind, size = 40 }: { name: string; kind?: ChatConversation['kind']; size?: number }) {
  if (kind === 'Company' || kind === 'Group') {
    const Icon = kind === 'Company' ? Users : UsersRound;
    return (
      <span className="chat-icon-avatar" data-kind={kind} style={{ width: size, height: size }} aria-hidden="true">
        <Icon size={size * 0.45} strokeWidth={1.8} />
      </span>
    );
  }
  return <PersonAvatar name={name} size={size} />;
}

function shortTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Text shown in the conversation list for a message */
function preview(m: ChatMessage): string {
  if (m.deleted) return 'Message deleted';
  return m.body || (m.attachment ? `📎 ${m.attachment.fileName}` : '');
}

function subtitle(c: ChatConversation): string {
  if (c.kind === 'Company') return 'Everyone in your company';
  if (c.kind === 'Group') return `${c.memberCount} members`;
  return c.otherActive === false ? 'Inactive user' : (c.otherRole ?? '');
}

/** Wraps the first match of `term` in <mark> */
function Highlight({ text, term }: { text: string; term: string }) {
  const i = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

// ---------------------------------------------------------------- page
export function ChatPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { subscribe, setActiveConversation, refreshUnread } = useChat();
  const [params, setParams] = useSearchParams();
  const activeId = params.get('c') ? Number(params.get('c')) : null;
  const jumpTo = params.get('m') ? Number(params.get('m')) : null;

  const [conversations, setConversations] = useState<ChatConversation[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search.trim(), 300);
  const [results, setResults] = useState<ChatSearchResult[] | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<'direct' | 'group' | 'members' | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const hasNewerRef = useRef(hasNewer);
  hasNewerRef.current = hasNewer;
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const open = useCallback(
    (id: number | null, messageId?: number) =>
      setParams(id ? { c: String(id), ...(messageId ? { m: String(messageId) } : {}) } : {}, { replace: true }),
    [setParams],
  );

  const loadConversations = useCallback(async () => {
    try {
      const r = await api.get<{ items: ChatConversation[] }>('/chat/conversations');
      setConversations(r.items);
      setListError(null);
      return r.items;
    } catch (err) {
      setListError(errorMessage(err));
      return null;
    }
  }, []);

  // First load: open "Everyone" on wide screens
  useEffect(() => {
    void loadConversations().then((items) => {
      if (items && !activeRef.current && window.innerWidth > 860) open(items[0]?.conversationId ?? null);
    });
  }, [loadConversations, open]);

  // Search messages
  useEffect(() => {
    if (debouncedSearch.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    api
      .get<{ items: ChatSearchResult[] }>(`/chat/search?q=${encodeURIComponent(debouncedSearch)}`)
      .then((r) => !cancelled && setResults(r.items))
      .catch((err) => !cancelled && setListError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const markRead = useCallback(
    (conversationId: number, messageId: number) => {
      setConversations(
        (list) => list?.map((c) => (c.conversationId === conversationId ? { ...c, unread: 0, lastReadMessageId: messageId } : c)) ?? list,
      );
      api
        .post(`/chat/conversations/${conversationId}/read`, { messageId })
        .then(refreshUnread)
        .catch(() => undefined);
    },
    [refreshUnread],
  );

  // Load the thread when another conversation is opened (or a search result is jumped to)
  useEffect(() => {
    setActiveConversation(activeId);
    setMessages([]);
    setHasMore(false);
    setHasNewer(false);
    setThreadError(null);
    setEditingId(null);
    setFile(null);
    if (!activeId) return;
    let cancelled = false;
    setLoadingThread(true);
    api
      .get<{ items: ChatMessage[]; hasMore: boolean; hasNewer: boolean }>(
        `/chat/conversations/${activeId}/messages${jumpTo ? `?around=${jumpTo}&limit=40` : ''}`,
      )
      .then((r) => {
        if (cancelled) return;
        stickToBottom.current = !jumpTo;
        setMessages(r.items);
        setHasMore(r.hasMore);
        setHasNewer(r.hasNewer);
        const last = r.items[r.items.length - 1];
        if (last && !r.hasNewer) markRead(activeId, last.messageId);
        if (jumpTo) requestAnimationFrame(() => document.getElementById(`msg-${jumpTo}`)?.scrollIntoView({ block: 'center' }));
      })
      .catch((err) => !cancelled && setThreadError(errorMessage(err)))
      .finally(() => !cancelled && setLoadingThread(false));
    return () => {
      cancelled = true;
    };
  }, [activeId, jumpTo, setActiveConversation, markRead]);

  useEffect(() => () => setActiveConversation(null), [setActiveConversation]);

  // Live updates
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'conversation') {
          void loadConversations().then((items) => {
            // Removed from the open group: close it
            if (items && activeRef.current && !items.some((c) => c.conversationId === activeRef.current)) open(null);
          });
          return;
        }
        if (event.type === 'message-updated') {
          const m = event.message;
          setMessages((list) => list.map((x) => (x.messageId === m.messageId ? m : x)));
          setConversations(
            (list) =>
              list?.map((c) =>
                c.lastMessage?.messageId === m.messageId ? { ...c, lastMessage: { ...c.lastMessage, body: preview(m) } } : c,
              ) ?? list,
          );
          return;
        }
        if (event.type !== 'message') return;
        const m = event.message;
        const mine = m.senderUserId === user?.userId;
        const known = conversationsRef.current?.some((c) => c.conversationId === m.conversationId) ?? true;
        setConversations((list) => {
          if (!list) return list;
          const updated = list.map((c) =>
            c.conversationId === m.conversationId
              ? {
                  ...c,
                  lastMessage: { messageId: m.messageId, body: preview(m), senderUserId: m.senderUserId, createdAt: m.createdAt },
                  unread: mine || activeRef.current === c.conversationId ? c.unread : c.unread + 1,
                }
              : c,
          );
          // Everyone stays first; the conversation with the newest message comes next
          const everyone = updated.filter((c) => c.kind === 'Company');
          const target = updated.filter((c) => c.kind !== 'Company' && c.conversationId === m.conversationId);
          const rest = updated.filter((c) => c.kind !== 'Company' && c.conversationId !== m.conversationId);
          return [...everyone, ...target, ...rest];
        });
        if (!known) void loadConversations(); // a chat started by someone else
        // While older messages are shown (after a search jump) new ones wait behind "Jump to latest"
        if (m.conversationId === activeRef.current && !hasNewerRef.current) {
          setMessages((list) => (list.some((x) => x.messageId === m.messageId) ? list : [...list, m]));
          if (!mine && document.visibilityState === 'visible') markRead(m.conversationId, m.messageId);
        }
      }),
    [subscribe, user?.userId, loadConversations, markRead, open],
  );

  // Keep the newest message in view unless the user scrolled up to read older ones
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const loadEarlier = async () => {
    if (!activeId || !messages.length) return;
    const el = scroller.current;
    const previousHeight = el?.scrollHeight ?? 0;
    try {
      const r = await api.get<{ items: ChatMessage[]; hasMore: boolean }>(
        `/chat/conversations/${activeId}/messages?before=${messages[0].messageId}`,
      );
      stickToBottom.current = false;
      setMessages((list) => [...r.items, ...list]);
      setHasMore(r.hasMore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - previousHeight;
      });
    } catch (err) {
      setThreadError(errorMessage(err));
    }
  };

  const chooseFile = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > uploadLimits.chatFileBytes) {
      setThreadError(`Files can be at most ${megabytes(uploadLimits.chatFileBytes)}.`);
      return;
    }
    setThreadError(null);
    setFile(f);
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!activeId || (!body && !file) || sending) return;
    setSending(true);
    setThreadError(null);
    try {
      const m = file
        ? await api.upload<ChatMessage>(`/chat/conversations/${activeId}/attachments`, file, { 'X-Caption': encodeURIComponent(body) })
        : await api.post<ChatMessage>(`/chat/conversations/${activeId}/messages`, { body });
      if (hasNewer) {
        open(activeId); // back to the latest messages
      } else {
        stickToBottom.current = true;
        setMessages((list) => (list.some((x) => x.messageId === m.messageId) ? list : [...list, m]));
      }
      setDraft('');
      setFile(null);
    } catch (err) {
      setThreadError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter adds a new line
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const saveEdit = async (m: ChatMessage, body: string) => {
    try {
      const updated = await api.patch<ChatMessage>(`/chat/messages/${m.messageId}`, { body });
      setMessages((list) => list.map((x) => (x.messageId === updated.messageId ? updated : x)));
      setEditingId(null);
    } catch (err) {
      setThreadError(errorMessage(err));
    }
  };

  const removeMessage = async (m: ChatMessage) => {
    const ok = await confirm({
      title: 'Delete message',
      message: 'Delete this message for everyone in the chat?',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const updated = await api.delete<ChatMessage>(`/chat/messages/${m.messageId}`);
      setMessages((list) => list.map((x) => (x.messageId === updated.messageId ? updated : x)));
    } catch (err) {
      setThreadError(errorMessage(err));
    }
  };

  const added = (c: ChatConversation) => {
    setDialog(null);
    setConversations((list) => (list?.some((x) => x.conversationId === c.conversationId) ? list : [...(list ?? []), c]));
    open(c.conversationId);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (activeId) chooseFile(e.dataTransfer.files[0]);
  };

  const active = conversations?.find((c) => c.conversationId === activeId) ?? null;
  const inactivePeer = active?.otherActive === false;
  const totalUnread = conversations?.reduce((n, c) => n + c.unread, 0) ?? 0;

  return (
    <div className={`chat-layout ${activeId ? 'chat-thread-open' : ''}`}>
      {/* ---------- Conversation list ---------- */}
      <section className="wd-bezel chat-list">
        <div className="wd-bezel-head" style={{ paddingRight: 8 }}>
          <h1 className="wd-h2">
            Chat
            {totalUnread > 0 && <sup>{totalUnread}</sup>}
          </h1>
          <Group gap={4}>
            <Tooltip label="New group">
              <ActionIcon size={34} radius={10} className="wd-soft" style={{ background: 'var(--wd-card)', boxShadow: 'var(--wd-lift)' }} onClick={() => setDialog('group')} aria-label="New group">
                <UsersRound size={16} />
              </ActionIcon>
            </Tooltip>
            <Button size="compact-md" h={34} radius={10} className="wd-ink" leftSection={<MessageSquarePlus size={15} />} onClick={() => setDialog('direct')}>
              New chat
            </Button>
          </Group>
        </div>
        <div className="wd-card">
          <div style={{ padding: '10px 10px 2px' }}>
            <TextInput
              type="search"
              placeholder="Search messages…"
              aria-label="Search messages"
              leftSection={<Search size={15} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
          {listError && (
            <Alert color="red" variant="light" radius="md" m={10}>
              {listError}
            </Alert>
          )}

          {results ? (
            <ul className="chat-conversations">
              {results.length === 0 && <li className="chat-hint">No messages found.</li>}
              {results.map((r) => (
                <li key={r.message.messageId}>
                  <button className="chat-conversation" onClick={() => open(r.message.conversationId, r.message.messageId)}>
                    <Avatar name={r.conversationTitle} kind={r.kind} />
                    <span className="chat-conversation-text">
                      <span className="chat-conversation-top">
                        <strong>{r.conversationTitle}</strong>
                        <span className="chat-time">{shortTime(r.message.createdAt)}</span>
                      </span>
                      <span className="chat-preview">
                        {r.message.senderName}: <Highlight text={preview(r.message)} term={debouncedSearch} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : !conversations ? (
            <Spinner />
          ) : (
            <ul className="chat-conversations">
              {conversations.map((c) => (
                <li key={c.conversationId}>
                  <button
                    className={`chat-conversation ${c.conversationId === activeId ? 'active' : ''}`}
                    onClick={() => open(c.conversationId)}
                  >
                    <Avatar name={c.title} kind={c.kind} />
                    <span className="chat-conversation-text">
                      <span className="chat-conversation-top">
                        <strong>{c.title}</strong>
                        <span className="chat-time">{shortTime(c.lastMessage?.createdAt)}</span>
                      </span>
                      <span className="chat-conversation-bottom">
                        <span className="chat-preview">
                          {c.lastMessage
                            ? `${c.lastMessage.senderUserId === user?.userId ? 'You: ' : ''}${c.lastMessage.body}`
                            : c.kind === 'Company'
                              ? 'Messages to everyone in your company'
                              : 'No messages yet'}
                        </span>
                        {c.unread > 0 && c.conversationId !== activeId && (
                          <span className="chat-unread">{c.unread > 99 ? '99+' : c.unread}</span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---------- Thread ---------- */}
      <section
        className={`wd-bezel chat-thread ${dragging ? 'chat-dragging' : ''}`}
        onDragOver={(e) => {
          if (!active || inactivePeer) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
        onDrop={onDrop}
      >
        {!active ? (
          <div className="wd-card">
            <div className="chat-empty">
              <h2 className="wd-title" style={{ fontSize: 40 }}>
                Pick a conversation<span className="wd-period">.</span>
              </h2>
              <Text c="dimmed" fz={15}>
                Or start a new chat or group from the left.
              </Text>
            </div>
          </div>
        ) : (
          <>
            <header className="chat-thread-head">
              <ActionIcon className="chat-back wd-soft" size={36} radius={10} onClick={() => open(null)} aria-label="Back to conversations" style={{ background: 'var(--wd-card)' }}>
                <ArrowLeft size={16} />
              </ActionIcon>
              <Avatar name={active.title} kind={active.kind} size={42} />
              <div className="chat-thread-title">
                <div className="wd-h3" style={{ margin: 0, fontSize: 24, lineHeight: 1.1 }}>
                  {active.title}
                </div>
                <Text size="xs" c="dimmed" mt={2}>
                  {subtitle(active)}
                </Text>
              </div>
              {active.kind === 'Group' && (
                <Button className="wd-soft" h={36} radius={10} leftSection={<UsersRound size={15} />} onClick={() => setDialog('members')} style={{ background: 'var(--wd-card)' }}>
                  Members
                </Button>
              )}
            </header>

            <div className="wd-card">
              <div
                className="chat-messages"
                ref={scroller}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  stickToBottom.current = !hasNewer && el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
              >
                {hasMore && (
                  <Button size="compact-sm" className="wd-soft chat-earlier" onClick={() => void loadEarlier()}>
                    Load earlier messages
                  </Button>
                )}
                {loadingThread && <Spinner />}
                {!loadingThread && messages.length === 0 && !threadError && (
                  <div className="chat-empty" style={{ paddingTop: 64 }}>
                    <div className="wd-h3" style={{ margin: 0 }}>
                      No messages yet.
                    </div>
                    <Text c="dimmed">Say hello to start the conversation.</Text>
                  </div>
                )}
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                  return (
                    <div key={m.messageId}>
                      {newDay && <div className="chat-day">{dayLabel(m.createdAt)}</div>}
                      <MessageBubble
                        message={m}
                        mine={m.senderUserId === user?.userId}
                        grouped={!newDay && prev?.senderUserId === m.senderUserId}
                        showName={active.kind !== 'Direct'}
                        highlighted={m.messageId === jumpTo}
                        canDelete={!m.deleted && (m.senderUserId === user?.userId || user?.role === 'Admin')}
                        editing={editingId === m.messageId}
                        onEdit={() => setEditingId(m.messageId)}
                        onCancelEdit={() => setEditingId(null)}
                        onSave={(body) => void saveEdit(m, body)}
                        onDelete={() => void removeMessage(m)}
                        onMediaLoad={() => {
                          // Images change the height after loading: stay at the newest message
                          const el = scroller.current;
                          if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {hasNewer && (
              <Button size="compact-md" className="chat-latest" rightSection={<ArrowDown size={14} />} onClick={() => open(activeId)}>
                Jump to latest
              </Button>
            )}

            {threadError && (
              <Alert color="red" variant="light" radius="md" mt={8} mx={6}>
                {threadError}
              </Alert>
            )}
            {file && (
              <div className="chat-file-chip">
                <Paperclip size={14} />
                <span>{file.name}</span>
                <Text span size="xs" c="dimmed">
                  {fileSize(file.size)}
                </Text>
                <ActionIcon variant="subtle" color="gray" radius="xl" size={26} onClick={() => setFile(null)} aria-label="Remove file">
                  <X size={14} />
                </ActionIcon>
              </div>
            )}
            <form className="chat-composer" onSubmit={send}>
              <input
                ref={fileInput}
                type="file"
                hidden
                onChange={(e) => {
                  chooseFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <Tooltip label={`Attach a file (max ${megabytes(uploadLimits.chatFileBytes)})`}>
                <ActionIcon
                  size={44}
                  radius={14}
                  className="wd-soft"
                  style={{ background: 'var(--wd-card)' }}
                  onClick={() => fileInput.current?.click()}
                  disabled={inactivePeer}
                  aria-label="Attach a file"
                >
                  <Paperclip size={17} />
                </ActionIcon>
              </Tooltip>
              <Textarea
                style={{ flex: 1 }}
                size="md"
                autosize
                minRows={1}
                maxRows={5}
                placeholder={inactivePeer ? 'This user is inactive' : file ? 'Add a caption (optional)…' : 'Type a message…'}
                aria-label="Message"
                value={draft}
                maxLength={2000}
                disabled={inactivePeer}
                onChange={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={onComposerKey}
                onPaste={(e) => {
                  const pasted = e.clipboardData.files[0];
                  if (pasted) {
                    e.preventDefault();
                    chooseFile(pasted);
                  }
                }}
              />
              <Button type="submit" size="md" radius={14} className="wd-ink" loading={sending} disabled={(!draft.trim() && !file) || inactivePeer}>
                Send
              </Button>
            </form>
            {dragging && <div className="chat-drop-hint">Drop the file to send it</div>}
          </>
        )}
      </section>

      {dialog === 'direct' && <UserPicker onClose={() => setDialog(null)} onDone={added} />}
      {dialog === 'group' && <GroupDialog onClose={() => setDialog(null)} onDone={added} />}
      {dialog === 'members' && active && (
        <MembersDialog
          conversation={active}
          onClose={() => setDialog(null)}
          onLeft={() => {
            setDialog(null);
            open(null);
            void loadConversations();
          }}
          onChanged={() => void loadConversations()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- message bubble
interface BubbleProps {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  showName: boolean;
  highlighted: boolean;
  canDelete: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (body: string) => void;
  onDelete: () => void;
  onMediaLoad: () => void;
}

function MessageBubble({
  message: m,
  mine,
  grouped,
  showName,
  highlighted,
  canDelete,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onMediaLoad,
}: BubbleProps) {
  const [text, setText] = useState(m.body);
  useEffect(() => setText(m.body), [m.body, editing]);
  const a = m.attachment;
  const url = a ? `/api/chat/attachments/${a.attachmentId}` : '';
  const rowClass = ['chat-bubble-row', mine && 'mine', grouped && 'grouped', highlighted && 'highlighted'].filter(Boolean).join(' ');

  return (
    <div id={`msg-${m.messageId}`} className={rowClass}>
      <div className={`chat-bubble ${m.deleted ? 'deleted' : ''}`}>
        {showName && !mine && !grouped && <div className="chat-sender">{m.senderName}</div>}
        {m.deleted ? (
          <div className="chat-deleted">
            <Ban size={13} /> This message was deleted
          </div>
        ) : (
          <>
            {a &&
              (INLINE_IMAGES.has(a.contentType) ? (
                <a href={url} target="_blank" rel="noreferrer" className="chat-image">
                  <img src={url} alt={a.fileName} loading="lazy" onLoad={onMediaLoad} />
                </a>
              ) : (
                <a href={`${url}?download=1`} download={a.fileName} className="chat-file">
                  <FileText size={22} strokeWidth={1.6} />
                  <span className="chat-file-text">
                    <strong>{a.fileName}</strong>
                    <span>{fileSize(a.size)} · Download</span>
                  </span>
                </a>
              ))}
            {editing ? (
              <form
                className="chat-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  onSave(text.trim());
                }}
              >
                <Textarea
                  autoFocus
                  autosize
                  minRows={2}
                  value={text}
                  maxLength={2000}
                  aria-label="Edit message"
                  onChange={(e) => setText(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') onCancelEdit();
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onSave(text.trim());
                    }
                  }}
                  styles={{ input: { background: 'var(--wd-card)', color: 'var(--mantine-color-text)' } }}
                />
                <Group justify="flex-end" gap={6}>
                  <Button size="compact-sm" className="wd-soft" onClick={onCancelEdit}>
                    Cancel
                  </Button>
                  <Button size="compact-sm" type="submit" disabled={!text.trim() && !a}>
                    Save
                  </Button>
                </Group>
              </form>
            ) : (
              m.body && <div className="chat-body">{m.body}</div>
            )}
          </>
        )}
        <div className="chat-stamp">
          {m.editedAt && !m.deleted && <span>edited · </span>}
          {shortTime(m.createdAt)}
        </div>
      </div>
      {!editing && !m.deleted && (mine || canDelete) && (
        <div className="chat-actions">
          {mine && (
            <Tooltip label="Edit">
              <ActionIcon variant="subtle" color="gray" radius="xl" size={30} onClick={onEdit} aria-label="Edit message">
                <Pencil size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip label="Delete">
              <ActionIcon variant="subtle" color="red" radius="xl" size={30} onClick={onDelete} aria-label="Delete message">
                <Trash2 size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- dialogs
function usePeople() {
  const [users, setUsers] = useState<ChatUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<{ items: ChatUser[] }>('/chat/users')
      .then((r) => setUsers(r.items))
      .catch((err) => setError(errorMessage(err)));
  }, []);
  return { users, error };
}

function PeopleSearch({
  users,
  selected,
  onToggle,
  exclude,
}: {
  users: ChatUser[];
  selected?: Set<number>;
  onToggle: (u: ChatUser) => void;
  exclude?: number[];
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) => !exclude?.includes(u.userId) && (!q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)),
    );
  }, [users, search, exclude]);
  return (
    <>
      <TextInput
        placeholder="Search people…"
        leftSection={<Search size={15} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        aria-label="Search people"
      />
      {filtered.length === 0 && <Text c="dimmed">No one found.</Text>}
      <ul className="chat-people">
        {filtered.map((u) => (
          <li key={u.userId}>
            <button type="button" className={`chat-person ${selected?.has(u.userId) ? 'selected' : ''}`} onClick={() => onToggle(u)}>
              <Avatar name={u.name} size={34} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <Text fw={500} truncate>
                  {u.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {u.role}
                </Text>
              </span>
              {selected && <Checkbox readOnly checked={selected.has(u.userId)} tabIndex={-1} radius="sm" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function UserPicker({ onDone, onClose }: { onDone: (c: ChatConversation) => void; onClose: () => void }) {
  const { users, error } = usePeople();
  const [failed, setFailed] = useState<string | null>(null);
  const pick = async (u: ChatUser) => {
    try {
      onDone(await api.post<ChatConversation>('/chat/direct', { userId: u.userId }));
    } catch (err) {
      setFailed(errorMessage(err));
    }
  };
  return (
    <Modal title="New chat" onClose={onClose} size="sm">
      <Stack gap="sm">
        {(error || failed) && (
          <Alert color="red" variant="light" radius="md">
            {error ?? failed}
          </Alert>
        )}
        {!users && !error ? <Spinner /> : users && <PeopleSearch users={users} onToggle={(u) => void pick(u)} />}
      </Stack>
    </Modal>
  );
}

function GroupDialog({ onDone, onClose }: { onDone: (c: ChatConversation) => void; onClose: () => void }) {
  const { users, error } = usePeople();
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState(new Set<number>());
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (u: ChatUser) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(u.userId)) next.delete(u.userId);
      else next.add(u.userId);
      return next;
    });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      onDone(await api.post<ChatConversation>('/chat/groups', { title: title.trim(), memberIds: [...selected] }));
    } catch (err) {
      setFailed(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal title="New group" onClose={onClose} size="sm">
      <form onSubmit={create}>
        <Stack gap="sm">
          {(error || failed) && (
            <Alert color="red" variant="light" radius="md">
              {error ?? failed}
            </Alert>
          )}
          <TextInput
            label="Group name"
            data-autofocus
            placeholder="e.g. Accounts team"
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
          <Text size="xs" c="dimmed">
            {selected.size} selected
          </Text>
          {!users && !error ? <Spinner /> : users && <PeopleSearch users={users} selected={selected} onToggle={toggle} />}
          <Group justify="flex-end" gap="xs" mt="xs">
            <Button className="wd-soft" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!title.trim() || selected.size === 0}>
              Create group
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function MembersDialog({
  conversation,
  onClose,
  onLeft,
  onChanged,
}: {
  conversation: ChatConversation;
  onClose: () => void;
  onLeft: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [members, setMembers] = useState<ChatMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const { users } = usePeople();
  const canManage = conversation.createdByUserId === user?.userId || user?.role === 'Admin';
  const id = conversation.conversationId;
  const memberIds = useMemo(() => members?.map((m) => m.userId) ?? [], [members]);

  const load = useCallback(() => {
    api
      .get<{ items: ChatMember[] }>(`/chat/conversations/${id}/members`)
      .then((r) => setMembers(r.items))
      .catch((err) => setError(errorMessage(err)));
  }, [id]);
  useEffect(load, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (m: ChatMember) => {
    const ok = await confirm({
      title: 'Remove member',
      message: `Remove ${m.name} from "${conversation.title}"?`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (ok) await run(() => api.delete(`/chat/groups/${id}/members/${m.userId}`));
  };

  const leave = async () => {
    const ok = await confirm({
      title: 'Leave group',
      message: `Leave "${conversation.title}"? You will no longer see its messages.`,
      confirmLabel: 'Leave',
      danger: true,
    });
    if (!ok || !user) return;
    try {
      await api.delete(`/chat/groups/${id}/members/${user.userId}`);
      onLeft();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal title={conversation.title} onClose={onClose} size="sm">
      <Stack gap="sm">
        {error && (
          <Alert color="red" variant="light" radius="md">
            {error}
          </Alert>
        )}
        {canManage && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.patch(`/chat/groups/${id}`, { title: title.trim() }));
            }}
          >
            <Group gap={8} align="flex-end" wrap="nowrap">
              <TextInput label="Group name" value={title} maxLength={100} onChange={(e) => setTitle(e.currentTarget.value)} style={{ flex: 1 }} />
              <Button type="submit" className="wd-soft" disabled={!title.trim() || title.trim() === conversation.title}>
                Rename
              </Button>
            </Group>
          </form>
        )}
        <Text className="wd-eyebrow" fz={12} mt={4}>
          Members{members ? ` · ${members.length}` : ''}
        </Text>
        {!members ? (
          <Spinner />
        ) : (
          <ul className="chat-people">
            {members.map((m) => (
              <li key={m.userId} className="chat-member">
                <Avatar name={m.name} size={34} />
                <span className="chat-member-name">
                  <Text fw={500} truncate>
                    {m.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {m.role}
                    {m.isCreator && ' · created the group'}
                    {!m.isActive && ' · inactive'}
                  </Text>
                </span>
                {canManage && m.userId !== user?.userId && (
                  <Button size="compact-sm" variant="subtle" color="red" onClick={() => void remove(m)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage &&
          (adding ? (
            users && (
              <Stack gap="xs" p="sm" style={{ background: 'var(--wd-surface)', borderRadius: 16 }}>
                <Text fw={600}>Add people</Text>
                <PeopleSearch
                  users={users}
                  exclude={memberIds}
                  onToggle={(u) => void run(() => api.post(`/chat/groups/${id}/members`, { userIds: [u.userId] }))}
                />
              </Stack>
            )
          ) : (
            <Button className="wd-soft" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>
              + Add people
            </Button>
          ))}
        <Group justify="space-between" mt="sm">
          <Button variant="subtle" color="red" onClick={() => void leave()}>
            Leave group
          </Button>
          <Button className="wd-soft" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
