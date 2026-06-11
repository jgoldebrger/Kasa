import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import { Family, Task } from '@/lib/models'
import TasksView from './TasksView'
import TasksLoading from './loading'

export const dynamic = 'force-dynamic'

async function fetchInitialTasksData(organizationId: string) {
  await connectDB()

  // Default filter on the page is "all" — mirror what /api/tasks returns
  // for an unfiltered request. We only need a slim families list (for the
  // assignee dropdown), so project just _id + name + hebrewName.
  const [taskDocs, familyDocs] = await Promise.all([
    Task.find({ organizationId })
      .select(
        'title description dueDate email status priority relatedFamilyId relatedMemberId relatedPaymentId organizationId createdAt updatedAt completedAt',
      )
      .populate('relatedFamilyId', 'name')
      .populate('relatedMemberId', 'firstName lastName')
      .sort({ dueDate: 1, priority: -1 })
      .lean<any[]>(),
    Family.find({ organizationId })
      .select('_id name hebrewName')
      .sort({ name: 1 })
      .lean<any[]>(),
  ])

  // JSON round-trip flattens ObjectId/Date into plain values so the RSC
  // payload serializer doesn't fall back to its slow path.
  const initialTasks = taskDocs.map((t) => JSON.parse(JSON.stringify(t)))
  const initialFamilies = familyDocs.map((f) => JSON.parse(JSON.stringify(f)))
  return { initialTasks, initialFamilies }
}

async function TasksServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin' })
  let initialTasks: any[] = []
  let initialFamilies: any[] = []
  try {
    const data = await fetchInitialTasksData(ctx.organizationId)
    initialTasks = data.initialTasks
    initialFamilies = data.initialFamilies
  } catch (err) {
    console.error('[tasks] server prefetch failed:', err)
  }
  return <TasksView initialTasks={initialTasks} initialFamilies={initialFamilies} />
}

export default function TasksPage() {
  return (
    <Suspense fallback={<TasksLoading />}>
      <TasksServer />
    </Suspense>
  )
}
