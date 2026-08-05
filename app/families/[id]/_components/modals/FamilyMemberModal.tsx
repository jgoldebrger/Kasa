'use client'

import { useState } from 'react'
import { useFamilyDetail } from '../../FamilyDetailContext'
import { capitalizeName, handleHebrewInput } from '../../_lib/helpers'
import { convertToHebrewDate } from '@/lib/hebrew-date'
import { Modal } from '@/app/components/ui/Modal'
import { Button, Input, Select } from '@/app/components/ui'

export function FamilyMemberModal() {
  const {
    isAdmin,
    showMemberModal,
    editingMember,
    setEditingMember,
    memberForm,
    setMemberForm,
    setShowMemberModal,
    handleAddMember,
    handleUpdateMember,
  } = useFamilyDetail()

  const [memberSubmitting, setMemberSubmitting] = useState(false)

  if (!showMemberModal || !isAdmin) return null

  const resetMemberForm = () => {
    setMemberForm({
      firstName: '',
      hebrewFirstName: '',
      lastName: '',
      hebrewLastName: '',
      birthDate: '',
      hebrewBirthDate: '',
      gender: '',
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
    })
  }

  const closeMemberModal = () => {
    setShowMemberModal(false)
    setEditingMember(null)
    resetMemberForm()
  }

  return (
    <Modal
      open
      title={editingMember ? 'Edit Child' : 'Add Child'}
      description="Add a child to the family"
      onClose={closeMemberModal}
      maxWidth="max-w-md"
    >
      <form
        onSubmit={async (e) => {
          if (memberSubmitting) return
          setMemberSubmitting(true)
          try {
            await (editingMember ? handleUpdateMember : handleAddMember)(e)
          } finally {
            setMemberSubmitting(false)
          }
        }}
        className="space-y-4"
      >
        <Input
          label="First Name"
          type="text"
          required
          value={memberForm.firstName}
          onChange={(e) => setMemberForm({ ...memberForm, firstName: e.target.value })}
          onBlur={(e) => {
            if (e.target.value) {
              setMemberForm({ ...memberForm, firstName: capitalizeName(e.target.value) })
            }
          }}
          placeholder="Enter first name"
        />
        <Input
          label="First Name (Hebrew)"
          type="text"
          required
          dir="rtl"
          lang="he"
          inputMode="text"
          value={memberForm.hebrewFirstName}
          onChange={(e) => setMemberForm({ ...memberForm, hebrewFirstName: e.target.value })}
          onKeyDown={(e) =>
            handleHebrewInput(e, (value) =>
              setMemberForm((prev: typeof memberForm) => ({
                ...prev,
                hebrewFirstName: typeof value === 'function' ? value(prev.hebrewFirstName) : value,
              })),
            )
          }
          className="text-right font-hebrew"
          placeholder="שם פרטי בעברית"
          style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
        />
        {editingMember && (
          <Input
            label="Last Name"
            type="text"
            required
            value={memberForm.lastName}
            onChange={(e) => setMemberForm({ ...memberForm, lastName: e.target.value })}
            onBlur={(e) => {
              if (e.target.value) {
                setMemberForm({ ...memberForm, lastName: capitalizeName(e.target.value) })
              }
            }}
            placeholder="Enter last name"
          />
        )}
        {editingMember && (
          <Input
            label="Last Name (Hebrew)"
            type="text"
            required
            dir="rtl"
            lang="he"
            inputMode="text"
            value={memberForm.hebrewLastName}
            onChange={(e) => setMemberForm({ ...memberForm, hebrewLastName: e.target.value })}
            onKeyDown={(e) =>
              handleHebrewInput(e, (value) =>
                setMemberForm((prev: typeof memberForm) => ({
                  ...prev,
                  hebrewLastName: typeof value === 'function' ? value(prev.hebrewLastName) : value,
                })),
              )
            }
            className="text-right font-hebrew"
            placeholder="שם משפחה בעברית"
            style={{ fontFamily: 'Arial Hebrew, David, sans-serif' }}
          />
        )}
        <Input
          label="Birth Date (Gregorian)"
          type="date"
          required
          value={memberForm.birthDate}
          onChange={(e) => {
            const gregorianDate = e.target.value
            if (gregorianDate) {
              const dateObj = new Date(gregorianDate)
              const hebrewDate = convertToHebrewDate(dateObj)
              setMemberForm({
                ...memberForm,
                birthDate: gregorianDate,
                hebrewBirthDate: hebrewDate,
              })
            } else {
              setMemberForm({ ...memberForm, birthDate: gregorianDate })
            }
          }}
          hint="Hebrew date will be auto-calculated in the background"
        />
        {editingMember && (
          <Input
            label="Hebrew Birth Date"
            type="text"
            value={memberForm.hebrewBirthDate}
            onChange={(e) => setMemberForm({ ...memberForm, hebrewBirthDate: e.target.value })}
            placeholder="Hebrew birth date"
            hint="Used for Bar/Bat Mitzvah date (13th Hebrew birthday)"
          />
        )}
        <Select
          label="Gender"
          value={memberForm.gender}
          onChange={(e) => setMemberForm({ ...memberForm, gender: e.target.value })}
          required
        >
          <option value="">Select Gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </Select>
        {editingMember && (
          <div className="border-t border-border pt-4">
            <p className="mb-3 text-sm font-semibold text-fg">
              Marriage Information (Auto-converts to new family)
            </p>
            <div className="space-y-4">
              <Input
                label="Wedding Date"
                type="date"
                value={memberForm.weddingDate}
                onChange={(e) => setMemberForm({ ...memberForm, weddingDate: e.target.value })}
                hint="When set, this child will be automatically converted to a new family on the wedding date and removed from current family"
              />
              <Input
                label="Spouse Name (Optional)"
                type="text"
                value={memberForm.spouseName}
                onChange={(e) => setMemberForm({ ...memberForm, spouseName: e.target.value })}
                onBlur={(e) => {
                  if (e.target.value) {
                    setMemberForm({
                      ...memberForm,
                      spouseName: capitalizeName(e.target.value),
                    })
                  }
                }}
                placeholder="Enter spouse's full name"
                hint="Spouse will be added as a member of the new family"
              />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={closeMemberModal}>
            Cancel
          </Button>
          <Button type="submit" loading={memberSubmitting}>
            {editingMember ? 'Update Child' : 'Add Child'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
