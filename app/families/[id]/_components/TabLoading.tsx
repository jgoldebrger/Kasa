import { SkeletonRows } from '@/app/components/ui'

export default function TabLoading() {
  return (
    <div className="py-4" role="status" aria-label="Loading tab">
      <SkeletonRows count={6} />
    </div>
  )
}
