import { useCallback, useEffect, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ActionIcon, Anchor, Box, Button, Drawer, FileButton, Group, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { ArrowRight, Check, FileText, Image as ImageIcon, Paperclip, Pencil, Repeat, Trash2, Upload, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../hooks/useToast';
import { api, ApiError, errorMessage, megabytes, uploadLimits } from '../services/api';
import type { HistoryEntry, MentionableUser, WorkAttachment, WorkDetail, WorkStatus } from '../types';
import { formatDate, formatDateTime, relativeTime } from '../utils/format';
import { DueChip, ErrorBanner, PersonAvatar, PriorityMark, Spinner, STATUS_DOT, StatusBadge } from './common';
import { MentionInput, withMentions } from './MentionInput';
import { Modal } from './Modal';

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ACTION_LABEL: Partial<Record<WorkStatus, string>> = {
  'In Progress': 'Start / Resume',
  'On Hold': 'Put on hold',
  Completed: 'Mark completed',
  Closed: 'Close work',
  Reopened: 'Reopen',
};
/** The forward step gets the blue button */
const PRIMARY: WorkStatus[] = ['Completed', 'Closed'];

interface Props {
  workId: number;
  onClose: () => void;
  /** Called after any change so the list can refresh */
  onChanged: () => void;
}

export function WorkDetailPanel({ workId, onClose, onChanged }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const { hasRole } = useAuth();
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<WorkStatus | null>(null);
  const [people, setPeople] = useState<MentionableUser[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    api
      .get<{ items: MentionableUser[] }>(`/work-items/${workId}/mentionable`)
      .then((r) => setPeople(r.items))
      .catch(() => setPeople([]));
  }, [workId]);

  const upload = async (files: File[]) => {
    if (!work || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > uploadLimits.workFileBytes) {
          toast.error(`${file.name} is larger than ${megabytes(uploadLimits.workFileBytes)}.`);
          continue;
        }
        setWork(await api.upload<WorkDetail>(`/work-items/${work.workId}/attachments`, file));
        toast.success(`${file.name} attached`);
      }
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (file: WorkAttachment) => {
    const ok = await confirm({ title: 'Remove file', message: `Remove "${file.fileName}" from this work item?`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      setWork(await api.delete<WorkDetail>(`/work-attachments/${file.attachmentId}`));
      toast.success('File removed');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (work?.canAttach) void upload([...e.dataTransfer.files]);
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      setWork(await api.get<WorkDetail>(`/work-items/${workId}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [workId]);

  useEffect(() => {
    setWork(null);
    void load();
  }, [load]);

  const changeStatus = async (status: WorkStatus, notes: string) => {
    if (!work) return;
    setBusy(true);
    try {
      const updated = await api.patch<WorkDetail>(`/work-items/${work.workId}/status`, {
        status,
        notes: notes.trim() || null,
        rowVersion: work.rowVersion,
      });
      setWork(updated);
      setPendingStatus(null);
      toast.success(`Status changed to ${status}`);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
      if (err instanceof ApiError && err.status === 409) {
        setPendingStatus(null);
        void load();
      }
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!work || !note.trim() || busy) return;
    setBusy(true);
    try {
      setWork(await api.post<WorkDetail>(`/work-items/${work.workId}/notes`, { notes: note.trim() }));
      setNote('');
      toast.success('Note added');
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const done = work?.status === 'Completed' || work?.status === 'Closed';

  return (
    <>
      <Drawer
        opened
        onClose={onClose}
        position="right"
        size={600}
        offset={12}
        radius={28}
        withCloseButton={false}
        closeOnEscape={!pendingStatus}
        aria-label="Work details"
        styles={{
          content: { background: 'var(--wd-surface)', display: 'flex', flexDirection: 'column' },
          body: { padding: 6, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
        }}
      >
        <Group justify="space-between" wrap="nowrap" px={10} pt={4} pb={10}>
          <Text className="wd-mono" c="dimmed" truncate>
            {work ? `${work.workNo} · Created ${formatDate(work.createdAt.slice(0, 10))} by ${work.createdByName}` : 'Loading…'}
          </Text>
          <Group gap={4} wrap="nowrap">
            {work?.canEdit && (
              <Tooltip label="Edit & assign">
                <ActionIcon component={Link} to={`/work/${work.workId}/edit`} variant="subtle" color="gray" size={34} radius={10} aria-label="Edit work">
                  <Pencil size={15} />
                </ActionIcon>
              </Tooltip>
            )}
            <ActionIcon onClick={onClose} size={34} radius={10} aria-label="Close details" style={{ background: 'var(--wd-card)', color: 'var(--mantine-color-text)' }}>
              <X size={16} />
            </ActionIcon>
          </Group>
        </Group>

        <Box
          className={`wd-card ${dragging ? 'wd-file-drop' : ''}`}
          style={{ flex: 1, minHeight: 0, overflow: 'auto', borderRadius: 22 }}
          p={26}
          onDragOver={(e) => {
            if (!work?.canAttach || !e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
          onDrop={onDrop}
        >
          {error && <ErrorBanner message={error} onRetry={load} />}
          {!work && !error && <Spinner />}
          {work && (
            <Stack gap={26}>
              <div>
                <Group gap={8}>
                  <StatusBadge status={work.status} />
                  <span className="wd-status">
                    <PriorityMark priority={work.priority} />
                  </span>
                  {work.dueDate && <DueChip dueDate={work.dueDate} isOverdue={work.isOverdue} done={done} />}
                  {work.recurringFrequency && (
                    <Tooltip label="Created from repeating work" withArrow>
                      <span className="wd-status">
                        <Repeat size={13} />
                        {hasRole('Admin', 'Manager') ? (
                          <Anchor component={Link} to="/recurring" c="inherit" fz="inherit">
                            Repeats {work.recurringFrequency.toLowerCase()}
                          </Anchor>
                        ) : (
                          `Repeats ${work.recurringFrequency.toLowerCase()}`
                        )}
                      </span>
                    </Tooltip>
                  )}
                </Group>
                <h2 className="wd-title" style={{ fontSize: 38, lineHeight: 1.08, marginTop: 16 }}>
                  {work.title}
                </h2>
              </div>

              {(work.allowedTransitions.length > 0 || work.canEdit) && (
                <Group gap={8}>
                  {work.allowedTransitions.map((s) => (
                    <Button
                      key={s}
                      h={40}
                      className={PRIMARY.includes(s) ? undefined : 'wd-soft'}
                      leftSection={PRIMARY.includes(s) ? <Check size={16} /> : undefined}
                      disabled={busy}
                      onClick={() => setPendingStatus(s)}
                    >
                      {ACTION_LABEL[s] ?? s}
                    </Button>
                  ))}
                  {work.canEdit && (
                    <Button component={Link} to={`/work/${work.workId}/edit`} h={40} className="wd-soft">
                      Edit &amp; assign
                    </Button>
                  )}
                </Group>
              )}

              <dl className="wd-props">
                <Prop k="Product" v={work.productName ?? '—'} />
                <Prop k="Product group" v={work.groupName ?? '—'} />
                <Prop k="Start date" v={formatDate(work.startDate)} />
                <Prop k="Due date" v={formatDate(work.dueDate)} />
                <Prop k="Last update" v={formatDateTime(work.updatedAt)} />
                <Prop k="Closed" v={work.closedAt ? formatDateTime(work.closedAt) : '—'} />
              </dl>

              <div>
                <h3 className="wd-h3">Description</h3>
                {work.description ? (
                  <Text lh={1.65} style={{ whiteSpace: 'pre-wrap' }}>
                    {work.description}
                  </Text>
                ) : (
                  <Text c="dimmed">No description.</Text>
                )}
              </div>

              <div>
                <h3 className="wd-h3">
                  People
                  <sup style={{ fontFamily: 'var(--mantine-font-family)', fontSize: 11, color: 'var(--wd-muted)', marginLeft: 3 }}>{work.assignees.length}</sup>
                </h3>
                {work.assignees.length === 0 ? (
                  <Text c="dimmed">Not assigned yet.</Text>
                ) : (
                  <Group gap={8}>
                    {work.assignees.map((a) => (
                      <Tooltip
                        key={a.employeeId}
                        label={`Assigned ${formatDateTime(a.assignedAt)}${a.assignedByName ? ` by ${a.assignedByName}` : ''}`}
                        withArrow
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '5px 14px 5px 5px', borderRadius: 999, background: 'var(--wd-surface)' }}>
                          <PersonAvatar name={a.employeeName} size={28} />
                          <Text fw={500}>{a.employeeName}</Text>
                          <Text className="wd-mono" c="dimmed" fz={11}>
                            {a.employeeCode}
                          </Text>
                        </span>
                      </Tooltip>
                    ))}
                  </Group>
                )}
              </div>

              <div>
                <Group justify="space-between" mb={10}>
                  <h3 className="wd-h3" style={{ margin: 0 }}>
                    Files
                    <sup style={{ fontFamily: 'var(--mantine-font-family)', fontSize: 11, color: 'var(--wd-muted)', marginLeft: 3 }}>{work.attachments.length}</sup>
                  </h3>
                  {work.canAttach && (
                    <FileButton onChange={(files) => void upload(files)} multiple>
                      {(props) => (
                        <Button {...props} size="xs" className="wd-soft" leftSection={<Upload size={14} />} loading={uploading}>
                          Add file
                        </Button>
                      )}
                    </FileButton>
                  )}
                </Group>
                {work.attachments.length === 0 ? (
                  <Text c="dimmed">{work.canAttach ? `No files yet. Drop files here or use “Add file” (up to ${megabytes(uploadLimits.workFileBytes)} each).` : 'No files.'}</Text>
                ) : (
                  <Stack gap={6}>
                    {work.attachments.map((f) => (
                      <div key={f.attachmentId} className="wd-file">
                        {f.contentType.startsWith('image/') ? <ImageIcon size={18} /> : f.contentType === 'application/pdf' ? <FileText size={18} /> : <Paperclip size={18} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Anchor href={`/api/work-attachments/${f.attachmentId}?download=1`} fw={500} c="var(--mantine-color-text)" truncate="end" display="block">
                            {f.fileName}
                          </Anchor>
                          <Text size="xs" c="dimmed">
                            {fileSize(f.size)} · {f.uploadedByName} · {relativeTime(f.createdAt)}
                          </Text>
                        </div>
                        {f.canDelete && (
                          <ActionIcon variant="subtle" color="gray" radius="xl" aria-label={`Remove ${f.fileName}`} onClick={() => void removeFile(f)}>
                            <Trash2 size={15} />
                          </ActionIcon>
                        )}
                      </div>
                    ))}
                  </Stack>
                )}
              </div>

              <div>
                <h3 className="wd-h3" style={{ marginBottom: 14 }}>
                  Activity
                </h3>
                <ol className="wd-timeline">
                  {work.history.map((h) => (
                    <HistoryItem key={h.historyId} entry={h} />
                  ))}
                </ol>
              </div>
            </Stack>
          )}
        </Box>

        {work && (
          <form onSubmit={addNote} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 4px 2px' }}>
            <MentionInput value={note} onChange={setNote} people={people} onSubmit={() => void addNote()} placeholder="Add a note… type @ to mention someone" />
            <Button type="submit" size="md" radius={14} className="wd-ink" disabled={busy || !note.trim()}>
              Add note
            </Button>
          </form>
        )}
      </Drawer>

      {pendingStatus && work && (
        <StatusModal
          from={work.status}
          to={pendingStatus}
          notesRequired={work.notesRequiredFor.includes(pendingStatus)}
          busy={busy}
          onCancel={() => setPendingStatus(null)}
          onConfirm={(notes) => changeStatus(pendingStatus, notes)}
        />
      )}
    </>
  );
}

function Prop({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function HistoryItem({ entry: h }: { entry: HistoryEntry }) {
  let what: string;
  switch (h.entryType) {
    case 'Created':
      what = 'created the work item';
      break;
    case 'StatusChange':
      what = `moved ${h.oldStatus ? `${h.oldStatus} → ` : 'to '}${h.newStatus}`;
      break;
    case 'Assignment':
      what = 'updated the assignment';
      break;
    case 'Edit':
      what = 'edited the details';
      break;
    case 'Attachment':
      what = (h.notes ?? 'attached a file').replace(/^Attached/, 'attached').replace(/^Removed/, 'removed');
      break;
    default:
      what = 'added a note';
  }
  const color = h.entryType === 'StatusChange' ? STATUS_DOT[h.newStatus] : h.entryType === 'Created' ? '#12A150' : '#9B9A96';
  const showNote = h.notes && h.entryType !== 'Created' && h.entryType !== 'Edit' && h.entryType !== 'Attachment';
  if (h.entryType === 'Created' && h.notes?.includes('repeating')) what = 'created it from repeating work';
  return (
    <li>
      <div className="wd-timeline-rail">
        <span className="wd-dot" style={{ '--dot': color, width: 7, height: 7 } as CSSProperties} />
      </div>
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 20 }}>
        <Group justify="space-between" gap={12} wrap="nowrap" align="flex-start">
          <Text>
            <Text span fw={600}>
              {h.changedByName}
            </Text>{' '}
            <Text span c="dimmed">
              {what}
            </Text>
          </Text>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }} title={formatDateTime(h.changedAt)}>
            {relativeTime(h.changedAt)}
          </Text>
        </Group>
        {showNote && <div className="wd-quote">“{withMentions(h.notes!)}”</div>}
      </div>
    </li>
  );
}

function StatusModal({
  from,
  to,
  notesRequired,
  busy,
  onCancel,
  onConfirm,
}: {
  from: WorkStatus;
  to: WorkStatus;
  notesRequired: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (notes: string) => void;
}) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (notesRequired && !notes.trim()) {
      setError('Please explain the reason.');
      return;
    }
    onConfirm(notes);
  };

  return (
    <Modal
      title={ACTION_LABEL[to] ?? `Change to ${to}`}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button className="wd-soft" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="status-form" loading={busy}>
            Confirm
          </Button>
        </>
      }
    >
      <form id="status-form" onSubmit={submit}>
        <Stack gap="md">
          <Group gap="xs">
            <StatusBadge status={from} />
            <ArrowRight size={14} />
            <StatusBadge status={to} />
          </Group>
          <Textarea
            label={notesRequired ? 'Reason (required)' : 'Note (optional)'}
            autosize
            minRows={3}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            error={error}
            data-autofocus
          />
        </Stack>
      </form>
    </Modal>
  );
}
