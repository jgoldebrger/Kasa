import mongoose, { Schema } from 'mongoose'
import { softDeletePlugin } from './soft-delete-plugin'

const TaskSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  title: { type: String, required: true },
  description: String,
  dueDate: { type: Date, required: true },
  email: { type: String, required: true }, // Email to notify on due date
  status: { 
    type: String, 
    enum: ['pending', 'in_progress', 'completed', 'cancelled'], 
    default: 'pending' 
  },
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'urgent'], 
    default: 'medium' 
  },
  relatedFamilyId: { type: Schema.Types.ObjectId, ref: 'Family' },
  relatedMemberId: { type: Schema.Types.ObjectId, ref: 'FamilyMember' },
  relatedPaymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
  emailSent: { type: Boolean, default: false }, // Track if email was sent
  completedAt: Date,
  notes: String,
}, { timestamps: true })
TaskSchema.index({ organizationId: 1, dueDate: 1 })
// Due-date email cron filters by `organizationId + dueDate + emailSent
// + status`; the existing index handles the first two but
// `emailSent`/`status` were post-filtered in memory. Add a compound
// index that supports the full predicate.
TaskSchema.index({ organizationId: 1, dueDate: 1, emailSent: 1, status: 1 })
TaskSchema.plugin(softDeletePlugin)

export const Task = mongoose.models.Task || mongoose.model('Task', TaskSchema)
