/**
 * MaestroWizard.tsx
 *
 * Main orchestrator component for the onboarding wizard.
 * Renders the appropriate screen based on the current step from WizardContext.
 * Handles modal presentation, screen transitions, and LayerStack registration.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useWizard, WIZARD_TOTAL_STEPS, type WizardStep } from './WizardContext';
import { useLayerStack } from '../../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import type { Theme } from '../../types';

// Screen components - will be implemented in subsequent tasks
// For now, we render placeholder content until the actual screens are created
import {
  AgentSelectionScreen,
  DirectorySelectionScreen,
  ConversationScreen,
  PhaseReviewScreen,
} from './screens';

interface MaestroWizardProps {
  theme: Theme;
  /** Callback to create session and launch Auto Run when wizard completes */
  onLaunchSession?: (wantsTour: boolean) => Promise<void>;
}

/**
 * Get human-readable title for each wizard step
 */
function getStepTitle(step: WizardStep): string {
  switch (step) {
    case 'agent-selection':
      return 'Select Your Agent';
    case 'directory-selection':
      return 'Choose Project Directory';
    case 'conversation':
      return 'Project Discovery';
    case 'phase-review':
      return 'Review Your Action Plan';
    default:
      return 'Setup Wizard';
  }
}

/**
 * MaestroWizard - Main wizard orchestrator component
 *
 * Renders the wizard modal and manages screen transitions based on
 * the current step from WizardContext. Integrates with LayerStack for
 * proper modal behavior including Escape key handling.
 */
export function MaestroWizard({ theme, onLaunchSession }: MaestroWizardProps): JSX.Element | null {
  const {
    state,
    closeWizard,
    saveStateForResume,
    getCurrentStepNumber,
  } = useWizard();

  const { registerLayer, unregisterLayer } = useLayerStack();

  // Refs for stable callbacks
  const closeWizardRef = useRef(closeWizard);
  closeWizardRef.current = closeWizard;
  const saveStateForResumeRef = useRef(saveStateForResume);
  saveStateForResumeRef.current = saveStateForResume;

  /**
   * Handle wizard close with optional confirmation and state saving
   * Confirmation is shown if user has progressed past step 1
   */
  const handleClose = useCallback(() => {
    const currentStepNum = getCurrentStepNumber();

    if (currentStepNum > 1) {
      // Save state for resume before closing
      saveStateForResumeRef.current();
    }

    closeWizardRef.current();
  }, [getCurrentStepNumber]);

  // Register with layer stack for Escape handling
  useEffect(() => {
    if (state.isOpen) {
      const id = registerLayer({
        type: 'modal',
        priority: MODAL_PRIORITIES.WIZARD,
        onEscape: handleClose,
      });
      return () => unregisterLayer(id);
    }
  }, [state.isOpen, registerLayer, unregisterLayer, handleClose]);

  // Don't render if wizard is not open
  if (!state.isOpen) {
    return null;
  }

  const currentStepNumber = getCurrentStepNumber();
  const stepTitle = getStepTitle(state.currentStep);

  /**
   * Render the appropriate screen component based on current step
   */
  const renderCurrentScreen = () => {
    switch (state.currentStep) {
      case 'agent-selection':
        return <AgentSelectionScreen theme={theme} />;
      case 'directory-selection':
        return <DirectorySelectionScreen theme={theme} />;
      case 'conversation':
        return <ConversationScreen theme={theme} />;
      case 'phase-review':
        return (
          <PhaseReviewScreen
            theme={theme}
            onLaunchSession={onLaunchSession || (async () => {})}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center wizard-backdrop"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
      onClick={(e) => {
        // Close on backdrop click
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div
        className="w-[90vw] h-[80vh] max-w-5xl rounded-xl border shadow-2xl flex flex-col overflow-hidden wizard-modal"
        style={{
          backgroundColor: theme.colors.bgMain,
          borderColor: theme.colors.border,
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b wizard-header"
          style={{
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.bgSidebar,
          }}
        >
          {/* Step indicator and title */}
          <div className="flex items-center gap-4">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold"
              style={{
                backgroundColor: theme.colors.accent,
                color: theme.colors.accentForeground,
              }}
            >
              {currentStepNumber}
            </div>
            <div>
              <h2
                id="wizard-title"
                className="text-lg font-semibold"
                style={{ color: theme.colors.textMain }}
              >
                {stepTitle}
              </h2>
              <p
                className="text-xs"
                style={{ color: theme.colors.textDim }}
              >
                Step {currentStepNumber} of {WIZARD_TOTAL_STEPS}
              </p>
            </div>
          </div>

          {/* Progress dots */}
          <div className="flex items-center gap-2">
            {Array.from({ length: WIZARD_TOTAL_STEPS }, (_, i) => {
              const stepNum = i + 1;
              const isActive = stepNum === currentStepNumber;
              const isCompleted = stepNum < currentStepNumber;

              return (
                <div
                  key={stepNum}
                  className="w-2.5 h-2.5 rounded-full transition-all duration-300"
                  style={{
                    backgroundColor: isActive
                      ? theme.colors.accent
                      : isCompleted
                      ? theme.colors.success
                      : theme.colors.border,
                    transform: isActive ? 'scale(1.2)' : 'scale(1)',
                  }}
                  aria-label={`Step ${stepNum}${isActive ? ' (current)' : isCompleted ? ' (completed)' : ''}`}
                />
              );
            })}
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: theme.colors.textDim }}
            title="Close wizard (Escape)"
            aria-label="Close wizard"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content area - renders the current screen */}
        <div className="flex-1 overflow-hidden wizard-content">
          {renderCurrentScreen()}
        </div>
      </div>

      {/* Fade transition styles */}
      <style>{`
        .wizard-backdrop {
          animation: wizard-fade-in 0.2s ease-out;
        }

        .wizard-modal {
          animation: wizard-slide-up 0.3s ease-out;
        }

        .wizard-content {
          animation: wizard-content-fade 0.25s ease-out;
        }

        @keyframes wizard-fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes wizard-slide-up {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes wizard-content-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
