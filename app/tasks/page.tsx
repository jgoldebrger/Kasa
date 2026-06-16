import { Suspense } from 'react'
import { requireServerOrgContext } from '@/lib/auth-server'
import connectDB from '@/lib/database'
import { Task } from '@/lib/models'
import { TASKS_LIST_PAGE_SIZE } from '@/lib/client/tasks-list'
import { encodeCompoundCursor } from '@/lib/pagination'
import TasksView from './TasksView'
import TasksLoading from './loading'

export const dynamic = 'force-dynamic'

async function fetchInitialTasks(organizationId: string) {
  await connectDB()
  const rows = await Task.find({ organizationId })
    .select(
      'title description dueDate email status priority relatedFamilyId relatedMemberId relatedPaymentId organizationId createdAt updatedAt completedAt',
    )
    .populate('relatedFamilyId', 'name')
    .populate('relatedMemberId', 'firstName lastName')
    .sort({ dueDate: 1, priority: -1, _id: 1 })
    .limit(TASKS_LIST_PAGE_SIZE + 1)
    .lean<any[]>()

  let nextCursor: string | null = null
  let items = rows
  if (rows.length > TASKS_LIST_PAGE_SIZE) {
    items = rows.slice(0, TASKS_LIST_PAGE_SIZE)
    const last = items[items.length - 1]
    if (last) {
      nextCursor = encodeCompoundCursor({
        v: last.dueDate ? new Date(last.dueDate).getTime() : null,
        id: String(last._id),
      })
    }
  }

  return {
    items: items.map((t) => JSON.parse(JSON.stringify(t))),
    nextCursor,
  }
}

async function TasksServer() {
  const ctx = await requireServerOrgContext({ minRole: 'admin' })
  try {
    const { items, nextCursor } = await fetchInitialTasks(ctx.organizationId)
    return <TasksView initialTasks={items} initialNextCursor={nextCursor} />
  } catch (err) {
    console.error('[tasks] server prefetch failed:', err)
    return <TasksView />
  }
}

export default function TasksPage() {
  return (
    <Suspense fallback={<TasksLoading />}>
      <TasksServer />
    </Suspense>
  )
}
