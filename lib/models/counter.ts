import mongoose, { Schema } from 'mongoose'

// Counter Schema — atomic sequence generator. Used today for statement
// numbering, where the previous `countDocuments + 1` scheme raced under
// concurrent generation (two clicks → both got the same number).
//
// Each row is keyed by an opaque scope string. The atomic `$inc` on
// `value` is the entire contract — there is no read-then-write window.
const CounterSchema = new Schema(
  {
    _id: { type: String, required: true },
    value: { type: Number, default: 0, required: true },
  },
  { versionKey: false },
)
export const Counter =
  mongoose.models.Counter || mongoose.model('Counter', CounterSchema)

/**
 * Atomically obtain the next sequence value for `scope`. Two concurrent
 * callers cannot get the same number, regardless of MongoDB topology.
 *
 * `seedIfMissing` is consulted only on the very first call for a scope
 * (when the doc doesn't exist yet). It lets us migrate from the old
 * `countDocuments + 1` scheme without restarting at 1.
 */
export async function nextCounter(
  scope: string,
  seedIfMissing: () => Promise<number> = async () => 0,
): Promise<number> {
  const existing = await Counter.findById(scope).lean<{ value: number }>()
  if (!existing) {
    const seed = await seedIfMissing().catch(() => 0)
    await Counter.updateOne(
      { _id: scope },
      { $setOnInsert: { value: Math.max(0, Math.floor(seed)) } },
      { upsert: true },
    ).catch(() => {})
  }
  const doc = await Counter.findOneAndUpdate(
    { _id: scope },
    { $inc: { value: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean<{ value: number }>()
  return doc?.value || 1
}
