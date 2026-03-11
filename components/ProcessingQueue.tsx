'use client';

import { useEffect, useRef, useState } from 'react';
import type { QueueJob } from '@/types';

interface Props {
  jobs: QueueJob[];
  onRemove: (id: string) => void;
  onCancelCurrent: () => void;
  onClearDone: () => void;
}

const STATUS_ICON: Record<QueueJob['status'], string> = {
  waiting: '·',
  running: '◌',
  done: '✓',
  error: '✗',
};

export default function ProcessingQueue({ jobs, onRemove, onCancelCurrent, onClearDone }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (jobs.length === 0) return null;

  const running = jobs.find((j) => j.status === 'running');
  const waiting = jobs.filter((j) => j.status === 'waiting');
  const errors = jobs.filter((j) => j.status === 'error');
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'error');
  const active = running ?? waiting[0];

  // Pill label
  let pillLabel: string;
  if (running) {
    const p = running.progress;
    pillLabel = p ? `${running.title} · ch.${p.current}/${p.total}` : running.title;
  } else if (waiting.length > 0) {
    pillLabel = `${waiting.length} queued`;
  } else if (errors.length > 0) {
    pillLabel = `${errors.length} error${errors.length > 1 ? 's' : ''}`;
  } else {
    pillLabel = 'Done';
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Pill */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
          errors.length > 0 && !running
            ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
            : running
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-500 hover:bg-amber-500/20'
            : 'bg-stone-100 dark:bg-zinc-800 border-stone-200 dark:border-zinc-700 text-stone-400 dark:text-zinc-500 hover:text-stone-600 dark:hover:text-zinc-300'
        }`}
        title="Processing queue"
      >
        {running && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />}
        {errors.length > 0 && !running && <span className="text-red-400">✗</span>}
        {!running && errors.length === 0 && finished.length > 0 && waiting.length === 0 && <span className="text-emerald-400">✓</span>}
        <span className="max-w-[160px] truncate">{pillLabel}</span>
        <span className="opacity-50">{open ? '▴' : '▾'}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 py-2 bg-stone-50 dark:bg-zinc-800/60 border-b border-stone-200 dark:border-zinc-800">
            <span className="text-xs font-semibold text-stone-700 dark:text-zinc-300">
              {active ? `Processing · ${waiting.length + (running ? 1 : 0)} remaining` : 'Queue done'}
            </span>
            {finished.length > 0 && (
              <button
                onClick={onClearDone}
                className="text-[10px] text-stone-400 dark:text-zinc-600 hover:text-stone-600 dark:hover:text-zinc-400 transition-colors"
              >
                Clear done
              </button>
            )}
          </div>

          <ul className="max-h-64 overflow-y-auto divide-y divide-stone-100 dark:divide-zinc-800/60">
            {jobs.map((job) => (
              <li key={job.id} className="px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span
                    className={`flex-shrink-0 mt-0.5 text-sm leading-none ${
                      job.status === 'running' ? 'text-amber-500 animate-spin' :
                      job.status === 'done' ? 'text-emerald-400' :
                      job.status === 'error' ? 'text-red-400' :
                      'text-stone-400 dark:text-zinc-600'
                    }`}
                  >
                    {STATUS_ICON[job.status]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-stone-700 dark:text-zinc-300 truncate">{job.title}</p>
                    <p className="text-[10px] text-stone-400 dark:text-zinc-600 truncate">{job.author}</p>
                    {job.status === 'running' && job.progress && (
                      <>
                        <p className="text-[10px] text-stone-400 dark:text-zinc-500 mt-0.5 truncate">
                          Ch. {job.progress.current}/{job.progress.total}
                          {job.progress.chapterTitle && ` · ${job.progress.chapterTitle}`}
                        </p>
                        <div className="mt-1.5 w-full bg-stone-200 dark:bg-zinc-800 rounded-full h-0.5">
                          <div
                            className="h-0.5 bg-amber-500 rounded-full transition-all duration-300"
                            style={{ width: `${Math.round((job.progress.current / job.progress.total) * 100)}%` }}
                          />
                        </div>
                      </>
                    )}
                    {job.status === 'error' && job.error && (
                      <p className="text-[10px] text-red-400 mt-0.5 line-clamp-2">{job.error}</p>
                    )}
                  </div>
                  {job.status === 'running' ? (
                    <button
                      onClick={onCancelCurrent}
                      className="flex-shrink-0 text-[10px] text-stone-400 dark:text-zinc-600 hover:text-red-400 transition-colors mt-0.5"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      onClick={() => onRemove(job.id)}
                      className="flex-shrink-0 text-stone-300 dark:text-zinc-700 hover:text-red-400 transition-colors text-xs leading-none mt-0.5"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
