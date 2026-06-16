'use client'

import type React from 'react'
import { convertToHebrewDate } from '@/lib/hebrew-date'

// Hebrew month numbers follow @hebcal: 1=Nisan ... 7=Tishrei ... 12=Adar
// (or Adar I in a leap year), 13=Adar II (leap years only). We render all
// 13 so admins can pick Adar II if they want, with a parenthetical that
// flags its leap-year-only nature.
const HEBREW_MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: 'Tishrei' },
  { value: 8, label: 'Cheshvan' },
  { value: 9, label: 'Kislev' },
  { value: 10, label: 'Tevet' },
  { value: 11, label: 'Shevat' },
  { value: 12, label: 'Adar (Adar I in leap years)' },
  { value: 13, label: 'Adar II (leap years only)' },
  { value: 1, label: 'Nisan' },
  { value: 2, label: 'Iyar' },
  { value: 3, label: 'Sivan' },
  { value: 4, label: 'Tammuz' },
  { value: 5, label: 'Av' },
  { value: 6, label: 'Elul' },
]

function hebrewMonthLabel(month: number | undefined | null): string {
  const m = Number(month)
  const hit = HEBREW_MONTH_OPTIONS.find((o) => o.value === m)
  return hit ? hit.label.replace(/ \(.*\)$/, '') : ''
}

export interface CycleFormData {
  cycleCalendar: 'gregorian' | 'hebrew'
  cycleStartMonth: number
  cycleStartDay: number
  cycleStartHebrewMonth: number
  cycleStartHebrewDay: number
  cycleAutoRollover: boolean
  description: string
}

export interface CyclePanelProps {
  cycleConfig: any | null
  cycleFormData: CycleFormData
  setCycleFormData: React.Dispatch<React.SetStateAction<CycleFormData>>
  saving: boolean
  onSubmit: (e: React.FormEvent) => void | Promise<void>
}

