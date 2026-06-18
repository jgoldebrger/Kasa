// @ts-nocheck
'use client'

import type { FamilyDetailContextValue } from '../FamilyDetailContext'
import { PrinterIcon, DocumentArrowDownIcon, EnvelopeIcon } from '@heroicons/react/24/outline'
import { Button, Card, EmptyState } from '@/app/components/ui'
import { useFamilyDetail } from '../FamilyDetailContext'

function StatementsTabContent(props: FamilyDetailContextValue) {
  const {
    data,
    statements,
    sendingEmail,
    formatMoney,
    handlePrintStatement,
    handleSavePDFStatement,
    handleSendStatementEmail,
    handlePrintAllStatements,
  } = props

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-fg">Statements</h3>
        {statements.length > 0 && (
          <Button
            size="sm"
            leftIcon={<PrinterIcon className="h-4 w-4" aria-hidden="true" />}
            onClick={() => handlePrintAllStatements()}
          >
            Print All Statements
          </Button>
        )}
      </div>
      {statements.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No statements"
          description="No statements found for this family."
        />
      ) : (
        <div className="space-y-4">
          {statements.map((statement) => (
            <Card key={statement._id} compact>
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-lg font-semibold text-fg">{statement.statementNumber}</h4>
                  <p className="text-sm text-fg-muted">
                    {new Date(statement.fromDate).toLocaleDateString()} -{' '}
                    {new Date(statement.toDate).toLocaleDateString()}
                  </p>
                  <p className="mt-1 text-xs text-fg-subtle">
                    Generated: {new Date(statement.date).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-fg-muted">Closing Balance</div>
                  <div className="text-xl font-bold tabular">
                    {formatMoney(statement.closingBalance)}
                  </div>
                </div>
              </div>
              <div
                className={`grid ${(statement.cycleCharges || 0) > 0 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-4'} mt-4 gap-4 border-t border-border pt-4`}
              >
                <div>
                  <div className="text-xs text-fg-muted">Opening Balance</div>
                  <div className="font-medium tabular">{formatMoney(statement.openingBalance)}</div>
                </div>
                <div>
                  <div className="text-xs text-fg-muted">Income</div>
                  <div className="font-medium tabular text-success">
                    {formatMoney(statement.income)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-fg-muted">Withdrawals</div>
                  <div className="font-medium tabular text-warning">
                    {formatMoney(statement.withdrawals)}
                  </div>
                </div>
                {(statement.cycleCharges || 0) > 0 && (
                  <div>
                    <div className="text-xs text-fg-muted">Annual Dues</div>
                    <div className="font-medium tabular text-warning">
                      {formatMoney(statement.cycleCharges || 0)}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-fg-muted">Expenses</div>
                  <div className="font-medium tabular text-danger">
                    {formatMoney(statement.expenses)}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<PrinterIcon className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => handlePrintStatement(statement)}
                >
                  Print
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<DocumentArrowDownIcon className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => handleSavePDFStatement(statement)}
                >
                  Save as PDF
                </Button>
                {data?.family?.email && (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<EnvelopeIcon className="h-4 w-4" aria-hidden="true" />}
                    onClick={() => handleSendStatementEmail(statement)}
                    disabled={sendingEmail === statement._id}
                    loading={sendingEmail === statement._id}
                  >
                    {sendingEmail === statement._id ? 'Sending…' : 'Send Email'}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default function StatementsTab() {
  const ctx = useFamilyDetail()
  return <StatementsTabContent {...ctx} />
}
