import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Upload,
  Users,
  ShieldCheck,
  PhoneCall,
  FileText,
  PlayCircle,
  ChevronLeft,
  ChevronRight,
  X,
  Check
} from 'lucide-react';

interface OnboardingTourProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TourStep {
  stepNumber: number;
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    stepNumber: 1,
    title: 'Welcome to your callback list',
    body: "This is where you work through vehicle owners who haven't scheduled their valuation yet. Every day, Brian sends a fresh list, and it lands here as your call queue. Let's walk through how it works, it only takes a minute.",
    icon: Sparkles,
    iconBg: 'bg-red-50',
    iconColor: 'text-[#ff353e]',
  },
  {
    stepNumber: 2,
    title: "Start by uploading today's list",
    body: 'Click "Upload latest pending scheduling list", enter your name, and choose the Excel file Brian sent. The system automatically merges it with what\'s already here: nothing gets duplicated, and anything already closed stays closed. You only need to do this once a day.',
    icon: Upload,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
  {
    stepNumber: 3,
    title: 'Grouped so you can clear a client in one call',
    body: "The list is grouped by insurance company, and within each company, by client. If a client has more than one vehicle, they're all shown together, so you can sort out every one of their vehicles in a single phone call instead of calling them back repeatedly.",
    icon: Users,
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-600',
  },
  {
    stepNumber: 4,
    title: "Green, Amber, and Red tell you what's needed",
    body: "Amber means still in progress, keep calling. Green means the job has been scheduled, nothing more to do. Red with a stop sign means the client declined, said it was valued elsewhere, or you've reached the maximum number of attempts, either way, it's closed and won't come back on tomorrow's list.",
    icon: ShieldCheck,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
  },
  {
    stepNumber: 5,
    title: "You don't need to count your own calls",
    body: "The number of attempts and SMS messages shown against each vehicle comes straight from your phone's call log, automatically. You don't need to track or type this yourself, just make the call as normal and it updates on its own.",
    icon: PhoneCall,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
  },
  {
    stepNumber: 6,
    title: 'After every call, log the outcome',
    body: "Pick what happened from the dropdown: Scheduled, Not picking, Wrong number, Not ready, Valued elsewhere, Unreachable, or Declined. Add a short note on what was said, this is required every time, and it's what lets you or a teammate pick up the thread later without guessing.",
    icon: FileText,
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
  },
  {
    stepNumber: 7,
    title: 'Try "Start Calling" for a focused queue',
    body: 'Instead of scrolling the full list, select your name in the agent filter and press "Start Calling." It shows you one client at a time, oldest first, and moves to the next only once you\'ve logged every vehicle for that client. Closing it anytime brings you back to the full list exactly where you left off.',
    icon: PlayCircle,
    iconBg: 'bg-red-50',
    iconColor: 'text-[#ff353e]',
  },
];

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ isOpen, onClose }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Reset to first step whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' && currentStepIndex < TOUR_STEPS.length - 1) {
        setCurrentStepIndex((prev) => prev + 1);
      } else if (e.key === 'ArrowLeft' && currentStepIndex > 0) {
        setCurrentStepIndex((prev) => prev - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStepIndex, onClose]);

  if (!isOpen) return null;

  const currentStep = TOUR_STEPS[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === TOUR_STEPS.length - 1;
  const StepIcon = currentStep.icon;

  const handleNext = () => {
    if (isLastStep) {
      onClose();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (!isFirstStep) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  return (
    <div
      id="onboarding-tour-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        id="onboarding-tour-card"
        className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 shadow-2xl border border-slate-100 flex flex-col space-y-6 animate-in zoom-in-95 duration-150"
      >
        {/* Header with Step counter & Skip link */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
            Step {currentStep.stepNumber} of {TOUR_STEPS.length}
          </span>
          <button
            id="btn-skip-onboarding-tour"
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
          >
            Skip tour
          </button>
        </div>

        {/* Step Icon & Content */}
        <div className="space-y-4">
          <div className={`w-12 h-12 rounded-2xl ${currentStep.iconBg} ${currentStep.iconColor} flex items-center justify-center shadow-xs`}>
            <StepIcon className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
              {currentStep.title}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed">
              {currentStep.body}
            </p>
          </div>
        </div>

        {/* Progress dots row */}
        <div className="flex items-center justify-center gap-1.5 pt-2">
          {TOUR_STEPS.map((step, idx) => (
            <button
              key={step.stepNumber}
              type="button"
              onClick={() => setCurrentStepIndex(idx)}
              aria-label={`Go to step ${step.stepNumber}`}
              className={`h-2 rounded-full transition-all cursor-pointer ${
                idx === currentStepIndex
                  ? 'w-7 bg-[#ff353e]'
                  : 'w-2 bg-slate-200 hover:bg-slate-300'
              }`}
            />
          ))}
        </div>

        {/* Footer Navigation Buttons */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <button
            id="btn-onboarding-back"
            type="button"
            disabled={isFirstStep}
            onClick={handleBack}
            className={`px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors flex items-center gap-1 cursor-pointer ${
              isFirstStep ? 'invisible' : ''
            }`}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          <button
            id="btn-onboarding-next"
            type="button"
            onClick={handleNext}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#ff353e] hover:bg-[#e0262f] text-white shadow-sm transition-all flex items-center gap-1.5 cursor-pointer ml-auto"
          >
            {isLastStep ? (
              <>
                <span>Got it, let's get started</span>
                <Check className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
