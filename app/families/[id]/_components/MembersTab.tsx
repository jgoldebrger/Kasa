// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { DataView, EmptyState, SkeletonRows, Button, Card, type SortDir } from '@/app/components/ui'
import { calculateHebrewAge, convertToHebrewDate } from '@/lib/hebrew-date'
import { buildMemberColumns, computeMemberDisplay } from '../_lib/helpers'
import { paymentColumnsFor, paymentMobileCard } from '../_lib/helpers'
import { sortPaymentRows } from '@/lib/payments/sort-payments'
import { useFamilyDetail } from '../FamilyDetailContext'

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card compact>
      <h4 className="mb-4 border-b border-border pb-2 text-sm font-semibold text-fg">{title}</h4>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  )
}

function InfoField({
  label,
  children,
  dir,
}: {
  label: string
  children: ReactNode
  dir?: 'rtl' | 'ltr'
}) {
  return (
    <div className="min-w-0" dir={dir}>
      <p className="mb-1 text-xs font-medium text-fg-muted">{label}</p>
      {children}
    </div>
  )
}

function MembersTabContent(props: FamilyDetailContextValue) {
  const {
    params,
    isAdmin,
    formatMoney,
    data,
    paymentPlans,
    setShowMemberModal,
    setEditingMember,
    viewingMemberId,
    setViewingMemberId,
    memberActiveTab,
    setMemberActiveTab,
    memberBalance,
    memberPayments,
    memberStatements,
    loadingMemberFinancials,
    setShowPaymentModal,
    setMemberForm,
    paymentForm,
    setPaymentForm,
    fetchFamilyDetails,
    getPlanName,
    openAddMemberModal,
    renderEditableMemberField,
    handleEditMember,
    handleDeleteMember,
  } = props

  const [paymentSort, setPaymentSort] = useState<{ id: string; dir: SortDir } | null>(null)

  return (
    <div>
      {viewingMemberId && data.members.find((m: any) => m._id === viewingMemberId) ? (
        // Member Detail View (Full Screen)
        (() => {
          const member = data.members.find((m: any) => m._id === viewingMemberId)
          if (!member) return null

          // Calculate Hebrew date if missing
          let displayHebrewDate = member.hebrewBirthDate
          if (!displayHebrewDate && member.birthDate) {
            displayHebrewDate = convertToHebrewDate(new Date(member.birthDate))
          }

          // Calculate age
          let age: number
          if (displayHebrewDate) {
            const hebrewAge = calculateHebrewAge(displayHebrewDate)
            if (hebrewAge !== null) {
              age = hebrewAge
            } else {
              const today = new Date()
              const birthDate = new Date(member.birthDate)
              age = today.getFullYear() - birthDate.getFullYear()
              const monthDiff = today.getMonth() - birthDate.getMonth()
              if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                age--
              }
            }
          } else {
            const today = new Date()
            const birthDate = new Date(member.birthDate)
            age = today.getFullYear() - birthDate.getFullYear()
            const monthDiff = today.getMonth() - birthDate.getMonth()
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
              age--
            }
          }

          return (
            <div>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <Button
                    variant="link"
                    size="sm"
                    className="mb-2"
                    onClick={() => {
                      setViewingMemberId(null)
                      setMemberActiveTab('info')
                    }}
                  >
                    ← Back to Members List
                  </Button>
                  <h3 className="text-xl font-semibold text-fg">
                    {member.firstName} {member.lastName} - Details
                  </h3>
                </div>
              </div>

              {/* Member Tabs */}
              <div className="flex gap-2 mb-6 border-b border-border">
                <button
                  onClick={() => setMemberActiveTab('info')}
                  className={`px-4 py-2 font-medium transition-colors ${
                    memberActiveTab === 'info'
                      ? 'text-accent border-b-2 border-accent'
                      : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  Info
                </button>
                {isAdmin && (
                  <>
                    <button
                      onClick={() => setMemberActiveTab('balance')}
                      className={`px-4 py-2 font-medium transition-colors ${
                        memberActiveTab === 'balance'
                          ? 'text-accent border-b-2 border-accent'
                          : 'text-fg-muted hover:text-fg'
                      }`}
                    >
                      Balance
                    </button>
                    <button
                      onClick={() => setMemberActiveTab('payments')}
                      className={`px-4 py-2 font-medium transition-colors ${
                        memberActiveTab === 'payments'
                          ? 'text-accent border-b-2 border-accent'
                          : 'text-fg-muted hover:text-fg'
                      }`}
                    >
                      Payments
                    </button>
                    <button
                      onClick={() => setMemberActiveTab('statements')}
                      className={`px-4 py-2 font-medium transition-colors ${
                        memberActiveTab === 'statements'
                          ? 'text-accent border-b-2 border-accent'
                          : 'text-fg-muted hover:text-fg'
                      }`}
                    >
                      Statements
                    </button>
                  </>
                )}
              </div>

              {memberActiveTab === 'info' && (
                <div className="space-y-4">
                  <InfoSection title="Basic Information">
                    <InfoField label="First Name">
                      {renderEditableMemberField(
                        'firstName',
                        <p className="font-medium text-fg">
                          {member.firstName || (
                            <span className="text-fg-subtle font-normal">Not provided</span>
                          )}
                        </p>,
                        'name',
                        member._id,
                        undefined,
                      )}
                    </InfoField>
                    <InfoField label="First Name (Hebrew)" dir="rtl">
                      {renderEditableMemberField(
                        'hebrewFirstName',
                        <p className="font-medium text-fg" dir="rtl">
                          {member.hebrewFirstName || (
                            <span className="text-fg-subtle font-normal">Not provided</span>
                          )}
                        </p>,
                        'hebrew',
                        member._id,
                        undefined,
                      )}
                    </InfoField>
                    <InfoField label="Last Name">
                      {renderEditableMemberField(
                        'lastName',
                        <p className="font-medium text-fg">
                          {member.lastName || (
                            <span className="text-fg-subtle font-normal">Not provided</span>
                          )}
                        </p>,
                        'name',
                        member._id,
                        undefined,
                      )}
                    </InfoField>
                    <InfoField label="Last Name (Hebrew)" dir="rtl">
                      {renderEditableMemberField(
                        'hebrewLastName',
                        <p className="font-medium text-fg" dir="rtl">
                          {member.hebrewLastName || (
                            <span className="text-fg-subtle font-normal">Not provided</span>
                          )}
                        </p>,
                        'hebrew',
                        member._id,
                        undefined,
                      )}
                    </InfoField>
                    <InfoField label="Gender">
                      {renderEditableMemberField(
                        'gender',
                        <p className="font-medium capitalize text-fg">
                          {member.gender || (
                            <span className="text-fg-subtle font-normal">Not provided</span>
                          )}
                        </p>,
                        'select',
                        member._id,
                        [
                          { value: 'male', label: 'Male' },
                          { value: 'female', label: 'Female' },
                        ],
                      )}
                    </InfoField>
                  </InfoSection>

                  <InfoSection title="Birth Information">
                    <InfoField label="Birth Date">
                      {renderEditableMemberField(
                        'birthDate',
                        <p className="font-medium text-fg">
                          {member.birthDate ? (
                            new Date(member.birthDate).toLocaleDateString()
                          ) : (
                            <span className="text-fg-subtle font-normal">Not provided</span>
                          )}
                        </p>,
                        'date',
                        member._id,
                        undefined,
                      )}
                    </InfoField>
                    <InfoField label="Hebrew Birth Date (Auto-calculated)" dir="rtl">
                      <p className="font-medium text-fg" dir="rtl">
                        {displayHebrewDate || (
                          <span className="text-fg-subtle font-normal">Not provided</span>
                        )}
                      </p>
                    </InfoField>
                    <InfoField label="Current Age">
                      <p className="font-medium text-fg">{age} years</p>
                    </InfoField>
                    {member.barMitzvahDate && (
                      <InfoField label="Bar/Bat Mitzvah Date">
                        <p className="font-medium text-fg">
                          {new Date(member.barMitzvahDate).toLocaleDateString()}
                        </p>
                      </InfoField>
                    )}
                  </InfoSection>

                  {/* Marriage Information - Show if age >= 18 or if fields have values */}
                  {(age >= 18 ||
                    member.weddingDate ||
                    member.spouseName ||
                    member.spouseFirstName ||
                    member.email ||
                    member.address ||
                    member.phone) && (
                    <InfoSection title="Marriage Information">
                      <InfoField label="Wedding Date">
                        {renderEditableMemberField(
                          'weddingDate',
                          <p className="font-medium text-fg">
                            {member.weddingDate ? (
                              new Date(member.weddingDate).toLocaleDateString()
                            ) : (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'date',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      <InfoField label="Spouse First Name">
                        {renderEditableMemberField(
                          'spouseFirstName',
                          <p className="font-medium text-fg">
                            {member.spouseFirstName || (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'name',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      <InfoField label="Spouse Hebrew Name" dir="rtl">
                        {renderEditableMemberField(
                          'spouseHebrewName',
                          <p className="font-medium text-fg" dir="rtl">
                            {member.spouseHebrewName || (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'hebrew',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      <InfoField label="Spouse Father's Hebrew Name" dir="rtl">
                        {renderEditableMemberField(
                          'spouseFatherHebrewName',
                          <p className="font-medium text-fg" dir="rtl">
                            {member.spouseFatherHebrewName || (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'hebrew',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      <InfoField label="Spouse Cell Phone">
                        {renderEditableMemberField(
                          'spouseCellPhone',
                          <p className="font-medium text-fg">
                            {member.spouseCellPhone || (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'phone',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      <InfoField label="Phone">
                        {renderEditableMemberField(
                          'phone',
                          <p className="font-medium text-fg">
                            {member.phone || (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'phone',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      <InfoField label="Email">
                        {renderEditableMemberField(
                          'email',
                          <p className="font-medium text-fg">
                            {member.email || (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'email',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      <InfoField label="Address">
                        {renderEditableMemberField(
                          'address',
                          <p className="font-medium text-fg">
                            {member.address || (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'name',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      <InfoField label="City">
                        {renderEditableMemberField(
                          'city',
                          <p className="font-medium text-fg">
                            {member.city || (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'name',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      <InfoField label="State">
                        {renderEditableMemberField(
                          'state',
                          <p className="font-medium text-fg">
                            {member.state || (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'name',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      <InfoField label="ZIP Code">
                        {renderEditableMemberField(
                          'zip',
                          <p className="font-medium text-fg">
                            {member.zip || (
                              <span className="text-fg-subtle font-normal">Not provided</span>
                            )}
                          </p>,
                          'text',
                          member._id,
                          undefined,
                        )}
                      </InfoField>
                      {member.spouseName && !member.spouseFirstName && (
                        <InfoField label="Spouse Name (Legacy)">
                          {renderEditableMemberField(
                            'spouseName',
                            <p className="font-medium text-fg">{member.spouseName}</p>,
                            'name',
                            member._id,
                            undefined,
                          )}
                        </InfoField>
                      )}
                    </InfoSection>
                  )}

                  {/* Actions */}
                  {isAdmin && (
                    <div className="flex gap-2 pt-4 border-t border-border">
                      <Button
                        onClick={() => {
                          setEditingMember(member)
                          setMemberForm({
                            firstName: member.firstName,
                            hebrewFirstName: member.hebrewFirstName || '',
                            lastName: member.lastName,
                            hebrewLastName: member.hebrewLastName || '',
                            birthDate: member.birthDate
                              ? new Date(member.birthDate).toISOString().split('T')[0]
                              : '',
                            hebrewBirthDate: member.hebrewBirthDate || '',
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
                        }}
                      >
                        Open Full Edit Modal
                      </Button>
                      <Button variant="destructive" onClick={() => handleDeleteMember(member)}>
                        Delete Member
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {memberActiveTab === 'balance' && (
                <div>
                  {loadingMemberFinancials ? (
                    <SkeletonRows count={3} />
                  ) : memberBalance ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card compact>
                          <p className="text-sm font-medium text-fg-muted mb-1">
                            Plan Cost (Annual)
                          </p>
                          <p className="text-2xl font-bold tabular text-fg">
                            {formatMoney(memberBalance.planCost)}
                          </p>
                        </Card>
                        <Card compact>
                          <p className="text-sm font-medium text-fg-muted mb-1">Total Payments</p>
                          <p className="text-2xl font-bold tabular text-success">
                            {formatMoney(memberBalance.totalPayments)}
                          </p>
                        </Card>
                        <Card
                          compact
                          className={memberBalance.balance >= 0 ? 'bg-success/10' : 'bg-danger/10'}
                        >
                          <p className="text-sm font-medium text-fg-muted mb-1">Current Balance</p>
                          <p
                            className={`text-2xl font-bold ${memberBalance.balance >= 0 ? 'text-success' : 'text-danger'}`}
                          >
                            {formatMoney(memberBalance.balance)}
                          </p>
                        </Card>
                      </div>
                      {memberBalance.totalLifecyclePayments > 0 && (
                        <Card compact>
                          <p className="text-sm font-medium text-fg-muted mb-1">
                            Lifecycle Events (Informational)
                          </p>
                          <p className="text-lg font-semibold text-fg">
                            {formatMoney(memberBalance.totalLifecyclePayments)}
                          </p>
                          <p className="text-xs text-fg-muted mt-1">
                            Note: Lifecycle events are not included in balance calculation
                          </p>
                        </Card>
                      )}
                    </div>
                  ) : (
                    <EmptyState
                      title="No balance data"
                      description="Balance information is not available for this member."
                    />
                  )}
                </div>
              )}

              {memberActiveTab === 'payments' && (
                <div>
                  <div className="flex justify-between mb-4">
                    <h3 className="text-lg font-semibold">Payments</h3>
                    <Button
                      size="sm"
                      leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => {
                        setPaymentForm({
                          ...paymentForm,
                          paymentFor: 'member',
                          memberId: member._id,
                        })
                        setShowPaymentModal(true)
                      }}
                    >
                      Add Payment
                    </Button>
                  </div>
                  {loadingMemberFinancials ? (
                    <SkeletonRows count={5} />
                  ) : (
                    <DataView
                      tableId="family-member-payments"
                      rows={sortPaymentRows(memberPayments, paymentSort)}
                      columns={paymentColumnsFor('member-payment', formatMoney)}
                      rowKey={(p: any) => p._id}
                      sort={paymentSort}
                      onSortChange={(id, dir) => setPaymentSort({ id, dir })}
                      globalSearch={{ placeholder: 'Search payments…' }}
                      pageSize={10}
                      import={{
                        type: 'payments',
                        familyId: String(params.id),
                        memberId: member._id,
                        onImported: () => fetchFamilyDetails(),
                      }}
                      mobileCard={(p) => paymentMobileCard(p, formatMoney)}
                      empty={
                        <EmptyState
                          title="No payments"
                          description="No payments found for this member."
                        />
                      }
                    />
                  )}
                </div>
              )}

              {memberActiveTab === 'statements' && (
                <div>
                  {loadingMemberFinancials ? (
                    <SkeletonRows count={4} />
                  ) : memberStatements.length === 0 ? (
                    <EmptyState
                      icon="📄"
                      title="No statements"
                      description="No statements found for this member."
                    />
                  ) : (
                    <div className="space-y-4">
                      {memberStatements.map((statement) => (
                        <Card key={statement._id} compact>
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <h4 className="font-semibold text-lg">{statement.statementNumber}</h4>
                              <p className="text-sm text-fg-muted">
                                {new Date(statement.fromDate).toLocaleDateString()} -{' '}
                                {new Date(statement.toDate).toLocaleDateString()}
                              </p>
                              <p className="text-xs text-fg-subtle mt-1">
                                Generated: {new Date(statement.date).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="text-right">
                              <div className="text-sm text-fg-muted">Closing Balance</div>
                              <div className="text-xl font-bold">
                                {formatMoney(statement.closingBalance)}
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-border">
                            <div>
                              <p className="text-xs text-fg-muted">Opening Balance</p>
                              <p className="text-sm font-semibold">
                                {formatMoney(statement.openingBalance)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-fg-muted">Income</p>
                              <p className="text-sm font-semibold text-success">
                                {formatMoney(statement.income)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-fg-muted">Expenses</p>
                              <p className="text-sm font-semibold text-danger">
                                {formatMoney(statement.expenses)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-fg-muted">Closing Balance</p>
                              <p className="text-sm font-semibold">
                                {formatMoney(statement.closingBalance)}
                              </p>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })()
      ) : (
        // Members List View
        <>
          <div className="flex justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-fg mb-1">Family Members (Children)</h3>
              <p className="text-sm text-fg-muted">
                Add children to track their ages for payment plan calculations
              </p>
            </div>
            {isAdmin && (
              <Button
                size="lg"
                leftIcon={<PlusIcon className="h-5 w-5" aria-hidden="true" />}
                onClick={openAddMemberModal}
              >
                Add Child
              </Button>
            )}
          </div>
          <DataView
            tableId="family-children"
            rows={data.members}
            globalSearch={{ placeholder: 'Search children…' }}
            pageSize={10}
            {...(isAdmin
              ? {
                  import: {
                    type: 'members' as const,
                    familyId: String(params.id),
                    onImported: () => fetchFamilyDetails(),
                  },
                }
              : {})}
            columns={buildMemberColumns({
              paymentPlans,
              getPlanName,
              viewingMemberId,
              setViewingMemberId,
              onEdit: handleEditMember,
              onDelete: handleDeleteMember,
              canMutate: isAdmin,
              formatMoney,
            })}
            rowKey={(m: any) => m._id}
            mobileCard={(m: any) => {
              const info = computeMemberDisplay(m, paymentPlans, getPlanName, formatMoney)
              return (
                <Card compact>
                  <div className="flex items-start justify-between gap-3">
                    <button
                      onClick={() => setViewingMemberId(viewingMemberId === m._id ? null : m._id)}
                      className="focus-ring font-medium text-accent hover:underline text-left"
                    >
                      {m.firstName} {m.lastName}
                    </button>
                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleEditMember(m)}
                          aria-label="Edit"
                          className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted hover:bg-fg/5 hover:text-fg"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteMember(m)}
                          aria-label="Delete"
                          className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-danger hover:bg-danger/10"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-fg">
                    <div>
                      <dt className="text-fg-muted">Age</dt>
                      <dd className="tabular">{info.age} years</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Born</dt>
                      <dd className="tabular">{new Date(m.birthDate).toLocaleDateString()}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-fg-muted">Plan</dt>
                      <dd>{info.planText || '—'}</dd>
                    </div>
                  </dl>
                </Card>
              )
            }}
            empty={
              <EmptyState
                icon="👶"
                title="No children added yet"
                description="Add children to track their ages for payment plan calculations."
                cta={
                  isAdmin ? { label: 'Add First Child', onClick: openAddMemberModal } : undefined
                }
              />
            }
          />
        </>
      )}
    </div>
  )
}

export default function MembersTab() {
  const ctx = useFamilyDetail()
  return <MembersTabContent {...ctx} />
}
