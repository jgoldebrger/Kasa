import { SkeletonRows } from '@/app/components/ui/Skeleton'

export default function CalculationsLoading() {
  return (
    <main
      className="min-h-screen bg-app-subtle px-4 py-6 sm:px-6 md:px-8"
      role="status"
      aria-label="Loading calculations"
    >
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <div className="ui-skeleton mb-2 h-7 w-64 rounded-md" />
            <div className="ui-skeleton h-4 w-80 rounded-md" />
          </div>
          <div className="ui-skeleton h-10 w-44 rounded-lg" />
        </header>

        <div className="surface-card mb-6 p-6">
          <div className="mb-4">
            <div className="ui-skeleton mb-1.5 h-4 w-20 rounded" />
            <div className="ui-skeleton h-10 w-64 rounded-md" />
          </div>
          <SkeletonRows count={6} />
        </div>

        <div className="surface-card p-6">
          <div className="ui-skeleton mb-4 h-6 w-48 rounded-md" />
          <SkeletonRows count={6} />
        </div>
      </div>
    </main>
  )
}