export default function CyclePanel({
  cycleConfig,
  cycleFormData,
  setCycleFormData,
  saving,
  onSubmit,
}: CyclePanelProps) {
  return (
    <div className="bg-surface rounded-lg shadow-lg p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-fg">Cycle Configuration</h2>
        <p className="text-sm text-fg-muted">Configure the membership year start date</p>
      </div>

      {cycleConfig && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-800">
            <strong>✓ Cycle configuration is active:</strong> Membership year starts on{' '}
            {cycleConfig.cycleCalendar === 'hebrew'
              ? `${cycleConfig.cycleStartHebrewDay || 1} ${hebrewMonthLabel(cycleConfig.cycleStartHebrewMonth || 7)} (Hebrew calendar)`
              : new Date(
                  2024,
                  cycleConfig.cycleStartMonth - 1,
                  cycleConfig.cycleStartDay,
                ).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
          </p>
          <p className="text-sm text-green-700 mt-1">
            {cycleConfig.cycleAutoRollover
              ? 'Auto-rollover is ON — each cycle start, every family is charged their plan\u2019s yearly price and balances are updated automatically.'
              : 'Auto-rollover is OFF — this date is informational only. Turn on the toggle below to have balances charged automatically each cycle.'}
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <span className="block text-sm font-medium mb-2 text-fg">Calendar</span>
          <div
            role="radiogroup"
            aria-label="Cycle calendar"
            className="inline-flex rounded-md border border-border overflow-hidden"
          >
            {(['gregorian', 'hebrew'] as const).map((cal) => {
              const active = cycleFormData.cycleCalendar === cal
              return (
                <button
                  key={cal}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCycleFormData({ ...cycleFormData, cycleCalendar: cal })}
                  className={`focus-ring px-3 py-1.5 text-sm transition-colors ${
                    active ? 'bg-accent text-accent-fg' : 'bg-surface text-fg hover:bg-fg/5'
                  }`}
                >
                  {cal === 'gregorian' ? 'Gregorian calendar' : 'Hebrew calendar'}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-fg-muted mt-2">Pick which calendar drives the cycle start date.</p>
        </div>

        {cycleFormData.cycleCalendar === 'gregorian' ? (
          <>
            <div>
              <label className="block text-sm font-medium mb-2 text-fg">Cycle Start Month *</label>
              <select
                value={cycleFormData.cycleStartMonth}
                onChange={(e) =>
                  setCycleFormData({
                    ...cycleFormData,
                    cycleStartMonth: parseInt(e.target.value),
                  })
                }
                className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                required
              >
                <option value={1}>January</option>
                <option value={2}>February</option>
                <option value={3}>March</option>
                <option value={4}>April</option>
                <option value={5}>May</option>
                <option value={6}>June</option>
                <option value={7}>July</option>
                <option value={8}>August</option>
                <option value={9}>September</option>
                <option value={10}>October</option>
                <option value={11}>November</option>
                <option value={12}>December</option>
              </select>
              <p className="text-xs text-fg-muted mt-1">
                The Gregorian month when the membership year begins
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-fg">Cycle Start Day *</label>
              <input
                type="number"
                min="1"
                max="31"
                value={cycleFormData.cycleStartDay}
                onChange={(e) =>
                  setCycleFormData({
                    ...cycleFormData,
                    cycleStartDay: parseInt(e.target.value) || 1,
                  })
                }
                className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                required
              />
              <p className="text-xs text-fg-muted mt-1">
                The day of the Gregorian month when the membership year begins (1-31)
              </p>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium mb-2 text-fg">Hebrew Month *</label>
              <select
                value={cycleFormData.cycleStartHebrewMonth}
                onChange={(e) =>
                  setCycleFormData({
                    ...cycleFormData,
                    cycleStartHebrewMonth: parseInt(e.target.value),
                  })
                }
                className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                required
              >
                {HEBREW_MONTH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-fg-muted mt-1">
                The Hebrew month when the membership year begins. Tishrei is the traditional start
                of the civil year.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-fg">Hebrew Day *</label>
              <input
                type="number"
                min="1"
                max="30"
                value={cycleFormData.cycleStartHebrewDay}
                onChange={(e) =>
                  setCycleFormData({
                    ...cycleFormData,
                    cycleStartHebrewDay: parseInt(e.target.value) || 1,
                  })
                }
                className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                required
              />
              <p className="text-xs text-fg-muted mt-1">
                The day of the Hebrew month (1–30). If you pick 30 in a 29-day Hebrew month, the
                cycle starts on the 29th of that month.
              </p>
              <p className="text-xs text-fg-muted mt-1">
                For reference, today is{' '}
                <span className="font-medium text-fg">
                  {convertToHebrewDate(new Date()) || '—'}
                </span>
                .
              </p>
            </div>
          </>
        )}

        <div className="border-t border-border pt-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={cycleFormData.cycleAutoRollover}
              onChange={(e) =>
                setCycleFormData({
                  ...cycleFormData,
                  cycleAutoRollover: e.target.checked,
                })
              }
              className="mt-1 h-4 w-4 text-orange-600 focus:ring-orange-500 border-border rounded"
            />
            <span>
              <span className="block text-sm font-medium text-fg">
                Auto-charge families on each cycle start
              </span>
              <span className="block text-xs text-fg-muted mt-1">
                When enabled, a daily background job will charge every family their plan&rsquo;s
                yearly price the moment the cycle date arrives in the calendar you picked above. Each
                charge is recorded once per cycle — re-running the job on the same day is safe and
                has no effect. Leave this off if you want to keep handling annual billing manually.
              </span>
            </span>
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-fg">Description</label>
          <input
            type="text"
            value={cycleFormData.description}
            onChange={(e) => setCycleFormData({ ...cycleFormData, description: e.target.value })}
            className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            placeholder="Membership cycle start date"
          />
          <p className="text-xs text-fg-muted mt-1">Optional description for this cycle configuration</p>
        </div>

        <div className="pt-4 border-t">
          <div className="bg-accent/10 border border-accent/20 rounded-lg p-4 mb-4">
            <p className="text-sm text-accent-hover">
              <strong>How it works:</strong> When the cycle start date arrives each year, family
              balances will be increased based on their payment plans. This ensures that membership
              fees are properly tracked and calculated annually.
            </p>
          </div>

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={saving}
              className="focus-ring px-4 py-2 bg-accent text-accent-fg rounded-md hover:bg-accent-hover transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : cycleConfig ? 'Update Configuration' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
