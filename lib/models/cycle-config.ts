import mongoose, { Schema } from 'mongoose'

const CycleConfigSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true, unique: true },
  // Which calendar drives the cycle start.
  //   - 'gregorian' → use `cycleStartMonth` (1–12) + `cycleStartDay` (1–31).
  //   - 'hebrew'    → use `cycleStartHebrewMonth` (1–13) + `cycleStartHebrewDay` (1–30).
  //                   Month 12 is Adar in a regular year and Adar I in a
  //                   leap year; month 13 only exists in leap years (Adar II).
  cycleCalendar: { type: String, enum: ['gregorian', 'hebrew'], default: 'gregorian' },
  cycleStartMonth: { type: Number, required: true, min: 1, max: 12 }, // 1-12 (January-December)
  cycleStartDay: { type: Number, required: true, min: 1, max: 31 }, // Day of month
  cycleStartHebrewMonth: { type: Number, default: 7, min: 1, max: 13 }, // 7 = Tishrei
  cycleStartHebrewDay: { type: Number, default: 1, min: 1, max: 30 },
  // Opt-in for the daily /api/jobs/cycle-rollover cron. When `true`, on
  // each new cycle start the job creates one `CycleCharge` per family
  // capturing that cycle's expected dues at the family's current plan.
  // Defaults to `false` so existing orgs see no behavior change until
  // an admin opts in from Settings → Cycle. Without this rollover the
  // per-family balance math only ever subtracts ONE year of plan price
  // regardless of how many years a family has been around — enabling
  // this is what makes long-term family balances arithmetically correct.
  cycleAutoRollover: { type: Boolean, default: false },
  description: { type: String, default: 'Membership cycle start date' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

export const CycleConfig = mongoose.models.CycleConfig || mongoose.model('CycleConfig', CycleConfigSchema)
