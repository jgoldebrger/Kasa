import { SkeletonRows } from '@/app/components/ui/Skeleton'

export default function ReportsLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 md:px-8" role="status" aria-label="Loading reports">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="ui-skeleton mb-2 h-7 w-36 rounded-md" />
          <div className="ui-skeleton h-4 w-64 rounded-md" />
        </div>
        <div className="ui-skeleton h-9 w-32 rounded-md" />
      </div>
      <div className="surface-card p-4">
        <SkeletonRows count={6} />
      </div>
    </div>
  )
}
