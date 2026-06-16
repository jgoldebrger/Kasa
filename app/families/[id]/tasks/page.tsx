'use client'

import dynamic from 'next/dynamic'
import TabLoading from '../_components/TabLoading'

const TasksTab = dynamic(() => import('../_components/TasksTab'), {
  loading: () => <TabLoading />,
})

export default function FamilyTasksPage() {
  return <TasksTab />
}
