'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { PencilIcon } from '@heroicons/react/24/outline'
import { convertToHebrewDate } from '@/lib/hebrew-date'
import {
  handleHebrewInput,
  capitalizeName,
  formatPhone,
  validateEmail,
  type FamilyDetails,
} from './helpers'
import type { FamilyTabId } from './constants'

const EMPTY_MEMBER_FORM = {
  firstName: '',
  hebrewFirstName: '',
  lastName: '',
  hebrewLastName: '',
  birthDate: '',
  hebrewBirthDate: '',
  gender: '' as '' | 'male' | 'female',
  weddingDate: '',
  spouseName: '',
  spouseFirstName: '',
  spouseHebrewName: '',
  spouseFatherHebrewName: '',
  spouseCellPhone: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  state: '',
  zip: '',
}

export interface UseFamilyMemberActionsOptions {
  familyId: string
  isAdmin: boolean
  activeTab: FamilyTabId
  data: FamilyDetails | null
  refreshFamily: (sharedGen?: number) => Promise<void>
  toast: { success: (msg: string) => void; error: (msg: string) => void }
  confirm: (opts: {
    title?: string
    message: string
    destructive?: boolean
    confirmLabel?: string
  }) => Promise<boolean>
}

export function useFamilyMemberActions({
  familyId,
  isAdmin,
  activeTab,
  data,
  refreshFamily,
  toast,
  confirm,
}: UseFamilyMemberActionsOptions) {
  const [showMemberModal, setShowMemberModal] = useState(false)
  const [editingMember, setEditingMember] = useState<any>(null)
  const [viewingMemberId, setViewingMemberId] = useState<string | null>(null)
  const [memberActiveTab, setMemberActiveTab] = useState<
    'info' | 'balance' | 'payments' | 'statements'
  >('info')
  const [memberBalance, setMemberBalance] = useState<any>(null)
  const [memberPayments, setMemberPayments] = useState<any[]>([])
  const [memberStatements, setMemberStatements] = useState<any[]>([])
  const [loadingMemberFinancials, setLoadingMemberFinancials] = useState(false)
  const [editingMemberField, setEditingMemberField] = useState<string | null>(null)
  const [editMemberValue, setEditMemberValue] = useState<string>('')
  const [memberForm, setMemberForm] = useState(EMPTY_MEMBER_FORM)

  const memberFetchGenRef = useRef(0)

  const getFamilyLastName = useCallback((): string => {
    if (!data?.family) return ''

    if (data.members && data.members.length > 0) {
      const lastName = data.members[0].lastName
      if (lastName) return lastName
    }

    const familyName = data.family.name || ''
    let lastName = ''
    const nameWithoutSuffix = familyName.replace(/\s+Family$/i, '').trim()

    if (nameWithoutSuffix.includes('&')) {
      const parts = nameWithoutSuffix.split('&')
      if (parts.length > 1) {
        const afterAmpersand = parts[parts.length - 1].trim()
        const words = afterAmpersand.split(/\s+/)
        lastName = words[words.length - 1]
      }
    } else {
      const words = nameWithoutSuffix.split(/\s+/)
      lastName = words[words.length - 1]
    }

    return lastName || ''
  }, [data])

  const openAddMemberModal = useCallback(() => {
    const familyLastName = getFamilyLastName()
    setMemberForm({
      ...EMPTY_MEMBER_FORM,
      lastName: familyLastName,
    })
    setEditingMember(null)
    setShowMemberModal(true)
  }, [getFamilyLastName])

  useEffect(() => {
    if (data?.family) {
      const urlParams = new URLSearchParams(window.location.search)
      if (isAdmin && urlParams.get('add') === 'true' && activeTab === 'members') {
        openAddMemberModal()
        window.history.replaceState({}, '', window.location.pathname)
      }
    }
  }, [data, isAdmin, openAddMemberModal, activeTab])

  useEffect(() => {
    if (!viewingMemberId) {
      setMemberBalance(null)
      setMemberPayments([])
      setMemberStatements([])
      return
    }
    const gen = ++memberFetchGenRef.current
    void (async () => {
      if (!viewingMemberId || !isAdmin) return
      setLoadingMemberFinancials(true)
      try {
        if (memberActiveTab === 'balance') {
          const res = await fetch(`/api/members/${viewingMemberId}/balance`)
          if (memberFetchGenRef.current !== gen) return
          if (res.ok) {
            const balance = await res.json().catch(() => null)
            if (memberFetchGenRef.current !== gen) return
            setMemberBalance(balance)
          } else {
            if (memberFetchGenRef.current !== gen) return
            toast.error('Could not load member balance.')
          }
        } else if (memberActiveTab === 'payments') {
          const res = await fetch(`/api/members/${viewingMemberId}/payments`)
          if (memberFetchGenRef.current !== gen) return
          if (res.ok) {
            const payments = await res.json().catch(() => [])
            if (memberFetchGenRef.current !== gen) return
            setMemberPayments(payments)
          } else {
            if (memberFetchGenRef.current !== gen) return
            toast.error('Could not load member payments.')
          }
        } else if (memberActiveTab === 'statements') {
          const res = await fetch(`/api/members/${viewingMemberId}/statements`)
          if (memberFetchGenRef.current !== gen) return
          if (res.ok) {
            const statements = await res.json().catch(() => [])
            if (memberFetchGenRef.current !== gen) return
            setMemberStatements(statements)
          } else {
            if (memberFetchGenRef.current !== gen) return
            toast.error('Could not load member statements.')
          }
        }
      } catch (error) {
        if (memberFetchGenRef.current !== gen) return
        console.error('Error fetching member financials:', error)
      } finally {
        if (memberFetchGenRef.current === gen) setLoadingMemberFinancials(false)
      }
    })()
    return () => {
      memberFetchGenRef.current += 1
    }
  }, [viewingMemberId, memberActiveTab, isAdmin, toast])

  const fetchMemberFinancials = useCallback(async () => {
    if (!viewingMemberId || !isAdmin) return
    const gen = ++memberFetchGenRef.current
    setLoadingMemberFinancials(true)
    try {
      if (memberActiveTab === 'balance') {
        const res = await fetch(`/api/members/${viewingMemberId}/balance`)
        if (memberFetchGenRef.current !== gen) return
        if (res.ok) {
          const balance = await res.json().catch(() => null)
          if (memberFetchGenRef.current !== gen) return
          setMemberBalance(balance)
        } else {
          if (memberFetchGenRef.current !== gen) return
          toast.error('Could not load member balance.')
        }
      } else if (memberActiveTab === 'payments') {
        const res = await fetch(`/api/members/${viewingMemberId}/payments`)
        if (memberFetchGenRef.current !== gen) return
        if (res.ok) {
          const payments = await res.json().catch(() => [])
          if (memberFetchGenRef.current !== gen) return
          setMemberPayments(payments)
        } else {
          if (memberFetchGenRef.current !== gen) return
          toast.error('Could not load member payments.')
        }
      } else if (memberActiveTab === 'statements') {
        const res = await fetch(`/api/members/${viewingMemberId}/statements`)
        if (memberFetchGenRef.current !== gen) return
        if (res.ok) {
          const statements = await res.json().catch(() => [])
          if (memberFetchGenRef.current !== gen) return
          setMemberStatements(statements)
        } else {
          if (memberFetchGenRef.current !== gen) return
          toast.error('Could not load member statements.')
        }
      }
    } catch (error) {
      if (memberFetchGenRef.current !== gen) return
      console.error('Error fetching member financials:', error)
    } finally {
      if (memberFetchGenRef.current === gen) setLoadingMemberFinancials(false)
    }
  }, [viewingMemberId, memberActiveTab, isAdmin, toast])

  const handleMemberFieldEdit = (fieldName: string, currentValue: any, memberId: string) => {
    if ((fieldName === 'birthDate' || fieldName === 'weddingDate') && currentValue) {
      const date = new Date(currentValue)
      setEditMemberValue(date.toISOString().split('T')[0])
    } else {
      setEditMemberValue(currentValue || '')
    }
    setEditingMemberField(`${memberId}-${fieldName}`)
  }

  const handleMemberFieldSave = async (fieldName: string, memberId: string) => {
    try {
      const member = data?.members?.find((m: any) => m._id === memberId)
      if (!member) {
        toast.error('Member not found')
        return
      }

      let finalValue = editMemberValue || ''

      const phoneFields = ['phone', 'spouseCellPhone']
      const emailFields = ['email']
      const nameFields = ['firstName', 'lastName', 'spouseFirstName', 'spouseName']
      const addressFields = ['city', 'state', 'address']

      if (phoneFields.includes(fieldName)) {
        finalValue = formatPhone(finalValue)
      } else if (emailFields.includes(fieldName)) {
        if (finalValue && !validateEmail(finalValue)) {
          toast.error('Please enter a valid email address')
          return
        }
      } else if (nameFields.includes(fieldName) || addressFields.includes(fieldName)) {
        finalValue = capitalizeName(finalValue.trim())
      } else {
        finalValue = finalValue.trim()
      }

      const updateData: any = {
        firstName: member.firstName || '',
        lastName: member.lastName || '',
        birthDate: member.birthDate ? new Date(member.birthDate) : new Date(),
        hebrewFirstName: member.hebrewFirstName || '',
        hebrewLastName: member.hebrewLastName || '',
        gender: member.gender || '',
        weddingDate: member.weddingDate ? new Date(member.weddingDate) : undefined,
        spouseName: member.spouseName || '',
        spouseFirstName: member.spouseFirstName || '',
        spouseHebrewName: member.spouseHebrewName || '',
        spouseFatherHebrewName: member.spouseFatherHebrewName || '',
        spouseCellPhone: member.spouseCellPhone || '',
        phone: member.phone || '',
        email: member.email || '',
        address: member.address || '',
        city: member.city || '',
        state: member.state || '',
        zip: member.zip || '',
      }

      if (fieldName === 'birthDate' || fieldName === 'weddingDate') {
        if (finalValue) {
          updateData[fieldName] = new Date(finalValue)
          if (fieldName === 'birthDate') {
            const hebrewDate = convertToHebrewDate(new Date(finalValue))
            updateData.hebrewBirthDate = hebrewDate
          }
        } else {
          updateData[fieldName] = null
        }
      } else {
        updateData[fieldName] = finalValue
      }

      Object.keys(updateData).forEach((key) => {
        if (updateData[key] === undefined) {
          delete updateData[key]
        }
      })

      if (fieldName !== 'birthDate' && fieldName !== 'weddingDate') {
        updateData[fieldName] = finalValue
      }

      const res = await fetch(`/api/families/${familyId}/members/${memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      if (res.ok) {
        await res.json()
        setEditingMemberField(null)
        setEditMemberValue('')
        await refreshFamily()
      } else {
        const errorData = await res.json().catch(() => ({}))
        console.error('Error updating field:', errorData)
        toast.error(`Error updating field: ${errorData.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Error updating member field:', error)
      toast.error('Error updating field. Please try again.')
    }
  }

  const handleMemberFieldCancel = () => {
    setEditingMemberField(null)
    setEditMemberValue('')
  }

  const renderEditableMemberField = (
    fieldName: string,
    displayValue: string | React.ReactNode,
    fieldType: 'text' | 'date' | 'select' | 'hebrew' | 'phone' | 'email' | 'name' = 'text',
    memberId: string,
    options?: { value: string; label: string }[],
  ) => {
    if (!isAdmin) {
      return <div className="flex-1 min-w-0">{displayValue}</div>
    }

    const isEditing = editingMemberField === `${memberId}-${fieldName}`
    const member = data?.members?.find((m: any) => m._id === memberId)
    const currentValue = member?.[fieldName] || ''

    const getInputProps = () => {
      if (fieldType === 'phone') {
        return {
          type: 'tel' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditMemberValue(formatPhone(e.target.value))
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleMemberFieldSave(fieldName, memberId)
            if (e.key === 'Escape') handleMemberFieldCancel()
          },
          placeholder: '(555) 555-5555',
          inputMode: 'tel' as const,
        }
      } else if (fieldType === 'email') {
        return {
          type: 'email' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditMemberValue(e.target.value)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              if (validateEmail(editMemberValue)) {
                handleMemberFieldSave(fieldName, memberId)
              } else {
                toast.error('Please enter a valid email address')
              }
            }
            if (e.key === 'Escape') handleMemberFieldCancel()
          },
          onBlur: () => {
            if (editMemberValue && !validateEmail(editMemberValue)) {
              toast.error('Please enter a valid email address')
            }
          },
        }
      } else if (fieldType === 'name') {
        return {
          type: 'text' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            setEditMemberValue(e.target.value)
          },
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleMemberFieldSave(fieldName, memberId)
            if (e.key === 'Escape') handleMemberFieldCancel()
          },
          onBlur: () => {
            if (editMemberValue) {
              const capitalized = capitalizeName(editMemberValue)
              setEditMemberValue(capitalized)
            }
          },
        }
      } else if (fieldType === 'date') {
        return {
          type: 'date' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditMemberValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleMemberFieldSave(fieldName, memberId)
            if (e.key === 'Escape') handleMemberFieldCancel()
          },
        }
      } else if (fieldType === 'hebrew') {
        return {
          type: 'text' as const,
          dir: 'rtl' as const,
          lang: 'he' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditMemberValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleMemberFieldSave(fieldName, memberId)
            if (e.key === 'Escape') handleMemberFieldCancel()
            handleHebrewInput(e, setEditMemberValue)
          },
          style: { fontFamily: 'Arial Hebrew, David, sans-serif' },
        }
      } else {
        return {
          type: 'text' as const,
          value: editMemberValue,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditMemberValue(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleMemberFieldSave(fieldName, memberId)
            if (e.key === 'Escape') handleMemberFieldCancel()
          },
        }
      }
    }

    if (isEditing) {
      return (
        <div
          className="flex items-center gap-2"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {fieldType === 'select' && options ? (
            <select
              value={editMemberValue}
              onChange={(e) => setEditMemberValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleMemberFieldCancel()
              }}
              className="flex-1 border border-accent/30 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent bg-surface text-fg"
              autoFocus
            >
              <option value="">Select...</option>
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              {...getInputProps()}
              className="flex-1 border border-accent/30 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent bg-surface text-fg"
              autoFocus
            />
          )}
          <button
            onClick={() => handleMemberFieldSave(fieldName, memberId)}
            className="text-success hover:text-success font-bold"
            title="Save"
          >
            ✓
          </button>
          <button
            onClick={handleMemberFieldCancel}
            className="text-danger hover:text-danger font-bold"
            title="Cancel"
          >
            ✕
          </button>
        </div>
      )
    }

    return (
      <div
        role="button"
        tabIndex={0}
        onMouseDown={(e) => {
          e.preventDefault()
          handleMemberFieldEdit(fieldName, currentValue, memberId)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleMemberFieldEdit(fieldName, currentValue, memberId)
          }
        }}
        className="group flex min-h-[2.5rem] cursor-text items-center justify-between gap-2 rounded-md border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-app-subtle"
        title="Click to edit"
      >
        <div className="min-w-0 flex-1 text-sm">{displayValue}</div>
        <PencilIcon
          className="h-4 w-4 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </div>
    )
  }

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()

    const formattedForm = {
      ...memberForm,
      firstName: capitalizeName(memberForm.firstName),
      lastName: capitalizeName(memberForm.lastName),
      spouseFirstName: memberForm.spouseFirstName ? capitalizeName(memberForm.spouseFirstName) : '',
      spouseName: memberForm.spouseName ? capitalizeName(memberForm.spouseName) : '',
      phone: memberForm.phone ? formatPhone(memberForm.phone) : '',
      spouseCellPhone: memberForm.spouseCellPhone ? formatPhone(memberForm.spouseCellPhone) : '',
      email: memberForm.email || '',
      weddingDate: memberForm.weddingDate || undefined,
      address: memberForm.address || undefined,
      city: memberForm.city || undefined,
      state: memberForm.state || undefined,
      zip: memberForm.zip || undefined,
    }

    if (formattedForm.email && !validateEmail(formattedForm.email)) {
      toast.error('Please enter a valid email address')
      return
    }

    try {
      const res = await fetch('/api/families/' + familyId + '/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formattedForm, familyId }),
      })
      if (res.ok) {
        setShowMemberModal(false)
        setEditingMember(null)
        setMemberForm(EMPTY_MEMBER_FORM)
        void refreshFamily()
      } else {
        const error = await res.json().catch(() => ({}))
        toast.error(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error adding member:', error)
      toast.error('Error adding member')
    }
  }

  const handleEditMember = (member: any) => {
    setEditingMember(member)
    setMemberForm({
      firstName: member.firstName,
      hebrewFirstName: member.hebrewFirstName || '',
      lastName: member.lastName,
      hebrewLastName: member.hebrewLastName || '',
      birthDate: new Date(member.birthDate).toISOString().split('T')[0],
      hebrewBirthDate: member.hebrewBirthDate || convertToHebrewDate(new Date(member.birthDate)),
      gender: member.gender || '',
      weddingDate: member.weddingDate
        ? new Date(member.weddingDate).toISOString().split('T')[0]
        : '',
      spouseName: member.spouseName || '',
      spouseFirstName: member.spouseFirstName || '',
      spouseHebrewName: member.spouseHebrewName || '',
      spouseFatherHebrewName: member.spouseFatherHebrewName || '',
      spouseCellPhone: member.spouseCellPhone || '',
      phone: member.phone || '',
      email: member.email || '',
      address: member.address || '',
      city: member.city || '',
      state: member.state || '',
      zip: member.zip || '',
    })
    setShowMemberModal(true)
  }

  const handleUpdateMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingMember) return

    const formattedData = {
      firstName: capitalizeName(memberForm.firstName),
      hebrewFirstName: memberForm.hebrewFirstName,
      lastName: capitalizeName(memberForm.lastName),
      hebrewLastName: memberForm.hebrewLastName,
      birthDate: memberForm.birthDate,
      hebrewBirthDate: memberForm.hebrewBirthDate,
      gender: memberForm.gender,
      weddingDate: memberForm.weddingDate || undefined,
      spouseName: memberForm.spouseName ? capitalizeName(memberForm.spouseName) : undefined,
      spouseFirstName: memberForm.spouseFirstName
        ? capitalizeName(memberForm.spouseFirstName)
        : undefined,
      spouseHebrewName: memberForm.spouseHebrewName || undefined,
      spouseFatherHebrewName: memberForm.spouseFatherHebrewName || undefined,
      spouseCellPhone: memberForm.spouseCellPhone
        ? formatPhone(memberForm.spouseCellPhone)
        : undefined,
      phone: memberForm.phone ? formatPhone(memberForm.phone) : undefined,
      email: memberForm.email || undefined,
      address: memberForm.address || undefined,
      city: memberForm.city || undefined,
      state: memberForm.state || undefined,
      zip: memberForm.zip || undefined,
    }

    if (formattedData.email && !validateEmail(formattedData.email)) {
      toast.error('Please enter a valid email address')
      return
    }

    try {
      const res = await fetch(`/api/families/${familyId}/members/${editingMember._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formattedData),
      })
      if (res.ok) {
        setShowMemberModal(false)
        setEditingMember(null)
        setMemberForm(EMPTY_MEMBER_FORM)
        if (memberForm.weddingDate) {
          toast.success(
            `Wedding date set. ${memberForm.firstName} ${memberForm.lastName} will be automatically converted to a new family on ${new Date(memberForm.weddingDate).toLocaleDateString()}.`,
          )
        }
        void refreshFamily()
      } else {
        const error = await res.json().catch(() => ({}))
        console.error('Update error response:', error)
        toast.error(`Error: ${error.error || error.details || 'Failed to update member'}`)
      }
    } catch (error: any) {
      console.error('Error updating member:', error)
      toast.error(`Error updating member: ${error.message || 'Unknown error'}`)
    }
  }

  const handleDeleteMember = async (member: any) => {
    if (
      !(await confirm({
        message: `Are you sure you want to delete ${member.firstName} ${member.lastName}?`,
        destructive: true,
        confirmLabel: 'Delete',
      }))
    ) {
      return
    }

    try {
      const res = await fetch(`/api/families/${familyId}/members/${member._id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        void refreshFamily()
      } else {
        const error = await res.json().catch(() => ({}))
        toast.error(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error deleting member:', error)
      toast.error('Error deleting member')
    }
  }

  const resetMemberState = useCallback(() => {
    memberFetchGenRef.current += 1
    setMemberBalance(null)
    setMemberPayments([])
    setMemberStatements([])
    setViewingMemberId(null)
    setEditingMemberField(null)
  }, [])

  return {
    showMemberModal,
    setShowMemberModal,
    editingMember,
    setEditingMember,
    viewingMemberId,
    setViewingMemberId,
    memberActiveTab,
    setMemberActiveTab,
    memberBalance,
    memberPayments,
    memberStatements,
    loadingMemberFinancials,
    editingMemberField,
    editMemberValue,
    setEditingMemberField,
    setEditMemberValue,
    memberForm,
    setMemberForm,
    getFamilyLastName,
    openAddMemberModal,
    fetchMemberFinancials,
    renderEditableMemberField,
    handleMemberFieldEdit,
    handleMemberFieldSave,
    handleMemberFieldCancel,
    handleAddMember,
    handleEditMember,
    handleUpdateMember,
    handleDeleteMember,
    resetMemberState,
    memberFetchGenRef,
  }
}
