'use client'

import TaskFormModal from '@/app/components/tasks/TaskFormModal'
import { useFamilyDetail } from '../FamilyDetailContext'
import {
  FamilyMemberModal,
  FamilyInfoModal,
  FamilyPaymentModal,
  FamilyWithdrawalModal,
  FamilyEventModal,
  FamilyEmailConfigModal,
} from './modals'

export default function FamilyModals() {
  const { params, activeTab, isAdmin, data, showTaskModal, setShowTaskModal, fetchFamilyTasks } =
    useFamilyDetail()

  return (
    <>
      <FamilyMemberModal />
      <FamilyInfoModal />
      <FamilyPaymentModal />
      <FamilyEmailConfigModal />
      <FamilyEventModal />
      <FamilyWithdrawalModal />

      <TaskFormModal
        open={showTaskModal && isAdmin}
        onClose={() => setShowTaskModal(false)}
        defaults={{
          relatedFamilyId:
            typeof params.id === 'string'
              ? params.id
              : Array.isArray(params.id)
                ? params.id[0]
                : '',
          email: data?.family?.email || '',
        }}
        lockFamily
        onCreated={() => {
          if (activeTab === 'tasks') fetchFamilyTasks()
        }}
      />
    </>
  )
}
