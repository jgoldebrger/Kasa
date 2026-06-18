'use client'

import { Card, SkeletonRows } from '@/app/components/ui'

export default function PanelSkeleton() {
  return (
    <Card className="mb-6">
      <SkeletonRows count={5} />
    </Card>
  )
}
