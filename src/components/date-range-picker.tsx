"use client";

import { useState, useRef, useEffect } from "react";

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
}

interface Preset {
  label: string;
  hours?: number;
  days?: number;
}

const PRESETS: Preset[] = [
  { label: "3h", hours: 3 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function hoursAgo(n: number): string {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate(d);
}

function formatDisplayLabel(start: string, end: string): string {
  if (!start || !end) return "All Time";

  const now = new Date();
  const startTime = new Date(start).getTime();
  for (const preset of PRESETS) {
    if (preset.hours) {
      const presetStart = new Date(now.getTime() - preset.hours * 3600000);
      if (Math.abs(startTime - presetStart.getTime()) < 300000) {
        return `Last ${preset.label}`;
      }
    }
  }

  const startDate = start.includes("T") ? start.split("T")[0] : start;
  const endDate = end.includes("T") ? end.split("T")[0] : end;
  return `${startDate} — ${endDate}`;
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const ref = useRef<HTMLDivElement>(null);

  // Sync draft with props when dropdown opens
  useEffect(() => {
    if (open) {
      setDraftStart(startDate);
      setDraftEnd(endDate);
    }
  }, [open, startDate, endDate]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const displayLabel = formatDisplayLabel(startDate, endDate);

  const draftStartOnly = draftStart?.includes("T") ? draftStart.split("T")[0] : draftStart;
  const draftEndOnly = draftEnd?.includes("T") ? draftEnd.split("T")[0] : draftEnd;

  function applyAndClose(start: string, end: string) {
    onChange(start, end);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Time Range
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-64 items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-left text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        <span className={startDate ? "" : "text-zinc-400"}>
          {displayLabel}
        </span>
        <svg
          className={`ml-2 h-4 w-4 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-72 rounded-md border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-3 flex flex-wrap gap-2">
            {PRESETS.map((preset) => {
              // Check if this preset matches the current draft
              let isActive = false;
              if (draftStart && draftEnd) {
                const draftStartTime = new Date(draftStart).getTime();
                const now = new Date();
                if (preset.hours) {
                  const presetStart = new Date(now.getTime() - preset.hours * 3600000);
                  isActive = Math.abs(draftStartTime - presetStart.getTime()) < 300000;
                } else if (preset.days) {
                  const presetStartDate = daysAgo(preset.days);
                  isActive = draftStart === presetStartDate || draftStart.startsWith(presetStartDate);
                }
              }
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    if (preset.hours) {
                      setDraftStart(hoursAgo(preset.hours));
                      setDraftEnd(new Date().toISOString());
                    } else if (preset.days) {
                      setDraftStart(daysAgo(preset.days));
                      setDraftEnd(formatDate(new Date()));
                    }
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "border border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
                From
              </label>
              <input
                type="date"
                value={draftStartOnly}
                max={draftEndOnly || formatDate(new Date())}
                onChange={(e) => setDraftStart(e.target.value)}
                className="w-full rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
                To
              </label>
              <input
                type="date"
                value={draftEndOnly}
                min={draftStartOnly}
                max={formatDate(new Date())}
                onChange={(e) => setDraftEnd(e.target.value)}
                className="w-full rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-between">
            <button
              type="button"
              onClick={() => applyAndClose("", "")}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => applyAndClose(draftStart, draftEnd)}
              className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
