import mongoose, { Schema } from 'mongoose'

// Yearly Calculation Schema
//
// Per-year cached snapshot of an organization's income / expense / balance
// math. The only shape — there is no legacy back-compat layer:
//
//   - `byPlan`  : one entry per configured PaymentPlan that contributed
//   - `byEvent` : one entry per configured LifecycleEvent that contributed
//   - aggregates (`planIncome`, `totalIncome`, `totalExpenses`,
//     `calculatedIncome`, `calculatedExpenses`, `balance`, …) consumed
//     by the dashboard prefetch + the calculations summary table.
//
// Pre-refactor snapshots that used `plan1..plan4` / `chasenaCount`-style
// fixed slots will read back as empty (zeros / undefined arrays). One
// click on "Calculate Year" rewrites them in this shape.
const YearlyPlanBreakdownSchema = new Schema({
  planNumber: { type: Number, required: true },
  name: { type: String, default: '' },
  count: { type: Number, default: 0 },
  income: { type: Number, default: 0 },
}, { _id: false })
const YearlyEventBreakdownSchema = new Schema({
  type: { type: String, required: true },
  name: { type: String, default: '' },
  count: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
}, { _id: false })
const YearlyCalculationSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  year: { type: Number, required: true },
  byPlan: { type: [YearlyPlanBreakdownSchema], default: undefined },
  byEvent: { type: [YearlyEventBreakdownSchema], default: undefined },
  totalPayments: { type: Number, default: 0 }, // Informational, not added to income.
  planIncome: { type: Number, default: 0 },
  totalIncome: { type: Number, default: 0 },
  totalExpenses: { type: Number, default: 0 },
  extraDonation: { type: Number, default: 0 },
  extraExpense: { type: Number, default: 0 },
  calculatedIncome: { type: Number, default: 0 },
  calculatedExpenses: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
}, { timestamps: true })
YearlyCalculationSchema.index({ organizationId: 1, year: 1 }, { unique: true })

export const YearlyCalculation = mongoose.models.YearlyCalculation || mongoose.model('YearlyCalculation', YearlyCalculationSchema)
