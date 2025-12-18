/**
 * GroupChatInfoOverlay.tsx
 *
 * Info overlay for displaying Group Chat metadata, paths, and session IDs.
 * Provides copy-to-clipboard functionality for IDs and paths, and
 * an "Open in Finder" button for the chat directory.
 */

import { useRef, useCallback } from 'react';
import { Copy, FolderOpen } from 'lucide-react';
import type { Theme, GroupChat } from '../types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal } from './ui/Modal';

interface GroupChatInfoOverlayProps {
  theme: Theme;
  isOpen: boolean;
  groupChat: GroupChat;
  onClose: () => void;
}

/**
 * Individual info row with label, value, and optional copy button
 */
interface InfoRowProps {
  theme: Theme;
  label: string;
  value: string;
  onCopy?: () => void;
}

function InfoRow({ theme, label, value, onCopy }: InfoRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span
        className="text-sm shrink-0"
        style={{ color: theme.colors.textDim }}
      >
        {label}
      </span>
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="text-sm font-mono truncate text-right"
          style={{ color: theme.colors.textMain }}
          title={value}
        >
          {value}
        </span>
        {onCopy && (
          <button
            onClick={onCopy}
            className="p-1 rounded hover:bg-white/10 transition-colors shrink-0"
            style={{ color: theme.colors.textDim }}
            title="Copy to clipboard"
          >
            <Copy className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export function GroupChatInfoOverlay({
  theme,
  isOpen,
  groupChat,
  onClose,
}: GroupChatInfoOverlayProps): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const openInFinder = useCallback(() => {
    // Get the parent directory (remove /images from path)
    const chatDir = groupChat.imagesDir.replace(/\/images\/?$/, '');
    window.maestro.shell.openExternal(`file://${chatDir}`);
  }, [groupChat.imagesDir]);

  if (!isOpen) return null;

  return (
    <Modal
      theme={theme}
      title="Group Chat Info"
      priority={MODAL_PRIORITIES.GROUP_CHAT_INFO}
      onClose={onClose}
      width={520}
      closeOnBackdropClick
    >
      <div ref={containerRef} className="space-y-1">
        <InfoRow
          theme={theme}
          label="Group Chat ID"
          value={groupChat.id}
          onCopy={() => copyToClipboard(groupChat.id)}
        />

        <InfoRow
          theme={theme}
          label="Created"
          value={new Date(groupChat.createdAt).toLocaleString()}
        />

        <InfoRow
          theme={theme}
          label="Chat Log"
          value={groupChat.logPath}
          onCopy={() => copyToClipboard(groupChat.logPath)}
        />

        <InfoRow
          theme={theme}
          label="Images Directory"
          value={groupChat.imagesDir}
          onCopy={() => copyToClipboard(groupChat.imagesDir)}
        />

        <div
          className="border-t my-3"
          style={{ borderColor: theme.colors.border }}
        />

        <InfoRow
          theme={theme}
          label="Moderator Agent"
          value={groupChat.moderatorAgentId}
        />

        <InfoRow
          theme={theme}
          label="Moderator Session"
          value={groupChat.moderatorSessionId || 'Not started'}
          onCopy={
            groupChat.moderatorSessionId
              ? () => copyToClipboard(groupChat.moderatorSessionId)
              : undefined
          }
        />

        {groupChat.participants.length > 0 && (
          <>
            <div
              className="border-t my-3"
              style={{ borderColor: theme.colors.border }}
            />

            <div className="pt-1">
              <span
                className="text-sm font-medium"
                style={{ color: theme.colors.textMain }}
              >
                Participant Sessions
              </span>
              <div className="mt-2 space-y-1">
                {groupChat.participants.map((p) => (
                  <InfoRow
                    key={p.sessionId}
                    theme={theme}
                    label={p.name}
                    value={p.sessionId}
                    onCopy={() => copyToClipboard(p.sessionId)}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        <div
          className="border-t mt-4 pt-4"
          style={{ borderColor: theme.colors.border }}
        >
          <button
            onClick={openInFinder}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm hover:bg-white/5 transition-colors border"
            style={{
              borderColor: theme.colors.border,
              color: theme.colors.textMain,
            }}
          >
            <FolderOpen className="w-4 h-4" />
            Open in Finder
          </button>
        </div>
      </div>
    </Modal>
  );
}
