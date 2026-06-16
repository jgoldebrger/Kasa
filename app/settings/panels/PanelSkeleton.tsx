'use client'

import { SkeletonRows } from '@/app/components/ui'

export default function PanelSkeleton() {
  return (
    <div className="surface-card p-6 mb-6">
      <SkeletonRows count={5} />
    </div>
  )
}
