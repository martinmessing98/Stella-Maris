import React, { useMemo, useState } from 'react';
import { ArrowDownUp, Download } from 'lucide-react';
import { formatCurrency } from '../lib/formatters';
import type { JobOrder, PaymentRecord } from '../types';

interface ProfitabilityViewProps {
  jobs: JobOrder[];
  payments: PaymentRecord[];
  onOpenJob: (jobId: string) => void;
}

export const ProfitabilityView: React.FC<ProfitabilityViewProps> = ({
  jobs,
  payments,
  onOpenJob,
}) => {
  const [sortBy, setSortBy] = useState<'profit' | 'margin' | 'revenue'>('profit');

  const jobMetrics = useMemo(() => {
    return jobs.map((job) => {
      const collected = payments
        .filter((p) => p.jobId === job.id && p.direction === 'inflow' && p.status === 'Paid')
        .reduce((s, p) => s + p.amount, 0);
      const costBase = job.actualCost > 0 ? job.actualCost : job.estimatedCost;
      const grossProfit = job.estimatedRevenue - costBase;
      const marginPct = job.estimatedRevenue > 0 ? (grossProfit / job.estimatedRevenue) * 100 : 0;
      const costVariance = job.actualCost - job.estimatedCost;
      return {
        job,
        collected,
        costBase,
        grossProfit,
        marginPct,
        costVariance,
      };
    });
  }, [jobs, payments]);

  const sortedMetrics = useMemo(() => {
    return [...jobMetrics].sort((a, b) => {
      if (sortBy === 'margin') return b.marginPct - a.marginPct;
      if (sortBy === 'revenue') return b.job.estimatedRevenue - a.job.estimatedRevenue;
      return b.grossProfit - a.grossProfit;
    });
  }, [jobMetrics, sortBy]);

  const totals = useMemo(() => {
    const totalRevenue = jobMetrics.reduce((s, m) => s + m.job.estimatedRevenue, 0);
    const totalCost = jobMetrics.reduce((s, m) => s + m.costBase, 0);
    const totalProfit = totalRevenue - totalCost;
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const totalCollected = jobMetrics.reduce((s, m) => s + m.collected, 0);
    return { totalRevenue, totalCost, totalProfit, avgMargin, totalCollected };
  }, [jobMetrics]);

  const tradeBreakdown = useMemo(() => {
    const map = new Map<string, { revenue: number; profit: number; count: number }>();
    for (const m of jobMetrics) {
      const curr = map.get(m.job.trade) || { revenue: 0, profit: 0, count: 0 };
      curr.revenue += m.job.estimatedRevenue;
      curr.profit += m.grossProfit;
      curr.count += 1;
      map.set(m.job.trade, curr);
    }
    return Array.from(map.entries()).map(([trade, stats]) => ({
      trade,
      ...stats,
      marginPct: stats.revenue > 0 ? (stats.profit / stats.revenue) * 100 : 0,
    }));
  }, [jobMetrics]);

  const maxRev = Math.max(1, ...jobMetrics.map((m) => m.job.estimatedRevenue));

  const handleExportCsv = () => {
    const headers = [
      'Job Number',
      'Title',
      'Trade',
      'Status',
      'Client',
      'Contract Revenue',
      'Estimated Cost',
      'Actual Cost',
      'Projected Profit',
      'Margin %',
      'Collected Payments',
    ];
    const rows = sortedMetrics.map((m) => [
      m.job.jobNumber,
      `"${m.job.title.replace(/"/g, '""')}"`,
      `"${m.job.trade}"`,
      m.job.status,
      `"${m.job.clientName.replace(/"/g, '""')}"`,
      m.job.estimatedRevenue,
      m.job.estimatedCost,
      m.job.actualCost,
      m.grossProfit,
      m.marginPct.toFixed(1),
      m.collected,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fieldledger-profitability-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Job Profitability &amp; Margins
          </h1>
          <p className="text-sm text-slate-600">
            Real-time gross margin tracking across estimated budgets, actual field costs, and collected draws.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV Report
        </button>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Contracted Pipeline</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {formatCurrency(totals.totalRevenue)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Across {jobs.length} job orders</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Total Committed Cost</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {formatCurrency(totals.totalCost)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Labor, materials &amp; subs</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Projected Gross Profit</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-700">
            {formatCurrency(totals.totalProfit)}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-slate-500">
            {formatCurrency(totals.totalCollected)} collected cash
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">Blended Gross Margin</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-700">
            {totals.avgMargin.toFixed(1)}%
          </div>
          <div className="mt-1 text-xs text-slate-500">Target contracting benchmark: 35%</div>
        </div>
      </div>

      {/* Visual Comparison & Trade Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Revenue vs. Job Cost Comparison
            </h2>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-slate-900" />
                Contract Revenue
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-amber-500" />
                Committed Cost
              </span>
            </div>
          </div>

          <div className="space-y-4 pt-1">
            {sortedMetrics.map(({ job, costBase, marginPct }) => {
              const revPct = Math.round((job.estimatedRevenue / maxRev) * 100);
              const costPct = Math.round((costBase / maxRev) * 100);
              return (
                <div key={job.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => onOpenJob(job.id)}
                      className="font-medium text-slate-900 hover:text-amber-700 truncate text-left"
                    >
                      <span className="font-mono text-slate-500 mr-1.5">{job.jobNumber}</span>
                      {job.title}
                    </button>
                    <span className="font-mono font-semibold tabular-nums text-emerald-700 shrink-0 ml-3">
                      {marginPct.toFixed(0)}% margin
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2.5 w-full rounded bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded bg-slate-900"
                        style={{ width: `${Math.max(4, revPct)}%` }}
                      />
                    </div>
                    <div className="h-2 w-full rounded bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded bg-amber-500"
                        style={{ width: `${Math.max(3, costPct)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 lg:col-span-5">
          <h2 className="font-display text-base font-semibold text-slate-900 border-b border-slate-100 pb-3">
            Margin by Trade Category
          </h2>
          <div className="divide-y divide-slate-100">
            {tradeBreakdown.map((row) => (
              <div key={row.trade} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <div className="font-medium text-slate-900">{row.trade}</div>
                  <div className="text-xs text-slate-500">
                    {row.count} job(s) · {formatCurrency(row.revenue)} rev
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-semibold tabular-nums text-emerald-700">
                    {formatCurrency(row.profit)}
                  </div>
                  <div className="font-mono text-xs tabular-nums text-slate-500">
                    {row.marginPct.toFixed(1)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Per-Job Profitability Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <h2 className="font-display text-base font-semibold text-slate-900">Job Profitability Ledger</h2>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {[
              { id: 'profit', label: 'Sort: Profit $' },
              { id: 'margin', label: 'Sort: Margin %' },
              { id: 'revenue', label: 'Sort: Revenue' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSortBy(s.id as typeof sortBy)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                  sortBy === s.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowDownUp className="h-3 w-3" />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="px-5 py-3">Job Order</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Estimate</th>
                <th className="px-5 py-3 text-right">Est. Cost</th>
                <th className="px-5 py-3 text-right">Actual Cost</th>
                <th className="px-5 py-3 text-right">Gross Profit</th>
                <th className="px-5 py-3 text-right">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedMetrics.map(({ job, grossProfit, marginPct }) => (
                <tr key={job.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => onOpenJob(job.id)}
                      className="text-left font-medium text-slate-900 hover:text-amber-700"
                    >
                      <span className="font-mono text-xs text-slate-500 mr-2">{job.jobNumber}</span>
                      {job.title}
                    </button>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-600 whitespace-nowrap">{job.status}</td>
                  <td className="px-5 py-3.5 text-right font-mono tabular-nums text-slate-900">
                    {formatCurrency(job.estimatedRevenue)}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono tabular-nums text-slate-600">
                    {formatCurrency(job.estimatedCost)}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono tabular-nums text-slate-900">
                    {formatCurrency(job.actualCost)}
                  </td>
                  <td
                    className={`px-5 py-3.5 text-right font-mono font-semibold tabular-nums ${
                      grossProfit >= 0 ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {formatCurrency(grossProfit)}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono font-semibold tabular-nums text-slate-900">
                    {marginPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
