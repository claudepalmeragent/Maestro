import { useEffect, useRef, useCallback } from 'react';
import type { Session } from '../types';

const ACTIVITY_TIMEOUT_MS = 60000; // 1 minute of inactivity = idle
const TICK_INTERVAL_MS = 1000; // Update every second

export interface UseActivityTrackerReturn {
  onActivity: () => void; // Call this when user activity is detected
}

/**
 * Hook to track user activity and update session's activeTimeMs.
 * When the user is active (touched keyboard/mouse in the last minute),
 * time is added to the active session.
 */
export function useActivityTracker(
  activeSessionId: string | null,
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
): UseActivityTrackerReturn {
  const lastActivityRef = useRef<number>(Date.now());
  const isActiveRef = useRef<boolean>(false);

  // Mark activity occurred
  const onActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    isActiveRef.current = true;
  }, []);

  // Tick every second to add time to active session
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - lastActivityRef.current;

      // Check if still active (activity within the last minute)
      if (timeSinceLastActivity < ACTIVITY_TIMEOUT_MS && isActiveRef.current) {
        // Add time to the active session
        if (activeSessionId) {
          setSessions(prev => prev.map(session => {
            if (session.id === activeSessionId) {
              return {
                ...session,
                activeTimeMs: (session.activeTimeMs || 0) + TICK_INTERVAL_MS
              };
            }
            return session;
          }));
        }
      } else {
        // Mark as inactive if timeout exceeded
        isActiveRef.current = false;
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeSessionId, setSessions]);

  // Listen to global activity events
  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
      isActiveRef.current = true;
    };

    // Listen for various user interactions
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('wheel', handleActivity);
    window.addEventListener('touchstart', handleActivity);

    return () => {
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('wheel', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
    };
  }, []);

  return { onActivity };
}
