import React, { useState, useEffect, useRef } from 'react';
import { X, MessageSquare, Command, Trash2, Clock, Folder, FolderOpen } from 'lucide-react';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import type { Session, Theme, QueuedItem } from '../types';

interface ExecutionQueueBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: Session[];
  activeSessionId: string | null;
  theme: Theme;
  onRemoveItem: (sessionId: string, itemId: string) => void;
  onSwitchSession: (sessionId: string) => void;
}

/**
 * Modal for browsing and managing the execution queue across all sessions.
 * Supports filtering by current project vs global view.
 */
export function ExecutionQueueBrowser({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  theme,
  onRemoveItem,
  onSwitchSession
}: ExecutionQueueBrowserProps) {
  const [viewMode, setViewMode] = useState<'current' | 'global'>('current');
  const { registerLayer, unregisterLayer } = useLayerStack();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Register with layer stack for proper escape handling
  useEffect(() => {
    if (isOpen) {
      const id = registerLayer({
        type: 'modal',
        priority: MODAL_PRIORITIES.EXECUTION_QUEUE_BROWSER || 50,
        onEscape: () => onCloseRef.current()
      });
      return () => unregisterLayer(id);
    }
  }, [isOpen, registerLayer, unregisterLayer]);

  if (!isOpen) return null;

  // Get sessions with queued items
  const sessionsWithQueues = sessions.filter(s =>
    s.executionQueue && s.executionQueue.length > 0
  );

  // Filter based on view mode
  const filteredSessions = viewMode === 'current'
    ? sessionsWithQueues.filter(s => s.id === activeSessionId)
    : sessionsWithQueues;

  // Get total queue count for display
  const totalQueuedItems = sessionsWithQueues.reduce(
    (sum, s) => sum + (s.executionQueue?.length || 0),
    0
  );

  const currentSessionItems = activeSessionId
    ? sessions.find(s => s.id === activeSessionId)?.executionQueue?.length || 0
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        style={{ backdropFilter: 'blur(2px)' }}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl max-h-[80vh] rounded-lg border shadow-2xl flex flex-col"
        style={{
          backgroundColor: theme.colors.bgMain,
          borderColor: theme.colors.border
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: theme.colors.border }}
        >
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
              Execution Queue
            </h2>
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
            >
              {totalQueuedItems} total
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:opacity-80 transition-opacity"
            style={{ color: theme.colors.textDim }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View Toggle */}
        <div
          className="px-4 py-2 border-b flex items-center gap-2"
          style={{ borderColor: theme.colors.border }}
        >
          <button
            onClick={() => setViewMode('current')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
              viewMode === 'current' ? '' : 'opacity-60 hover:opacity-80'
            }`}
            style={{
              backgroundColor: viewMode === 'current' ? theme.colors.accent : 'transparent',
              color: viewMode === 'current' ? theme.colors.bgMain : theme.colors.textMain
            }}
          >
            <Folder className="w-3.5 h-3.5" />
            Current Project
            {currentSessionItems > 0 && (
              <span className="ml-1 text-xs opacity-80">({currentSessionItems})</span>
            )}
          </button>
          <button
            onClick={() => setViewMode('global')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
              viewMode === 'global' ? '' : 'opacity-60 hover:opacity-80'
            }`}
            style={{
              backgroundColor: viewMode === 'global' ? theme.colors.accent : 'transparent',
              color: viewMode === 'global' ? theme.colors.bgMain : theme.colors.textMain
            }}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            All Projects
            <span className="ml-1 text-xs opacity-80">({totalQueuedItems})</span>
          </button>
        </div>

        {/* Queue List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {filteredSessions.length === 0 ? (
            <div
              className="text-center py-12 text-sm"
              style={{ color: theme.colors.textDim }}
            >
              No items queued{viewMode === 'current' ? ' for this project' : ''}
            </div>
          ) : (
            filteredSessions.map(session => (
              <div key={session.id} className="space-y-2">
                {/* Session Header - only show in global view */}
                {viewMode === 'global' && (
                  <button
                    onClick={() => {
                      onSwitchSession(session.id);
                      onClose();
                    }}
                    className="text-sm font-medium flex items-center gap-2 hover:underline"
                    style={{ color: theme.colors.accent }}
                  >
                    <Folder className="w-3.5 h-3.5" />
                    {session.name}
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
                    >
                      {session.executionQueue?.length || 0}
                    </span>
                  </button>
                )}

                {/* Queue Items */}
                <div className="space-y-1.5">
                  {session.executionQueue?.map((item, index) => (
                    <QueueItemRow
                      key={item.id}
                      item={item}
                      index={index}
                      theme={theme}
                      onRemove={() => onRemoveItem(session.id, item.id)}
                      onSwitchToSession={() => {
                        onSwitchSession(session.id);
                        onClose();
                      }}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 border-t text-xs"
          style={{ borderColor: theme.colors.border, color: theme.colors.textDim }}
        >
          Items are processed sequentially per project to prevent file conflicts.
        </div>
      </div>
    </div>
  );
}

interface QueueItemRowProps {
  item: QueuedItem;
  index: number;
  theme: Theme;
  onRemove: () => void;
  onSwitchToSession: () => void;
}

function QueueItemRow({ item, index, theme, onRemove, onSwitchToSession }: QueueItemRowProps) {
  const isCommand = item.type === 'command';
  const displayText = isCommand
    ? item.command
    : (item.text?.length || 0) > 100
      ? item.text?.slice(0, 100) + '...'
      : item.text;

  const timeSinceQueued = Date.now() - item.timestamp;
  const minutes = Math.floor(timeSinceQueued / 60000);
  const timeDisplay = minutes < 1 ? 'Just now' : `${minutes}m ago`;

  return (
    <div
      className="flex items-start gap-3 px-3 py-2.5 rounded-lg border group"
      style={{
        backgroundColor: theme.colors.bgSidebar,
        borderColor: theme.colors.border
      }}
    >
      {/* Position indicator */}
      <span
        className="text-xs font-mono mt-0.5 w-5 text-center"
        style={{ color: theme.colors.textDim }}
      >
        #{index + 1}
      </span>

      {/* Type icon */}
      <div className="mt-0.5">
        {isCommand ? (
          <Command className="w-4 h-4" style={{ color: theme.colors.warning }} />
        ) : (
          <MessageSquare className="w-4 h-4" style={{ color: theme.colors.accent }} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {item.tabName && (
            <button
              onClick={onSwitchToSession}
              className="text-xs px-1.5 py-0.5 rounded font-mono hover:opacity-80 transition-opacity cursor-pointer"
              style={{
                backgroundColor: theme.colors.accent + '25',
                color: theme.colors.textMain
              }}
              title="Jump to this session"
            >
              {item.tabName}
            </button>
          )}
          <span
            className="text-xs flex items-center gap-1"
            style={{ color: theme.colors.textDim }}
          >
            <Clock className="w-3 h-3" />
            {timeDisplay}
          </span>
        </div>
        <div
          className={`mt-1 text-sm ${isCommand ? 'font-mono' : ''}`}
          style={{ color: theme.colors.textMain }}
        >
          {displayText}
        </div>
        {isCommand && item.commandDescription && (
          <div
            className="text-xs mt-0.5"
            style={{ color: theme.colors.textDim }}
          >
            {item.commandDescription}
          </div>
        )}
        {item.images && item.images.length > 0 && (
          <div
            className="text-xs mt-1 flex items-center gap-1"
            style={{ color: theme.colors.textDim }}
          >
            + {item.images.length} image{item.images.length > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-all"
        style={{ color: theme.colors.error }}
        title="Remove from queue"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
