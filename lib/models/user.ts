import mongoose, { Schema } from 'mongoose'

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    // Optional for OIDC-only accounts (no local password login).
    hashedPassword: { type: String },
    name: { type: String, required: true },
    emailVerified: Date,
    image: String,
    lastActiveOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    // Bumped whenever the user's password is reset / changed. Existing JWTs
    // issued before this timestamp are rejected by the server-side JWT callback,
    // which forces a re-login on every device after a reset.
    passwordChangedAt: { type: Date },
    // Two-factor authentication (TOTP / RFC 6238).
    // - `twoFactorSecret` is the base32-encoded TOTP secret, encrypted at
    //   rest via lib/encryption (same envelope as EmailConfig.password).
    //   Selected explicitly with `.select('+twoFactorSecret')` because we
    //   exclude it from default lean reads.
    // - `twoFactorBackupCodes` holds bcrypt hashes of single-use recovery
    //   codes shown once at enrollment. Each code is removed from the array
    //   when consumed.
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    twoFactorBackupCodes: { type: [String], default: [], select: false },
    // Last successful HOTP counter step. Used by app/auth.ts to reject
    // replayed TOTP codes within the ±30s skew window — the atomic
    // updateOne only succeeds when the candidate step is strictly newer
    // than this. `select: false` so the secret/step never ships to the
    // client by accident.
    twoFactorLastUsedStep: { type: Number, select: false },
    // Per-user UI preferences that should follow the user across devices.
    // - `tableColumns[tableId][columnId]   = visible (boolean)`
    // - `tableColumnOrder[tableId]         = string[] (ordered column ids)`
    // `Schema.Types.Mixed` is intentional so we can extend the shape later
    // without a migration.
    preferences: {
      type: {
        tableColumns: { type: Schema.Types.Mixed, default: {} },
        tableColumnOrder: { type: Schema.Types.Mixed, default: {} },
        notificationPreferences: {
          tasks: { type: Boolean, default: true },
          payments: { type: Boolean, default: true },
          statements: { type: Boolean, default: true },
        },
      },
      default: () => ({
        tableColumns: {},
        tableColumnOrder: {},
        notificationPreferences: { tasks: true, payments: true, statements: true },
      }),
    },
  },
  { timestamps: true },
)

export const User = mongoose.models.User || mongoose.model('User', UserSchema)
