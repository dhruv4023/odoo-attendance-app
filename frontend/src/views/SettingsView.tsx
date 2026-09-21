import React, { useState, useEffect } from 'react';
import * as AppService from '../../bindings/time-check/appservice.js';
import { DayKey, ScheduleSettings, Settings, AppInfo } from '../types.js';
import {
  ChevronLeft,
  Calendar,
  Link,
  Laptop,
  Clock,
  Save,
  CheckCircle2,
  AlertCircle,
  Bell
} from 'lucide-react';

interface SettingsViewProps {
  onBack: () => void;
}

const DAYS: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS: Record<DayKey, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

const DEFAULT_SCHEDULE: ScheduleSettings = {
  monday: { enabled: true, check_in: '09:30', check_out: '18:30' },
  tuesday: { enabled: true, check_in: '09:30', check_out: '18:30' },
  wednesday: { enabled: true, check_in: '09:30', check_out: '18:30' },
  thursday: { enabled: true, check_in: '09:30', check_out: '18:30' },
  friday: { enabled: true, check_in: '09:30', check_out: '18:30' },
  saturday: { enabled: false, check_in: '10:00', check_out: '16:00' },
  sunday: { enabled: false, check_in: '10:00', check_out: '16:00' },
};

export const SettingsView: React.FC<SettingsViewProps> = ({ onBack }) => {
  const [schedule, setSchedule] = useState<ScheduleSettings>(DEFAULT_SCHEDULE);
  const [url, setUrl] = useState('');
  const [autostart, setAutostart] = useState(false);
  const [schedulerEnabled, setSchedulerEnabled] = useState(true);
  const [logThresholdMinutes, setLogThresholdMinutes] = useState(3);
  const [checkOutWindowBeforeMinutes, setCheckOutWindowBeforeMinutes] = useState(0);
  const [checkOutWindowAfterMinutes, setCheckOutWindowAfterMinutes] = useState(30);
  const [snoozeDurationMinutes, setSnoozeDurationMinutes] = useState(10);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const setts: Settings = await AppService.GetSettings();
        if (setts?.schedule) {
          setSchedule(setts.schedule);
        }
        if (setts?.url) {
          setUrl(setts.url);
        }
        if (setts?.autostart !== undefined) {
          setAutostart(Boolean(setts.autostart));
        }
        if (setts?.scheduler_enabled !== undefined) {
          setSchedulerEnabled(Boolean(setts.scheduler_enabled));
        }
        if (setts?.log_threshold_minutes !== undefined) {
          setLogThresholdMinutes(setts.log_threshold_minutes);
        }
        if (setts?.check_out_window_before_minutes !== undefined) {
          setCheckOutWindowBeforeMinutes(setts.check_out_window_before_minutes);
        }
        if (setts?.check_out_window_after_minutes !== undefined) {
          setCheckOutWindowAfterMinutes(setts.check_out_window_after_minutes);
        }
        if (setts?.snooze_duration_minutes !== undefined) {
          setSnoozeDurationMinutes(setts.snooze_duration_minutes);
        }

        if (typeof AppService.GetAppInfo === 'function') {
          const info = await AppService.GetAppInfo();
          setAppInfo(info);
        }
      } catch (e) {
        console.warn('load settings error:', e);
      }
    };
    load();
  }, []);

  const showMsg = (text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleDayToggle = (day: DayKey) => {
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        enabled: !prev[day].enabled,
      },
    }));
  };

  const handleTimeChange = (day: DayKey, field: 'check_in' | 'check_out', val: string) => {
    setSchedule(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: val,
      },
    }));
  };

  const validateURL = (val: string) => {
    if (!val) return true;
    try {
      const u = new URL(val);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleSave = async () => {
    setErrors({});
    const newErrors: Record<string, string> = {};

    // Validate schedule
    for (const d of DAYS) {
      const day = schedule[d];
      if (day.enabled) {
        if (!day.check_in) {
          newErrors.schedule = `${DAY_LABELS[d]}: check-in time is required`;
          break;
        }
        if (!day.check_out) {
          newErrors.schedule = `${DAY_LABELS[d]}: check-out time is required`;
          break;
        }
        if (day.check_in >= day.check_out) {
          newErrors.schedule = `${DAY_LABELS[d]}: check-out must be after check-in`;
          break;
        }
      }
    }

    if (url && !validateURL(url)) {
      newErrors.url = 'Must be a valid http or https URL';
    }

    if (isNaN(logThresholdMinutes) || logThresholdMinutes < 1) {
      newErrors.threshold = 'Threshold must be at least 1 minute';
    }

    if (isNaN(checkOutWindowBeforeMinutes) || checkOutWindowBeforeMinutes < 0) {
      newErrors.window = 'Before check-out window must be 0 or greater';
    }

    if (isNaN(checkOutWindowAfterMinutes) || checkOutWindowAfterMinutes < 0) {
      newErrors.window = 'After check-out window must be 0 or greater';
    }

    if (isNaN(snoozeDurationMinutes) || snoozeDurationMinutes < 1) {
      newErrors.snooze = 'Snooze duration must be at least 1 minute';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      await AppService.SaveSettings({
        schedule,
        url: url.trim(),
        autostart,
        scheduler_enabled: schedulerEnabled,
        log_threshold_minutes: Number(logThresholdMinutes) || 3,
        check_out_window_before_minutes: Number(checkOutWindowBeforeMinutes) ?? 0,
        check_out_window_after_minutes: Number(checkOutWindowAfterMinutes) ?? 30,
        snooze_duration_minutes: Number(snoozeDurationMinutes) || 10,
      });
      showMsg('Settings saved successfully!');
    } catch (e: any) {
      showMsg(e?.message || 'Failed to save settings', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto px-4 pb-6 gap-4 animate-slide-up">
      {/* Header with Back Button */}
      <div className="flex items-center justify-between pt-3 pb-1 border-b border-slate-800/80">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 py-1.5 px-2.5 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/60 transition-all active:scale-95 cursor-pointer shadow-sm"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
          <span>Back</span>
        </button>
        <div className="text-xs font-semibold tracking-widest text-slate-400 uppercase">
          Settings
        </div>
        <div className="w-14" />
      </div>

      {/* Weekly Work Schedule Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 shadow-lg flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-sky-400" />
            Work Schedule
          </h2>
          <span className="text-[10px] text-slate-500 font-medium">Daily In & Out Times</span>
        </div>

        <div className="flex flex-col gap-2">
          {DAYS.map(day => {
            const d = schedule[day];
            return (
              <div
                key={day}
                className={`flex items-center justify-between p-2.5 rounded-xl border transition-colors ${
                  d.enabled ? 'bg-slate-950/60 border-slate-800/80' : 'bg-slate-950/20 border-slate-800/30 opacity-60'
                }`}
              >
                <label className="flex items-center gap-2 cursor-pointer select-none min-w-[90px]">
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    onChange={() => handleDayToggle(day)}
                    className="sr-only"
                  />
                  <div
                    className={`w-6 h-3.5 rounded-full transition-colors relative ${
                      d.enabled ? 'bg-sky-500' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`w-2.5 h-2.5 rounded-full bg-white transition-transform absolute top-0.5 left-0.5 ${
                        d.enabled ? 'translate-x-2.5' : 'translate-x-0'
                      }`}
                    />
                  </div>
                  <span className="text-xs font-medium text-slate-200">{DAY_LABELS[day]}</span>
                </label>

                {d.enabled ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-500 uppercase">In:</span>
                      <input
                        type="time"
                        value={d.check_in}
                        onChange={e => handleTimeChange(day, 'check_in', e.target.value)}
                        className="bg-slate-900 border border-slate-700/80 text-slate-200 text-xs rounded-lg px-1.5 py-1 font-mono outline-none focus:border-sky-400"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-500 uppercase">Out:</span>
                      <input
                        type="time"
                        value={d.check_out}
                        onChange={e => handleTimeChange(day, 'check_out', e.target.value)}
                        className="bg-slate-900 border border-slate-700/80 text-slate-200 text-xs rounded-lg px-1.5 py-1 font-mono outline-none focus:border-sky-400"
                      />
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-slate-600 italic">Day Off</span>
                )}
              </div>
            );
          })}
        </div>
        {errors.schedule && <p className="text-[11px] text-rose-400">{errors.schedule}</p>}
      </div>

      {/* Check-Out Reminder Popup Window Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 shadow-lg flex flex-col gap-3">
        <h2 className="text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          Check-in/Out Reminder Popup Window
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Before Check-in/Out
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={360}
                value={checkOutWindowBeforeMinutes}
                onChange={e => setCheckOutWindowBeforeMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full bg-slate-950 border border-slate-700/80 text-slate-200 text-xs rounded-xl px-3 py-2 outline-none focus:border-sky-400 font-mono"
              />
              <span className="text-xs text-slate-400">min</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              After Check-in/Out
            </label>  
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={360}
                value={checkOutWindowAfterMinutes}
                onChange={e => setCheckOutWindowAfterMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full bg-slate-950 border border-slate-700/80 text-slate-200 text-xs rounded-xl px-3 py-2 outline-none focus:border-sky-400 font-mono"
              />
              <span className="text-xs text-slate-400">min</span>
            </div>
          </div>
        </div>

        {/* Dynamic Window Explanation Box */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-[11px] text-slate-400 flex items-start gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
          <span>
            {checkOutWindowBeforeMinutes === 0 && checkOutWindowAfterMinutes === 0
              ? 'Reminder popup will trigger only exactly at check-out time.'
              : `Popup will remind from ${checkOutWindowBeforeMinutes} min before to ${checkOutWindowAfterMinutes} min after your scheduled check-out time.`}
          </span>
        </div>
        {errors.window && <p className="text-[11px] text-rose-400">{errors.window}</p>}
      </div>

      {/* Reminder Inactivity Threshold Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 shadow-lg flex flex-col gap-3">
        <h2 className="text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-sky-400" />
          Reminder Inactivity Threshold
        </h2>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Dialog Trigger Threshold (minutes)
          </label>
          <div className="flex items-center gap-2.5">
            <input
              type="number"
              min={1}
              max={1440}
              value={logThresholdMinutes}
              onChange={e => setLogThresholdMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-24 bg-slate-950 border border-slate-700/80 text-slate-200 text-xs rounded-xl px-3 py-2 outline-none focus:border-sky-400 font-mono"
            />
            <span className="text-xs text-slate-400">minutes</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            Shows reminder dialog on login / logout / shutdown only if no check-in or check-out log was added in the last {logThresholdMinutes} minute{logThresholdMinutes === 1 ? '' : 's'}.
          </p>
          {errors.threshold && <p className="text-[11px] text-rose-400 mt-1">{errors.threshold}</p>}
        </div>
      </div>

      {/* Snooze Duration Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 shadow-lg flex flex-col gap-3">
        <h2 className="text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          Reminder Snooze Duration
        </h2>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Snooze Time (minutes)
          </label>
          <div className="flex items-center gap-2.5">
            <input
              type="number"
              min={1}
              max={1440}
              value={snoozeDurationMinutes}
              onChange={e => setSnoozeDurationMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-24 bg-slate-950 border border-slate-700/80 text-slate-200 text-xs rounded-xl px-3 py-2 outline-none focus:border-amber-400 font-mono"
            />
            <span className="text-xs text-slate-400">minutes</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">
            When clicking Snooze on a check-in or check-out reminder, the dialog will re-appear after {snoozeDurationMinutes} minute{snoozeDurationMinutes === 1 ? '' : 's'} if still not checked in/out.
          </p>
          {errors.snooze && <p className="text-[11px] text-rose-400 mt-1">{errors.snooze}</p>}
        </div>
      </div>

      {/* Attendance Portal URL Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 shadow-lg flex flex-col gap-3">
        <h2 className="text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
          <Link className="w-3.5 h-3.5 text-sky-400" />
          Attendance Portal URL
        </h2>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Portal URL</label>
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com/attendance"
            className={`w-full bg-slate-950 border text-slate-200 text-xs rounded-xl px-3 py-2 outline-none transition-colors ${errors.url ? 'border-rose-500 focus:border-rose-400' : 'border-slate-700/80 focus:border-sky-400'
              }`}
          />
          <p className="text-[11px] text-slate-500 mt-1">
            The web portal where check-in and check-out actions are completed.
          </p>
          {errors.url && <p className="text-[11px] text-rose-400 mt-1">{errors.url}</p>}
        </div>
      </div>

      {/* Scheduled Desktop Notifications (Scheduler) Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 shadow-lg">
        <h2 className="text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center gap-1.5 mb-3">
          <Bell className="w-3.5 h-3.5 text-sky-400" />
          Scheduled Desktop Notifications
        </h2>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={schedulerEnabled}
            onChange={e => setSchedulerEnabled(e.target.checked)}
            className="sr-only"
          />
          <div
            className={`w-8 h-4.5 rounded-full transition-colors relative ${schedulerEnabled ? 'bg-sky-500' : 'bg-slate-700'
              }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 left-0.5 ${schedulerEnabled ? 'translate-x-3.5' : 'translate-x-0'
                }`}
            />
          </div>
          <span className="text-xs font-semibold text-slate-200">
            Remind at scheduled work times
          </span>
        </label>
      </div>

      {/* Application Settings Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 shadow-lg">
        <h2 className="text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center gap-1.5 mb-3">
          <Laptop className="w-3.5 h-3.5 text-sky-400" />
          Application
        </h2>

        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autostart}
            onChange={e => setAutostart(e.target.checked)}
            className="sr-only"
          />
          <div
            className={`w-8 h-4.5 rounded-full transition-colors relative ${autostart ? 'bg-sky-500' : 'bg-slate-700'
              }`}
          >
            <div
              className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 left-0.5 ${autostart ? 'translate-x-3.5' : 'translate-x-0'
                }`}
            />
          </div>
          <span className="text-xs font-semibold text-slate-200">
            Start automatically after login
          </span>
        </label>
        <p className="text-[11px] text-slate-500 mt-2 pl-10">
          Registers an XDG desktop autostart entry on Linux login.
        </p>
      </div>

      {/* Message Feedback */}
      {message && (
        <div
          className={`p-3 rounded-xl text-xs font-medium flex items-center justify-center gap-2 text-center animate-fade-in ${message.isError
              ? 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
              : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
            }`}
        >
          {message.isError ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Save Button */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold text-xs bg-sky-500 hover:bg-sky-400 active:scale-[0.98] disabled:opacity-50 text-slate-950 shadow-lg shadow-sky-500/20 transition-all cursor-pointer"
      >
        <Save className="w-4 h-4" />
        {saving ? 'Saving…' : 'Save Settings'}
      </button>

      {/* Footer Version Info */}
      <div className="text-center pt-2 text-[10px] text-slate-600 font-mono">
        TimeCheck v{appInfo?.version || '1.0.0'} • Build: {appInfo?.build_time || '—'}
      </div>
    </div>
  );
};
