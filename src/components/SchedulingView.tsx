import React, { useMemo, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { formatDateShort, getUrgencyMeta, isSafeHttpUrl } from '../lib/formatters';
import type { GoogleCalendarEvent, JobOrder, JobScheduleBlock } from '../types';

interface SchedulingViewProps {
  jobs: JobOrder[];
  schedules: JobScheduleBlock[];
  googleEvents: GoogleCalendarEvent[];
  googleConnected: boolean;
  isOnline: boolean;
  isSyncingCalendar: boolean;
  onRefreshGoogleCalendar: () => Promise<void>;
  onOpenJob: (jobId: string) => void;
  onAddScheduleBlock: (block: Omit<JobScheduleBlock, 'id' | 'syncState'>, syncToGoogle: boolean) => Promise<void>;
}

type ViewMode = 'month' | 'week' | 'agenda';

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const SchedulingView: React.FC<SchedulingViewProps> = ({
  jobs,
  schedules,
  googleEvents,
  googleConnected,
  isOnline,
  isSyncingCalendar,
  onRefreshGoogleCalendar,
  onOpenJob,
  onAddScheduleBlock,
}) => {
  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0);
  });
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [showAdd, setShowAdd] = useState(false);

  const [jobId, setJobId] = useState(jobs[0]?.id || '');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayIso);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [crewAssigned, setCrewAssigned] = useState('Martin M.');
  const [notes, setNotes] = useState('');
  const [syncGoogle, setSyncGoogle] = useState(true);

  const monthTitle = useMemo(
    () => monthAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    [monthAnchor]
  );

  const monthCells = useMemo(() => {
    const year = monthAnchor.getFullYear();
    const month = monthAnchor.getMonth();
    const firstOfMonth = new Date(year, month, 1, 12, 0, 0);
    const startOffset = firstOfMonth.getDay(); // Sunday = 0
    const gridStart = new Date(year, month, 1 - startOffset, 12, 0, 0);

    const lastOfMonth = new Date(year, month + 1, 0, 12, 0, 0);
    const totalDaysNeeded = startOffset + lastOfMonth.getDate();
    const totalCells = totalDaysNeeded > 35 ? 42 : 35;

    return Array.from({ length: totalCells }, (_, idx) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + idx);
      const iso = toIsoDate(d);
      return {
        iso,
        dayNum: d.getDate(),
        inCurrentMonth: d.getMonth() === month,
        isToday: iso === todayIso,
        isWeekend: d.getDay() === 0 || d.getDay() === 6,
      };
    });
  }, [monthAnchor, todayIso]);

  const weekDays = useMemo(() => {
    const start = new Date(weekAnchor);
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    start.setDate(diff);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toIsoDate(d);
      return {
        iso,
        dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayNum: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      };
    });
  }, [weekAnchor]);

  const combinedAgenda = useMemo(() => {
    const jobItems = schedules.map((s) => {
      const job = jobs.find((j) => j.id === s.jobId);
      return {
        id: s.id,
        source: 'job' as const,
        date: s.date,
        timeRange: `${s.startTime}–${s.endTime}`,
        shortTime: s.startTime,
        title: s.title,
        jobNumber: job?.jobNumber || '',
        urgency: job?.urgency,
        subtitle: job ? `${job.jobNumber} · ${job.clientName} · ${job.siteAddress}` : s.crewAssigned,
        jobId: s.jobId,
        syncState: s.syncState,
      };
    });

    const calItems = googleEvents.map((ev) => ({
      id: `gcal-${ev.id}`,
      source: 'google' as const,
      date: ev.start.slice(0, 10),
      timeRange: ev.allDay ? 'All Day' : `${ev.start.slice(11, 16)}–${ev.end.slice(11, 16)}`,
      shortTime: ev.allDay ? 'All day' : ev.start.slice(11, 16),
      title: ev.summary,
      jobNumber: '',
      urgency: undefined,
      subtitle: ev.location || 'Google Calendar Event',
      htmlLink: ev.htmlLink,
    }));

    return [...jobItems, ...calItems].sort((a, b) =>
      `${a.date}${a.timeRange}`.localeCompare(`${b.date}${b.timeRange}`)
    );
  }, [schedules, googleEvents, jobs]);

  const jobDateMarkersByDay = useMemo(() => {
    const map = new Map<string, Array<{ job: JobOrder; kind: 'start' | 'finish' }>>();
    for (const job of jobs) {
      if (job.startDate) {
        const list = map.get(job.startDate) || [];
        list.push({ job, kind: 'start' });
        map.set(job.startDate, list);
      }
      if (job.finishDate && job.finishDate !== job.startDate) {
        const list = map.get(job.finishDate) || [];
        list.push({ job, kind: 'finish' });
        map.set(job.finishDate, list);
      }
    }
    return map;
  }, [jobs]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetJobId = jobId || jobs[0]?.id;
    if (!title.trim() || !targetJobId) return;
    await onAddScheduleBlock(
      {
        jobId: targetJobId,
        title: title.trim(),
        date,
        startTime,
        endTime,
        crewAssigned: crewAssigned.trim() || 'Martin M.',
        notes: notes.trim(),
      },
      syncGoogle && googleConnected
    );
    setTitle('');
    setNotes('');
    setShowAdd(false);
  };

  const openAddForDate = (isoDate: string) => {
    if (!jobId && jobs[0]?.id) setJobId(jobs[0].id);
    setDate(isoDate);
    setShowAdd(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Master Schedule
          </h1>
          <p className="text-sm text-slate-600">
            Monthly calendar of job dates, crew shifts, and Google Calendar events · Cached offline.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {googleConnected && isOnline && (
            <button
              type="button"
              onClick={onRefreshGoogleCalendar}
              disabled={isSyncingCalendar}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingCalendar ? 'animate-spin' : ''}`} />
              Sync Google Calendar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!jobId && jobs[0]?.id) setJobId(jobs[0].id);
              setShowAdd((v) => !v);
            }}
            disabled={jobs.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            Schedule Shift
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setViewMode('month')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              viewMode === 'month' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Month Calendar
          </button>
          <button
            type="button"
            onClick={() => setViewMode('week')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              viewMode === 'week' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Week Grid
          </button>
          <button
            type="button"
            onClick={() => setViewMode('agenda')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              viewMode === 'agenda' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Full Agenda
          </button>
        </div>

        {viewMode === 'month' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1, 12, 0, 0))
              }
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[140px] text-center font-display text-sm font-semibold text-slate-900">
              {monthTitle}
            </span>
            <button
              type="button"
              onClick={() =>
                setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1, 12, 0, 0))
              }
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setMonthAnchor(new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0));
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Today
            </button>
          </div>
        ) : (
          viewMode === 'week' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const d = new Date(weekAnchor);
                  d.setDate(d.getDate() - 7);
                  setWeekAnchor(d);
                }}
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums px-2">
                {weekDays[0]?.dayNum} – {weekDays[6]?.dayNum}
              </span>
              <button
                type="button"
                onClick={() => {
                  const d = new Date(weekAnchor);
                  d.setDate(d.getDate() + 7);
                  setWeekAnchor(d);
                }}
                className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
                aria-label="Next week"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )
        )}
      </div>

      {/* Add Schedule Drawer */}
      {showAdd && (
        <form onSubmit={handleAdd} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-slate-900">New Scheduled Work Block</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Job Order *</label>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
              >
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.jobNumber} — {j.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700">Shift Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Framing inspection & deck railing"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Start</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">End</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Crew</label>
              <input
                type="text"
                value={crewAssigned}
                onChange={(e) => setCrewAssigned(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={syncGoogle}
                onChange={(e) => setSyncGoogle(e.target.checked)}
                disabled={!googleConnected}
                className="h-4 w-4 rounded border-slate-300 text-amber-600"
              />
              {googleConnected ? 'Sync event to Google Calendar' : 'Sign in with Google to sync calendar events'}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Save Shift
              </button>
            </div>
          </div>
        </form>
      )}

      {/* MONTHLY CALENDAR VIEW */}
      {viewMode === 'month' ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <div className="min-w-[740px]">
              {/* Weekday Header */}
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dow) => (
                  <div
                    key={dow}
                    className="border-r border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 last:border-r-0"
                  >
                    {dow}
                  </div>
                ))}
              </div>

              {/* Day Cells */}
              <div className="grid grid-cols-7">
                {monthCells.map((cell) => {
                  const dayItems = combinedAgenda.filter((item) => item.date === cell.iso);
                  const jobMarkers = jobDateMarkersByDay.get(cell.iso) || [];

                  return (
                    <div
                      key={cell.iso}
                      className={`group flex min-h-[126px] flex-col border-b border-r border-slate-200 p-2 last:border-r-0 ${
                        !cell.inCurrentMonth
                          ? 'bg-slate-50/70'
                          : cell.isToday
                          ? 'bg-amber-50/30'
                          : cell.isWeekend
                          ? 'bg-slate-50/30'
                          : 'bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 font-mono text-xs font-semibold tabular-nums ${
                            cell.isToday
                              ? 'bg-amber-600 text-white'
                              : cell.inCurrentMonth
                              ? 'text-slate-900'
                              : 'text-slate-400'
                          }`}
                        >
                          {cell.dayNum}
                        </span>
                        {jobs.length > 0 && (
                          <button
                            type="button"
                            onClick={() => openAddForDate(cell.iso)}
                            className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 focus:opacity-100"
                            aria-label={`Schedule shift on ${cell.iso}`}
                            title="Schedule shift on this day"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="mt-1.5 flex-1 space-y-1">
                        {jobMarkers.map(({ job, kind }) => {
                          const urgencyMeta = getUrgencyMeta(job.urgency);
                          return (
                            <button
                              key={`${job.id}-${kind}`}
                              type="button"
                              onClick={() => onOpenJob(job.id)}
                              title={`${kind === 'start' ? 'Start' : 'Finish'}: ${job.jobNumber} ${job.title}`}
                              className="flex w-full items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-left text-[11px] font-medium text-slate-700 hover:border-amber-400 hover:bg-amber-50/60"
                            >
                              <span className={`h-1.5 w-1.5 rounded-xs shrink-0 ${urgencyMeta.dotClass}`} />
                              <span className="font-mono text-[10px] font-semibold text-slate-500 shrink-0">
                                {kind === 'start' ? 'Start' : 'Due'}
                              </span>
                              <span className="truncate font-semibold text-slate-900">
                                {job.jobNumber} {job.title}
                              </span>
                            </button>
                          );
                        })}

                        {dayItems.map((item) =>
                          item.source === 'job' ? (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => onOpenJob(item.jobId)}
                              title={`${item.timeRange} · ${item.title} (${item.subtitle})`}
                              className="flex w-full items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-left text-[11px] transition-colors hover:border-amber-400"
                            >
                              <span className="font-mono text-[10px] font-semibold text-amber-800 tabular-nums shrink-0">
                                {item.shortTime}
                              </span>
                              <span className="truncate font-semibold text-slate-900">
                                {item.jobNumber ? `${item.jobNumber} ` : ''}
                                {item.title}
                              </span>
                            </button>
                          ) : (
                            <div
                              key={item.id}
                              title={`${item.timeRange} · ${item.title}`}
                              className="flex w-full items-center gap-1 rounded border border-slate-200 bg-slate-100 px-1.5 py-1 text-left text-[11px]"
                            >
                              <span className="font-mono text-[10px] font-semibold text-slate-600 tabular-nums shrink-0">
                                {item.shortTime}
                              </span>
                              <span className="truncate font-medium text-slate-800">{item.title}</span>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : viewMode === 'week' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {weekDays.map((day) => {
            const dayItems = combinedAgenda.filter((item) => item.date === day.iso);
            return (
              <div key={day.iso} className="flex min-h-[220px] flex-col rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-3 py-2.5">
                  <div className="text-xs font-medium text-slate-500">{day.dayName}</div>
                  <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums">{day.dayNum}</div>
                </div>
                <div className="flex-1 space-y-2 p-2.5">
                  {dayItems.length === 0 ? (
                    <div className="pt-4 text-center text-xs text-slate-400">Open</div>
                  ) : (
                    dayItems.map((item) =>
                      item.source === 'job' ? (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onOpenJob(item.jobId)}
                          className="w-full rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-left transition-colors hover:border-amber-400"
                        >
                          <div className="font-mono text-[11px] font-semibold text-amber-800 tabular-nums">
                            {item.timeRange}
                          </div>
                          <div className="mt-0.5 text-xs font-semibold text-slate-900 line-clamp-2">
                            {item.title}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-600 truncate">{item.subtitle}</div>
                        </button>
                      ) : (
                        <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <div className="font-mono text-[11px] font-semibold text-slate-600 tabular-nums">
                            {item.timeRange}
                          </div>
                          <div className="mt-0.5 text-xs font-medium text-slate-900 line-clamp-2">
                            {item.title}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 truncate">Google Calendar</div>
                        </div>
                      )
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {combinedAgenda.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No upcoming scheduled work or calendar events.</div>
          ) : (
            combinedAgenda.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <CalendarIcon className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-mono font-semibold text-slate-800 tabular-nums">
                      {formatDateShort(item.date)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{item.timeRange}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-700">
                      {item.source === 'job' ? 'Job Order Shift' : 'Google Calendar'}
                    </span>
                  </div>
                  <div className="mt-1 font-medium text-slate-900">{item.title}</div>
                  <div className="text-xs text-slate-500">{item.subtitle}</div>
                </div>
                {item.source === 'job' ? (
                  <button
                    type="button"
                    onClick={() => onOpenJob(item.jobId)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                  >
                    Open Job Order
                  </button>
                ) : (
                  item.htmlLink &&
                  isSafeHttpUrl(item.htmlLink) && (
                    <a
                      href={item.htmlLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      View in Calendar
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
