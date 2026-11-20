import React, { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Unlink,
} from 'lucide-react';
import { formatCurrencyExact, formatDateShort, generateId } from '../lib/formatters';
import type { JobOrder, PaymentRecord, QuickBooksStatus } from '../types';

interface PaymentHistoryViewProps {
  jobs: JobOrder[];
  payments: PaymentRecord[];
  qbStatus: QuickBooksStatus | null;
  isOnline: boolean;
  isSyncingQb: boolean;
  preselectedJobId?: string | null;
  onClearPreselectedJob?: () => void;
  onConnectQuickBooks: () => Promise<void>;
  onDisconnectQuickBooks: () => Promise<void>;
  onSyncQuickBooks: () => Promise<void>;
  onRecordPayment: (payment: PaymentRecord, pushToQuickBooks: boolean) => Promise<void>;
}

export const PaymentHistoryView: React.FC<PaymentHistoryViewProps> = ({
  jobs,
  payments,
  qbStatus,
  isOnline,
  isSyncingQb,
  preselectedJobId,
  onClearPreselectedJob,
  onConnectQuickBooks,
  onDisconnectQuickBooks,
  onSyncQuickBooks,
  onRecordPayment,
}) => {
  const [filter, setFilter] = useState<'all' | 'inflow' | 'outflow' | 'pending'>('all');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(Boolean(preselectedJobId));
  const [copiedUri, setCopiedUri] = useState(false);

  const [jobId, setJobId] = useState(preselectedJobId || jobs[0]?.id || '');
  const [type, setType] = useState<PaymentRecord['type']>('Progress Draw');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentRecord['method']>('QuickBooks Online');
  const [status, setStatus] = useState<PaymentRecord['status']>('Paid');
  const [refNum, setRefNum] = useState('');
  const [notes, setNotes] = useState('');
  const [pushQb, setPushQb] = useState(true);

  const filtered = payments
    .filter((p) => {
      if (filter === 'inflow') return p.direction === 'inflow';
      if (filter === 'outflow') return p.direction === 'outflow';
      if (filter === 'pending') return p.status !== 'Paid';
      return true;
    })
    .filter((p) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        p.jobTitle.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        p.referenceNumber.toLowerCase().includes(q) ||
        p.notes.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalInflows = payments
    .filter((p) => p.direction === 'inflow' && p.status === 'Paid')
    .reduce((acc, p) => acc + p.amount, 0);
  const totalOutflows = payments
    .filter((p) => p.direction === 'outflow')
    .reduce((acc, p) => acc + p.amount, 0);
  const pendingReceivables = payments
    .filter((p) => p.direction === 'inflow' && p.status !== 'Paid')
    .reduce((acc, p) => acc + p.amount, 0);

  const handleCopyCallback = () => {
    if (!qbStatus?.callbackUrl) return;
    navigator.clipboard.writeText(qbStatus.callbackUrl);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmt = Number(amount);
    if (!numericAmt || numericAmt <= 0) return;
    const job = jobs.find((j) => j.id === jobId);
    const direction: PaymentRecord['direction'] =
      type === 'Material Expense' || type === 'Subcontractor Payout' ? 'outflow' : 'inflow';

    const record: PaymentRecord = {
      id: generateId('pay'),
      jobId: job?.id || '',
      jobTitle: job?.title || 'General Business',
      clientName: direction === 'outflow' ? notes.trim() || 'Supplier / Subcontractor' : job?.clientName || 'Client',
      type,
      direction,
      amount: numericAmt,
      date,
      method,
      status,
      referenceNumber: refNum.trim() || `INV-${Math.floor(4020 + Math.random() * 900)}`,
      notes: notes.trim(),
      syncState: pushQb && direction === 'inflow' ? 'pending' : 'local',
    };

    await onRecordPayment(record, pushQb && direction === 'inflow');
    setAmount('');
    setRefNum('');
    setNotes('');
    setShowAdd(false);
    onClearPreselectedJob?.();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Payment History &amp; QuickBooks
          </h1>
          <p className="text-sm text-slate-600">
            Track client draws, invoices, and material expenses synced with QuickBooks Online.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-700 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          Record Payment / Expense
        </button>
      </div>

      {/* QuickBooks Online Connection Strip */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-900">QuickBooks Online Accounting</span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-semibold ${
                  qbStatus?.connected
                    ? 'text-emerald-700'
                    : qbStatus?.configured
                    ? 'text-amber-700'
                    : 'text-slate-600'
                }`}
              >
                {qbStatus?.connected
                  ? `Connected (${qbStatus.companyName || qbStatus.realmId})`
                  : qbStatus?.configured
                  ? 'Ready to Connect'
                  : 'Credentials Pending in Secrets'}
              </span>
              {qbStatus?.environment && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{qbStatus.environment}</span>
                </>
              )}
            </div>
            <p className="text-xs text-slate-600">
              {qbStatus?.connected
                ? 'Pull live invoices and customer payments or push new FieldLedger draws straight into QuickBooks.'
                : qbStatus?.configured
                ? 'Connect your Intuit QuickBooks company to sync invoices and payments automatically.'
                : 'Add QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET in AI Studio Secrets with the Redirect URI below to enable live QuickBooks sync.'}
            </p>
            {!qbStatus?.connected && qbStatus?.callbackUrl && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">Intuit Redirect URI:</span>
                <code className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-800">
                  {qbStatus.callbackUrl}
                </code>
                <button
                  type="button"
                  onClick={handleCopyCallback}
                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-800"
                >
                  {copiedUri ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedUri ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {qbStatus?.connected ? (
              <>
                <button
                  type="button"
                  onClick={onSyncQuickBooks}
                  disabled={!isOnline || isSyncingQb}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncingQb ? 'animate-spin' : ''}`} />
                  Sync QuickBooks
                </button>
                <button
                  type="button"
                  onClick={onDisconnectQuickBooks}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-700 whitespace-nowrap"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onConnectQuickBooks}
                disabled={!isOnline || !qbStatus?.configured}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              >
                <Link2 className="h-3.5 w-3.5" />
                Connect QuickBooks Online
              </button>
            )}
            {!qbStatus?.configured && (
              <a
                href="https://developer.intuit.com/app/developer/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Intuit Portal
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Collected Client Payments</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-700">
            {formatCurrencyExact(totalInflows)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Material &amp; Sub Outflows</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {formatCurrencyExact(totalOutflows)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Pending Receivables</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-700">
            {formatCurrencyExact(pendingReceivables)}
          </div>
        </div>
      </div>

      {/* Record Payment Drawer */}
      {showAdd && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Record Job Payment or Cost Entry
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Job Order</label>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.jobNumber} — {j.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Transaction Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as PaymentRecord['type'])}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
              >
                <option value="Deposit">Client Deposit</option>
                <option value="Progress Draw">Progress Draw</option>
                <option value="Invoice Payment">Invoice Payment</option>
                <option value="Material Expense">Material Expense</option>
                <option value="Subcontractor Payout">Subcontractor Payout</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Amount ($) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1500.00"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentRecord['method'])}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="QuickBooks Online">QuickBooks Online</option>
                <option value="ACH">ACH Transfer</option>
                <option value="Check">Check</option>
                <option value="Credit Card">Credit Card</option>
                <option value="Cash">Cash</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as PaymentRecord['status'])}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="Paid">Paid</option>
                <option value="Pending">Pending</option>
                <option value="Overdue">Overdue</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Invoice / Check #</label>
              <input
                type="text"
                value={refNum}
                onChange={(e) => setRefNum(e.target.value)}
                placeholder="QB-INV-4025"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700">Memo / Payee</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes or supplier name..."
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={pushQb}
                onChange={(e) => setPushQb(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-amber-600"
              />
              Create / queue invoice in QuickBooks Online for client payments
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  onClearPreselectedJob?.();
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Save Transaction
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filter & Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {[
            { id: 'all', label: 'All Ledger' },
            { id: 'inflow', label: 'Client Inflows' },
            { id: 'outflow', label: 'Expenses' },
            { id: 'pending', label: 'Pending' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as typeof filter)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                filter === tab.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice #, client, job..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      {/* Payment Ledger Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Reference</th>
                <th className="px-5 py-3">Job &amp; Counterparty</th>
                <th className="px-5 py-3">Type · Method</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                    No payment records match the selected filter.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3.5 font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                      {formatDateShort(p.date)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {p.referenceNumber}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-900">{p.clientName}</div>
                      <div className="text-xs text-slate-500">
                        {p.jobTitle}
                        {p.notes ? ` · ${p.notes}` : ''}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-600 whitespace-nowrap">
                      {p.type} · {p.method}
                    </td>
                    <td className="px-5 py-3.5 text-xs whitespace-nowrap">
                      <span
                        className={`font-semibold ${
                          p.status === 'Paid'
                            ? 'text-emerald-700'
                            : p.status === 'Overdue'
                            ? 'text-red-600'
                            : 'text-amber-700'
                        }`}
                      >
                        {p.status}
                      </span>
                      {p.syncState === 'synced' && (
                        <span className="ml-1.5 text-slate-400">· QB Synced</span>
                      )}
                      {p.syncState === 'pending' && (
                        <span className="ml-1.5 text-amber-600">· Queued</span>
                      )}
                    </td>
                    <td
                      className={`px-5 py-3.5 text-right font-mono text-sm font-semibold tabular-nums whitespace-nowrap ${
                        p.direction === 'inflow' ? 'text-emerald-700' : 'text-slate-900'
                      }`}
                    >
                      {p.direction === 'inflow' ? '+' : '-'}
                      {formatCurrencyExact(p.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
