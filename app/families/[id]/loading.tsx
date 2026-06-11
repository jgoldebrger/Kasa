import { SkeletonRows } from '../../components/ui/Skeleton'

export default function FamilyDetailLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 md:px-8" role="status" aria-label="Loading family">
      <div className="ui-skeleton mb-4 h-8 w-60 rounded-md" />
      <div className="ui-skeleton mb-8 h-4 w-80 rounded-md" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
        <div className="ui-skeleton h-24 rounded-lg" />
        <div className="ui-skeleton h-24 rounded-lg" />
        <div className="ui-skeleton h-24 rounded-lg" />
      </div>
      <SkeletonRows count={8} />
    </div>
  )
}
