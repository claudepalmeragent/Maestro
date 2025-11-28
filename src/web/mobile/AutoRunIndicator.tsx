/**
 * AutoRunIndicator component for mobile web interface
 *
 * Displays a banner when AutoRun (batch processing) is active on the desktop app.
 * Shows task progress and indicates that AI input is in read-only mode.
 */

import { useThemeColors } from '../components/ThemeProvider';
import type { AutoRunState } from '../hooks/useWebSocket';

interface AutoRunIndicatorProps {
  /** AutoRun state from WebSocket - null when not running */
  state: AutoRunState | null;
  /** Name of the session running AutoRun */
  sessionName?: string;
}

/**
 * AutoRun indicator banner component
 * Shows task progress when batch processing is active
 */
export function AutoRunIndicator({ state, sessionName }: AutoRunIndicatorProps) {
  const colors = useThemeColors();

  // Don't render if no state or not running
  if (!state?.isRunning) {
    return null;
  }

  const { totalTasks, completedTasks, currentTaskIndex, isStopping } = state;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const currentTask = currentTaskIndex + 1;

  return (
    <div
      style={{
        backgroundColor: isStopping ? `${colors.warning}15` : `${colors.accent}15`,
        borderBottom: `1px solid ${isStopping ? colors.warning : colors.accent}`,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      {/* Animated indicator icon */}
      <div
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          backgroundColor: isStopping ? colors.warning : colors.accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          animation: 'autorun-pulse 1.5s ease-in-out infinite',
        }}
      >
        {/* Play or pause icon */}
        {isStopping ? (
          // Pause icon (stopping)
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          // Play/running icon
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="white"
            stroke="none"
          >
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </div>

      {/* Status text and progress */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: colors.textMain,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {isStopping ? 'Stopping after current task...' : 'AutoRun Active'}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: colors.textDim,
                marginTop: '2px',
              }}
            >
              {sessionName && <span>{sessionName} - </span>}
              Task {currentTask} of {totalTasks}
              {completedTasks > 0 && ` (${completedTasks} completed)`}
            </div>
          </div>

          {/* Progress badge */}
          <div
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: isStopping ? colors.warning : colors.accent,
              backgroundColor: isStopping ? `${colors.warning}20` : `${colors.accent}20`,
              padding: '4px 8px',
              borderRadius: '12px',
              flexShrink: 0,
            }}
          >
            {progress}%
          </div>
        </div>

        {/* Progress bar */}
        <div
          style={{
            height: '4px',
            backgroundColor: `${colors.textDim}20`,
            borderRadius: '2px',
            marginTop: '6px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              backgroundColor: isStopping ? colors.warning : colors.accent,
              borderRadius: '2px',
              transition: 'width 0.3s ease-out',
            }}
          />
        </div>
      </div>

      {/* Read-only indicator */}
      <div
        style={{
          fontSize: '10px',
          color: colors.textDim,
          backgroundColor: `${colors.textDim}15`,
          padding: '4px 6px',
          borderRadius: '4px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
        title="AI input is read-only while AutoRun is active"
      >
        {/* Lock icon */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke={colors.textDim}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        READ-ONLY
      </div>

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes autorun-pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.1);
            opacity: 0.8;
          }
        }
      `}</style>
    </div>
  );
}

export default AutoRunIndicator;
