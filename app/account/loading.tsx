import { SkeletonRows } from '../components/ui/Skeleton'

export default function AccountLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 md:px-8" role="status" aria-label="Loading account settings">
      <div className="ui-skeleton mb-6 h-7 w-48 rounded-md" />
      <div className="ui-skeleton mb-8 h-4 w-72 rounded-md" />
      <SkeletonRows count={6} />
    </div>
  )
}
