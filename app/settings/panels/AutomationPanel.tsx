'use client'

import type React from 'react'
import { CalendarIcon } from '@heroicons/react/24/outline'
import { convertToHebrewDate } from '@/lib/hebrew-date'

export interface AutomationConfigShape {
  barMitzvahAutoAssignPlanId: string | null
  barMitzvahAutoCreateEventTypeId: string | null
  weddingConversionDefaultPlanId: string | null
  monthlyStatementAutoGenerate: boolean
  monthlyStatementAutoEmail: boolean
  monthlyStatementCalendar: 'gregorian' | 'hebrew'
  monthlyStatementDay: number
  monthlyStatementHebrewDay: number
}

interface PlanOption {
  _id: string
  name: string
  yearlyPrice: number
}

interface EventTypeOption {
  _id: string
  name: string
  amount: number
}

export interface AutomationPanelProps {
  automationConfig: AutomationConfigShape
  setAutomationConfig: React.Dispatch<React.SetStateAction<AutomationConfigShape>>
  plans: PlanOption[]
  eventTypes: EventTypeOption[]
  formatMoney: (amount: number) => string
  emailConfig: { email?: string } | null
  saving: boolean
  onSave: () => void | Promise<void>
}

export default function AutomationPanel({
  automationConfig,
  setAutomationConfig,
  plans,
  eventTypes,
  formatMoney,
  emailConfig,
  saving,
  onSave,
}: AutomationPanelProps) {
  return (
    <div className="bg-surface rounded-lg shadow-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center">
          <CalendarIcon className="h-6 w-6 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-fg">Automation</h2>
          <p className="text-sm text-fg-muted">
            Optional rules that fire automatically when member data changes.
          </p>
        </div>
      </div>

      <div className="space-y-5 max-w-2xl">
        <div className="border border-border rounded-lg p-5">
          <h3 className="text-lg font-semibold text-fg mb-1">Bar Mitzvah</h3>
          <p className="text-sm text-fg-muted mb-5">
            When a male member reaches Bar Mitzvah age (Hebrew calendar), the actions below trigger
            automatically. Each rule is independent — leave a dropdown blank to skip that action.
          </p>

          <div className="space-y-4">
            <div>
              <label htmlFor="auto-assign-plan" className="block text-sm font-medium text-fg mb-1">
                Auto-assign payment plan
              </label>
              <select
                id="auto-assign-plan"
                value={automationConfig.barMitzvahAutoAssignPlanId || ''}
                onChange={(e) =>
                  setAutomationConfig((c) => ({
                    ...c,
                    barMitzvahAutoAssignPlanId: e.target.value || null,
                  }))
                }
                className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
              >
                <option value="">— Do not auto-assign —</option>
                {plans.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name} ({formatMoney(p.yearlyPrice)}/yr)
                  </option>
                ))}
              </select>
              {plans.length === 0 && (
                <p className="text-xs text-fg-muted mt-1">
                  No payment plans configured yet. Add one in the Payment Plans tab first.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="auto-create-event" className="block text-sm font-medium text-fg mb-1">
                Auto-create lifecycle event
              </label>
              <select
                id="auto-create-event"
                value={automationConfig.barMitzvahAutoCreateEventTypeId || ''}
                onChange={(e) =>
                  setAutomationConfig((c) => ({
                    ...c,
                    barMitzvahAutoCreateEventTypeId: e.target.value || null,
                  }))
                }
                className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
              >
                <option value="">— Do not auto-create —</option>
                {eventTypes.map((ev) => (
                  <option key={ev._id} value={ev._id}>
                    {ev.name} ({formatMoney(ev.amount)})
                  </option>
                ))}
              </select>
              {eventTypes.length === 0 && (
                <p className="text-xs text-fg-muted mt-1">
                  No event types configured yet. Add one in the Event Types tab first.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="border border-border rounded-lg p-5">
          <h3 className="text-lg font-semibold text-fg mb-1">Monthly statements</h3>
          <p className="text-sm text-fg-muted mb-5">
            Run the &ldquo;Generate Monthly Batch&rdquo; and email steps automatically every month
            for the previous month&rsquo;s period. Both toggles are independent — turn on only
            generation, only email, or both. The email step requires a saved Gmail configuration in
            the Email tab, and skips any family marked &ldquo;Opt out of bulk statement emails&rdquo;
            on the family form.
          </p>

          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={automationConfig.monthlyStatementAutoGenerate}
                onChange={(e) =>
                  setAutomationConfig((c) => ({
                    ...c,
                    monthlyStatementAutoGenerate: e.target.checked,
                  }))
                }
                className="mt-1 h-4 w-4 accent-accent"
              />
              <span className="text-sm">
                <span className="block font-medium text-fg">Auto-generate monthly statements</span>
                <span className="block text-fg-muted">
                  Equivalent to clicking &ldquo;Generate Monthly Batch&rdquo; every month for last
                  month&rsquo;s period.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={automationConfig.monthlyStatementAutoEmail}
                onChange={(e) =>
                  setAutomationConfig((c) => ({
                    ...c,
                    monthlyStatementAutoEmail: e.target.checked,
                  }))
                }
                className="mt-1 h-4 w-4 accent-accent"
              />
              <span className="text-sm">
                <span className="block font-medium text-fg">Auto-email monthly statements</span>
                <span className="block text-fg-muted">
                  Sends a PDF statement to every family with an email address on file (and not
                  opted out). Requires email configuration in the Email tab.
                </span>
                {automationConfig.monthlyStatementAutoEmail && !emailConfig?.email && (
                  <span className="mt-2 inline-block text-xs text-yellow-700 dark:text-yellow-400">
                    No email configuration found yet — set one up in the Email tab or the cron will
                    fail for this org.
                  </span>
                )}
              </span>
            </label>

            <div className="pt-2 border-t border-border space-y-3">
              <div>
                <span className="block text-sm font-medium text-fg mb-2">Schedule by</span>
                <div
                  role="radiogroup"
                  aria-label="Schedule calendar"
                  className="inline-flex rounded-md border border-border overflow-hidden"
                >
                  {(['gregorian', 'hebrew'] as const).map((cal) => {
                    const active = automationConfig.monthlyStatementCalendar === cal
                    const disabled =
                      !automationConfig.monthlyStatementAutoGenerate &&
                      !automationConfig.monthlyStatementAutoEmail
                    return (
                      <button
                        key={cal}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={disabled}
                        onClick={() =>
                          setAutomationConfig((c) => ({
                            ...c,
                            monthlyStatementCalendar: cal,
                          }))
                        }
                        className={`focus-ring px-3 py-1.5 text-sm transition-colors ${
                          active
                            ? 'bg-accent text-accent-fg'
                            : 'bg-surface text-fg hover:bg-fg/5'
                        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {cal === 'gregorian' ? 'Gregorian calendar' : 'Hebrew calendar'}
                      </button>
                    )
                  })}
                </div>
              </div>

              {automationConfig.monthlyStatementCalendar === 'gregorian' ? (
                <div>
                  <label
                    htmlFor="monthly-statement-day"
                    className="block text-sm font-medium text-fg mb-1"
                  >
                    Day of the Gregorian month to run
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="monthly-statement-day"
                      type="number"
                      min={1}
                      max={31}
                      value={automationConfig.monthlyStatementDay}
                      onChange={(e) => {
                        const raw = parseInt(e.target.value, 10)
                        const clamped = Number.isFinite(raw) ? Math.max(1, Math.min(31, raw)) : 1
                        setAutomationConfig((c) => ({
                          ...c,
                          monthlyStatementDay: clamped,
                        }))
                      }}
                      disabled={
                        !automationConfig.monthlyStatementAutoGenerate &&
                        !automationConfig.monthlyStatementAutoEmail
                      }
                      className="focus-ring w-24 bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none disabled:opacity-50"
                    />
                    <span className="text-sm text-fg-muted">of every Gregorian month</span>
                  </div>
                  <p className="text-xs text-fg-muted mt-2">
                    Generate runs at 2 AM UTC, email runs at 3 AM UTC. If the month is shorter than
                    this day (e.g. you pick 31 but it&rsquo;s February), the job runs on the last
                    day of that month so it never gets skipped.
                  </p>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="monthly-statement-hebrew-day"
                    className="block text-sm font-medium text-fg mb-1"
                  >
                    Day of the Hebrew month to run
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="monthly-statement-hebrew-day"
                      type="number"
                      min={1}
                      max={30}
                      value={automationConfig.monthlyStatementHebrewDay}
                      onChange={(e) => {
                        const raw = parseInt(e.target.value, 10)
                        const clamped = Number.isFinite(raw) ? Math.max(1, Math.min(30, raw)) : 1
                        setAutomationConfig((c) => ({
                          ...c,
                          monthlyStatementHebrewDay: clamped,
                        }))
                      }}
                      disabled={
                        !automationConfig.monthlyStatementAutoGenerate &&
                        !automationConfig.monthlyStatementAutoEmail
                      }
                      className="focus-ring w-24 bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none disabled:opacity-50"
                    />
                    <span className="text-sm text-fg-muted">of every Hebrew month</span>
                  </div>
                  <p className="text-xs text-fg-muted mt-2">
                    Generate runs at 2 AM UTC, email runs at 3 AM UTC. Hebrew months are 29 or 30
                    days; if you pick 30 in a 29-day month, the job runs on the 29th so it&rsquo;s
                    never skipped.
                  </p>
                  <p className="text-xs text-fg-muted mt-1">
                    For reference, today is{' '}
                    <span className="font-medium text-fg">
                      {convertToHebrewDate(new Date()) || '—'}
                    </span>
                    .
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border border-border rounded-lg p-5">
          <h3 className="text-lg font-semibold text-fg mb-1">Child → family conversion</h3>
          <p className="text-sm text-fg-muted mb-5">
            When a child member reaches their wedding date (cron) or is converted manually, the
            newly created family is assigned this default plan. Leave blank to create the family
            with no plan and assign one yourself.
          </p>

          <div>
            <label htmlFor="wedding-default-plan" className="block text-sm font-medium text-fg mb-1">
              Default plan for newly converted families
            </label>
            <select
              id="wedding-default-plan"
              value={automationConfig.weddingConversionDefaultPlanId || ''}
              onChange={(e) =>
                setAutomationConfig((c) => ({
                  ...c,
                  weddingConversionDefaultPlanId: e.target.value || null,
                }))
              }
              className="focus-ring w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-fg outline-none"
            >
              <option value="">— Do not auto-assign —</option>
              {plans.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} ({formatMoney(p.yearlyPrice)}/yr)
                </option>
              ))}
            </select>
            {plans.length === 0 && (
              <p className="text-xs text-fg-muted mt-1">
                No payment plans configured yet. Add one in the Payment Plans tab first.
              </p>
            )}
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="bg-accent text-white px-5 py-2 rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save automation settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
