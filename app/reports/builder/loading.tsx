import { SkeletonRows } from '../../components/ui/Skeleton'

export default function ReportsBuilderLoading() {
  return (
    <div className="px-4 py-6 sm:px-6 md:px-8" role="status" aria-label="Loading report builder">
      <div className="ui-skeleton mb-4 h-7 w-56 rounded-md" />
      <div className="ui-skeleton mb-8 h-4 w-72 rounded-md" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 mb-6">
        <div className="ui-skeleton h-48 rounded-lg" />
        <div className="ui-skeleton h-48 rounded-lg lg:col-span-2" />
      </div>
      <SkeletonRows count={6} />
    </div>
  )
}
