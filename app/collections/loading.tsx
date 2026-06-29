import { SkeletonRows } from '@/app/components/ui'

export default function CollectionsLoading() {
  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="h-8 w-48 bg-fg/10 rounded animate-pulse mb-6" />
      <SkeletonRows count={8} />
    </div>
  )
}
