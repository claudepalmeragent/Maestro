import React, { useState } from 'react';
import { Trophy, Clock, Zap, Star, ExternalLink, ChevronRight, ChevronDown, History } from 'lucide-react';
import type { Theme } from '../types';
import type { AutoRunStats } from '../types';
import {
  CONDUCTOR_BADGES,
  getBadgeForTime,
  getNextBadge,
  getProgressToNextBadge,
  formatTimeRemaining,
  formatCumulativeTime,
  type ConductorBadge,
} from '../constants/conductorBadges';
import { MaestroSilhouette } from './MaestroSilhouette';

interface AchievementCardProps {
  theme: Theme;
  autoRunStats: AutoRunStats;
}

interface BadgeTooltipProps {
  badge: ConductorBadge;
  theme: Theme;
  isUnlocked: boolean;
}

function BadgeTooltip({ badge, theme, isUnlocked }: BadgeTooltipProps) {
  return (
    <div
      className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 p-3 rounded-lg shadow-xl z-50 w-64"
      style={{
        backgroundColor: theme.colors.bgSidebar,
        border: `1px solid ${theme.colors.border}`,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="font-bold" style={{ color: theme.colors.accent }}>
          Level {badge.level}
        </span>
        <span className="font-medium" style={{ color: theme.colors.textMain }}>
          {badge.name}
        </span>
      </div>
      <p className="text-xs mb-2" style={{ color: theme.colors.textDim }}>
        {badge.description}
      </p>
      {isUnlocked && (
        <p className="text-xs italic mb-2" style={{ color: theme.colors.textMain }}>
          "{badge.flavorText}"
        </p>
      )}
      <div className="flex items-center justify-between text-xs pt-2 border-t" style={{ borderColor: theme.colors.border }}>
        <span style={{ color: theme.colors.textDim }}>
          Required: {formatCumulativeTime(badge.requiredTimeMs)}
        </span>
        {isUnlocked ? (
          <span style={{ color: theme.colors.success }}>Unlocked</span>
        ) : (
          <span style={{ color: theme.colors.textDim }}>Locked</span>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          window.maestro.shell.openExternal(badge.exampleConductor.wikipediaUrl);
        }}
        className="flex items-center gap-1 text-xs mt-2 hover:underline"
        style={{ color: theme.colors.accent }}
      >
        <ExternalLink className="w-3 h-3" />
        {badge.exampleConductor.name}
      </button>
      {/* Arrow */}
      <div
        className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0"
        style={{
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: `6px solid ${theme.colors.border}`,
        }}
      />
    </div>
  );
}

/**
 * Achievement card component for displaying in the About modal
 * Shows current badge, progress to next level, and stats
 */
export function AchievementCard({ theme, autoRunStats }: AchievementCardProps) {
  const [hoveredBadge, setHoveredBadge] = useState<number | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const currentBadge = getBadgeForTime(autoRunStats.cumulativeTimeMs);
  const nextBadge = getNextBadge(currentBadge);
  const progressPercent = getProgressToNextBadge(
    autoRunStats.cumulativeTimeMs,
    currentBadge,
    nextBadge
  );

  const currentLevel = currentBadge?.level || 0;

  return (
    <div
      className="p-4 rounded border"
      style={{
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.bgActivity,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="w-4 h-4" style={{ color: '#FFD700' }} />
        <span className="text-sm font-bold" style={{ color: theme.colors.textMain }}>
          Maestro Achievements
        </span>
      </div>

      {/* Current badge display */}
      <div className="flex items-center gap-4 mb-4">
        {/* Maestro icon */}
        <div
          className="relative flex-shrink-0 p-2 rounded-lg"
          style={{
            background: currentLevel > 0
              ? `linear-gradient(135deg, ${theme.colors.accent}30 0%, #FFD70030 100%)`
              : theme.colors.bgMain,
            border: `2px solid ${currentLevel > 0 ? '#FFD700' : theme.colors.border}`,
          }}
        >
          <MaestroSilhouette
            variant="dark"
            size={48}
            style={{ opacity: currentLevel > 0 ? 1 : 0.3 }}
          />
          {currentLevel > 0 && (
            <div
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
                color: '#000',
              }}
            >
              {currentLevel}
            </div>
          )}
        </div>

        {/* Badge info */}
        <div className="flex-1 min-w-0">
          {currentBadge ? (
            <>
              <div className="font-medium truncate" style={{ color: theme.colors.textMain }}>
                {currentBadge.name}
              </div>
              <div className="text-xs" style={{ color: theme.colors.textDim }}>
                Level {currentBadge.level} of 11
              </div>
            </>
          ) : (
            <>
              <div className="font-medium" style={{ color: theme.colors.textDim }}>
                No Badge Yet
              </div>
              <div className="text-xs" style={{ color: theme.colors.textDim }}>
                Complete 15 minutes of AutoRun to unlock
              </div>
            </>
          )}
        </div>
      </div>

      {/* Progress bar to next level */}
      {nextBadge && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs mb-1">
            <span style={{ color: theme.colors.textDim }}>
              Next: {nextBadge.shortName}
            </span>
            <span style={{ color: theme.colors.accent }}>
              {formatTimeRemaining(autoRunStats.cumulativeTimeMs, nextBadge)}
            </span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: theme.colors.bgMain }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progressPercent}%`,
                background: `linear-gradient(90deg, ${theme.colors.accent} 0%, #FFD700 100%)`,
              }}
            />
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="text-center p-2 rounded" style={{ backgroundColor: theme.colors.bgMain }}>
          <div className="flex items-center justify-center gap-1 mb-1">
            <Clock className="w-3 h-3" style={{ color: theme.colors.textDim }} />
          </div>
          <div className="text-xs font-mono font-bold" style={{ color: theme.colors.textMain }}>
            {formatCumulativeTime(autoRunStats.cumulativeTimeMs)}
          </div>
          <div className="text-xs" style={{ color: theme.colors.textDim }}>
            Total Time
          </div>
        </div>

        <div className="text-center p-2 rounded" style={{ backgroundColor: theme.colors.bgMain }}>
          <div className="flex items-center justify-center gap-1 mb-1">
            <Trophy className="w-3 h-3" style={{ color: '#FFD700' }} />
          </div>
          <div className="text-xs font-mono font-bold" style={{ color: theme.colors.textMain }}>
            {formatCumulativeTime(autoRunStats.longestRunMs)}
          </div>
          <div className="text-xs" style={{ color: theme.colors.textDim }}>
            Longest Run
          </div>
        </div>

        <div className="text-center p-2 rounded" style={{ backgroundColor: theme.colors.bgMain }}>
          <div className="flex items-center justify-center gap-1 mb-1">
            <Zap className="w-3 h-3" style={{ color: theme.colors.accent }} />
          </div>
          <div className="text-xs font-mono font-bold" style={{ color: theme.colors.textMain }}>
            {autoRunStats.totalRuns}
          </div>
          <div className="text-xs" style={{ color: theme.colors.textDim }}>
            Total Runs
          </div>
        </div>
      </div>

      {/* Badge progression preview */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs" style={{ color: theme.colors.textDim }}>
            Badge Progression
          </span>
          <span className="text-xs" style={{ color: theme.colors.textDim }}>
            {currentLevel}/11 unlocked
          </span>
        </div>
        <div className="flex gap-1">
          {CONDUCTOR_BADGES.map((badge) => {
            const isUnlocked = badge.level <= currentLevel;
            const isCurrent = badge.level === currentLevel;

            return (
              <div
                key={badge.id}
                className="relative flex-1"
                onMouseEnter={() => setHoveredBadge(badge.level)}
                onMouseLeave={() => setHoveredBadge(null)}
              >
                <div
                  className={`h-2 rounded-full cursor-pointer transition-all ${
                    isCurrent ? 'ring-2 ring-offset-1' : ''
                  }`}
                  style={{
                    backgroundColor: isUnlocked
                      ? badge.level <= 3
                        ? theme.colors.accent
                        : badge.level <= 7
                          ? '#FFD700'
                          : '#FF6B35'
                      : theme.colors.bgMain,
                    ringColor: isCurrent ? '#FFD700' : 'transparent',
                    opacity: isUnlocked ? 1 : 0.3,
                  }}
                  title={`${badge.name} - ${formatCumulativeTime(badge.requiredTimeMs)}`}
                />
                {hoveredBadge === badge.level && (
                  <BadgeTooltip badge={badge} theme={theme} isUnlocked={isUnlocked} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Badge Unlock History - only visible at level 2+ */}
      {autoRunStats.badgeHistory && autoRunStats.badgeHistory.length > 1 && (
        <div className="mt-3">
          <button
            onClick={() => setHistoryExpanded(!historyExpanded)}
            className="flex items-center gap-1.5 text-xs w-full hover:opacity-80 transition-opacity"
            style={{ color: theme.colors.textDim }}
          >
            <History className="w-3 h-3" />
            <span>Unlock History</span>
            <ChevronDown
              className={`w-3 h-3 ml-auto transition-transform duration-200 ${
                historyExpanded ? 'rotate-180' : ''
              }`}
            />
          </button>
          {historyExpanded && (
            <div
              className="mt-2 p-2 rounded space-y-1.5 max-h-32 overflow-y-auto"
              style={{ backgroundColor: theme.colors.bgMain }}
            >
              {[...autoRunStats.badgeHistory]
                .sort((a, b) => b.unlockedAt - a.unlockedAt)
                .map((record) => {
                  const badge = CONDUCTOR_BADGES.find((b) => b.level === record.level);
                  if (!badge) return null;
                  return (
                    <div
                      key={record.level}
                      className="flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold"
                          style={{
                            background:
                              badge.level <= 3
                                ? theme.colors.accent
                                : badge.level <= 7
                                  ? '#FFD700'
                                  : '#FF6B35',
                            color: '#000',
                          }}
                        >
                          {badge.level}
                        </div>
                        <span style={{ color: theme.colors.textMain }}>{badge.shortName}</span>
                      </div>
                      <span style={{ color: theme.colors.textDim }}>
                        {new Date(record.unlockedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Max level celebration */}
      {!nextBadge && currentBadge && (
        <div
          className="mt-4 p-3 rounded-lg text-center"
          style={{
            background: `linear-gradient(135deg, ${theme.colors.accent}20 0%, #FFD70020 100%)`,
            border: `1px solid #FFD700`,
          }}
        >
          <div className="flex items-center justify-center gap-2 mb-1">
            <Star className="w-4 h-4" style={{ color: '#FFD700' }} />
            <span className="font-bold" style={{ color: '#FFD700' }}>
              Maximum Level Achieved!
            </span>
            <Star className="w-4 h-4" style={{ color: '#FFD700' }} />
          </div>
          <p className="text-xs" style={{ color: theme.colors.textDim }}>
            You are a true Titan of the Baton
          </p>
        </div>
      )}
    </div>
  );
}

export default AchievementCard;
