import { SkeletonCard, SkeletonRows } from '@/app/components/ui/Skeleton'

export default function ProjectionsLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 md:px-8" role="status" aria-label="Loading projections">
      <div className="mb-6">
        <div className="ui-skeleton mb-2 h-7 w-48 rounded-md" />
        <div className="ui-skeleton h-4 w-72 rounded-md" />
      </div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="surface-card p-4">
        <SkeletonRows count={6} />
      </div>
    </div>
  )
}
