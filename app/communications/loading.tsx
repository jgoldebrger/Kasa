import { SkeletonRows } from '@/app/components/ui'

export default function CommunicationsLoading() {
  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <SkeletonRows count={10} />
      </div>
    </div>
  )
}
