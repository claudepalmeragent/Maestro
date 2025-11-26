import React from 'react';
import { FilePlus, Trash2, FileCode, FileText } from 'lucide-react';
import type { Theme, SessionState, FileChangeType } from '../types';

// Get color based on context usage percentage
export const getContextColor = (usage: number, theme: Theme): string => {
  if (usage >= 80) return theme.colors.error;
  if (usage >= 60) return theme.colors.warning;
  return theme.colors.success;
};

// Get color based on session state
// Status indicator colors:
// - Green: ready and waiting (idle)
// - Yellow: agent is thinking (busy, waiting_input)
// - Red: no connection with agent (error)
// - Pulsing orange: attempting to establish connection (connecting)
export const getStatusColor = (state: SessionState, theme: Theme): string => {
  switch (state) {
    case 'idle': return theme.colors.success;      // Green - ready and waiting
    case 'busy': return theme.colors.warning;      // Yellow - agent is thinking
    case 'waiting_input': return theme.colors.warning; // Yellow - waiting for input
    case 'error': return theme.colors.error;       // Red - no connection
    case 'connecting': return '#ff8800';           // Orange - attempting to connect
    default: return theme.colors.success;
  }
};

// Format active time for display (compact format: 1D, 2H, 30M)
export const formatActiveTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalDays > 0) {
    return `${totalDays}D`;
  } else if (totalHours > 0) {
    const remainingMinutes = totalMinutes % 60;
    if (remainingMinutes > 0) {
      return `${totalHours}H ${remainingMinutes}M`;
    }
    return `${totalHours}H`;
  } else if (totalMinutes > 0) {
    return `${totalMinutes}M`;
  } else {
    return '<1M';
  }
};

// Get file icon based on change type
export const getFileIcon = (type: FileChangeType | undefined, theme: Theme): JSX.Element => {
  switch (type) {
    case 'added': return <FilePlus className="w-3.5 h-3.5" style={{ color: theme.colors.success }} />;
    case 'deleted': return <Trash2 className="w-3.5 h-3.5" style={{ color: theme.colors.error }} />;
    case 'modified': return <FileCode className="w-3.5 h-3.5" style={{ color: theme.colors.warning }} />;
    default: return <FileText className="w-3.5 h-3.5" style={{ color: theme.colors.textDim }} />;
  }
};
