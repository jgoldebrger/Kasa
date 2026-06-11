import mongoose, { Schema } from 'mongoose'

// SavedReport Schema (Report Builder).
// A saved report is a serialized pivot configuration over one of the
// fixed data sources (payments / events / members / families). We store
// the configuration — not the resulting rows — so the report always
// reflects the live state of the underlying collections.
const SavedReportSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  // The user who created the report. We keep reports org-shared by
  // default (any admin can see them); a `private: true` flag could be
  // added later for personal reports.
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 1000 },
  // Source identifies which collection drives the report.
  source: {
    type: String,
    enum: ['payments', 'events', 'members', 'families'],
    required: true,
  },
  // Pivot config — row/column dimensions and aggregations.
  // Shape (validated by Zod at the API layer, not by Mongoose):
  //   rowDim:    string         — column id to group rows by ('' => no row grouping)
  //   colDim:    string         — column id to group columns by ('' => no column split)
  //   measure:   string         — column id whose values we aggregate
  //   aggregate: enum           — 'count' | 'sum' | 'avg' | 'min' | 'max'
  //   filters:   Record         — { columnId: { op, value } }
  //   dateRange: { from?, to? } — applied to the source's date field
  config: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true })
// Saved-report names must be unique per org so the picker UI can show
// a stable list keyed by name. Without this, duplicate "Year-End"
// reports silently coexist and which one opens depends on insertion
// order.
SavedReportSchema.index({ organizationId: 1, name: 1 }, { unique: true })

export const SavedReport =
  mongoose.models.SavedReport || mongoose.model('SavedReport', SavedReportSchema)
