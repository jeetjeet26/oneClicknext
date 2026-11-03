'use client'

import { CheckCircle2 } from 'lucide-react'
import { STEPS_ORDER, STEP_CONFIG, OnboardingStep } from '../types'

interface StepIndicatorProps {
  currentStep: OnboardingStep
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  const visibleSteps = STEPS_ORDER.filter(s => s !== 'complete')
  const currentIndex = STEPS_ORDER.indexOf(currentStep)

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Desktop view */}
      <div className="hidden md:flex items-center justify-center gap-2">
        {visibleSteps.map((step, index) => {
          const config = STEP_CONFIG[step]
          const stepIndex = STEPS_ORDER.indexOf(step)
          const isCompleted = currentIndex > stepIndex
          const isCurrent = step === currentStep

          return (
            <div key={step} className="flex items-center">
              <div className="flex flex-col items-center">
                <div 
                  className={`
                    flex items-center justify-center w-10 h-10 rounded-full border-2 
                    transition-all duration-300
                    ${isCurrent 
                      ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-lg shadow-amber-500/20' 
                      : isCompleted 
                        ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300' 
                        : 'border-slate-600 text-slate-500 bg-slate-800/50'
                    }
                  `}
                >
                  {isCompleted ? (
                    <CheckCircle2 size={20} />
                  ) : (
                    <span className="text-sm font-semibold">{config.order}</span>
                  )}
                </div>
                <span className={`
                  mt-2 text-xs font-medium transition-colors
                  ${isCurrent ? 'text-amber-300' : isCompleted ? 'text-emerald-300' : 'text-slate-500'}
                `}>
                  {config.title}
                </span>
              </div>
              
              {index < visibleSteps.length - 1 && (
                <div 
                  className={`
                    w-12 h-0.5 mx-2 transition-all duration-500
                    ${stepIndex < currentIndex 
                      ? 'bg-gradient-to-r from-emerald-400 to-emerald-400' 
                      : stepIndex === currentIndex - 1 
                        ? 'bg-gradient-to-r from-emerald-400 to-amber-400'
                        : 'bg-slate-700'
                    }
                  `}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Mobile view - simplified */}
      <div className="md:hidden">
        <div className="flex items-center justify-center gap-1.5">
          {visibleSteps.map((step) => {
            const stepIndex = STEPS_ORDER.indexOf(step)
            const isCompleted = currentIndex > stepIndex
            const isCurrent = step === currentStep

            return (
              <div 
                key={step}
                className={`
                  h-1.5 rounded-full transition-all duration-300
                  ${isCurrent 
                    ? 'w-8 bg-amber-400' 
                    : isCompleted 
                      ? 'w-4 bg-emerald-400' 
                      : 'w-4 bg-slate-700'
                  }
                `}
              />
            )
          })}
        </div>
        <p className="text-center mt-3 text-sm text-slate-400">
          Step {STEP_CONFIG[currentStep].order} of 6: <span className="text-white font-medium">{STEP_CONFIG[currentStep].title}</span>
        </p>
      </div>
    </div>
  )
}

