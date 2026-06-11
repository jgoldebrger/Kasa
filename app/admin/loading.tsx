import { SkeletonRows } from '../components/ui/Skeleton'

export default function AdminLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 md:px-8" role="status" aria-label="Loading admin tools">
      <div className="ui-skeleton mb-6 h-7 w-40 rounded-md" />
      <SkeletonRows count={6} />
    </div>
  )
}
