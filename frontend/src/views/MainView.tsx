import React, { useState, useEffect } from 'react';
import * as AppService from '../../bindings/time-check/appservice.js';
import { DailyStatus, NextReminder, Settings, AppInfo } from '../types.js';
import {
  CheckCircle2,
  LogOut,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Clock,
  Calendar,
  AlertCircle,
  Bell,
  ListOrdered,
  RefreshCw
} from 'lucide-react';

interface MainViewProps {
  onNavigateSettings: () => void;
  status: DailyStatus | null;
  onRefresh: () => void;
}

export const MainView: React.FC<MainViewProps> = ({
  onNavigateSettings,
  status,
  onRefresh,
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [nextReminder, setNextReminder] = useState<NextReminder | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [actionLoading, setActionLoading] = useState<'check_in' | 'check_out' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Live Clock Tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadData = async () => {
    try {
      const [nr, setts] = await Promise.all([
        AppService.GetNextReminder(),
        AppService.GetSettings(),
      ]);
      setNextReminder(nr);
      setSettings(setts);

      if (typeof AppService.GetAppInfo === 'function') {
        const info = await AppService.GetAppInfo();
        setAppInfo(info);
      }
    } catch (e) {
      console.warn('MainView loadData:', e);
    }
  };

  // Fetch Schedule, Next Reminder & App Info
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [status]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
      onRefresh();
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  };

  const showMsg = (text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleCheckIn = async () => {
    setActionLoading('check_in');
    try {
      const res = await AppService.CheckIn();
      showMsg(res.message || (res.ok ? 'Checked in! Attendance page opened.' : 'Check-in failed.'), !res.ok);
      onRefresh();
    } catch (e) {
      showMsg(String(e), true);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCheckOut = async () => {
    setActionLoading('check_out');
    try {
      const res = await AppService.CheckOut();
      showMsg(res.message || (res.ok ? 'Checked out! Attendance page opened.' : 'Check-out failed.'), !res.ok);
      onRefresh();
    } catch (e) {
      showMsg(String(e), true);
    } finally {
      setActionLoading(null);
    }
  };

  // Status computations
  const isCheckedOut = Boolean(
    status?.logs && status.logs.length > 0 && status.logs[status.logs.length - 1].type === 'check_out'
  );
  const isCheckedIn = Boolean(status?.checked_in);

  const lastInLog = status?.logs?.slice().reverse().find(l => l.type === 'check_in');
  const lastOutLog = status?.logs?.slice().reverse().find(l => l.type === 'check_out');

  const formatTimeStr = (iso?: Date | string) => {
    if (!iso) return '';
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const formatTimeWithSec = (iso?: Date | string) => {
    if (!iso) return '';
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  const getStatusSubtitle = () => {
    if (isCheckedOut && lastOutLog) {
      return `Checked out at ${formatTimeStr(lastOutLog.timestamp)}`;
    }
    if (isCheckedIn && lastInLog) {
      return `Checked in at ${formatTimeStr(lastInLog.timestamp)}`;
    }
    return '';
  };

  // Today schedule lookup
  const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  const currentDayKey = dayKeys[currentTime.getDay()];
  const todaySchedule = settings?.schedule && currentDayKey !== 'sunday' && currentDayKey !== 'saturday'
    ? settings.schedule[currentDayKey]
    : currentDayKey === 'sunday' || currentDayKey === 'saturday'
      ? settings?.schedule[currentDayKey]
      : null;

  const logs = status?.logs ?? [];

  return (
    <div className="flex flex-col h-full overflow-y-auto px-4 pb-4 gap-3.5 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between pt-3 pb-1">
        <div className="w-8" />
        <div className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
          TimeCheck
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh attendance status"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-sky-400' : ''}`} />
        </button>
      </div>

      {/* Clock Display */}
      <div className="text-center py-2">
        <div className="text-4xl font-light tracking-tight text-white font-mono">
          {currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </div>
        <div className="text-xs text-slate-400 mt-1 flex items-center justify-center gap-1.5 font-medium">
          <Calendar className="w-3.5 h-3.5 text-slate-500" />
          {currentTime.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
      </div>

      {/* Status Card */}
      <div
        className={`rounded-2xl p-4 border transition-all duration-300 shadow-lg ${isCheckedIn && !isCheckedOut
            ? 'bg-emerald-950/20 border-emerald-500/30 shadow-emerald-950/20'
            : isCheckedOut
              ? 'bg-rose-950/20 border-rose-500/30 shadow-rose-950/20'
              : 'bg-slate-900/80 border-slate-800/80 shadow-slate-950/30'
          }`}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          {/* Status Badge */}
          <div
            className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold tracking-wide border shadow-sm ${isCheckedOut
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                : isCheckedIn
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${isCheckedOut
                  ? 'bg-rose-400'
                  : isCheckedIn
                    ? 'bg-emerald-400 animate-pulse-subtle'
                    : 'bg-slate-500'
                }`}
            />
            {isCheckedOut ? 'Checked Out' : isCheckedIn ? 'Checked In' : 'Not Checked In'}
          </div>

          <div className="text-xs text-slate-400 min-h-[16px]">
            {getStatusSubtitle()}
          </div>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            className={`mt-3 p-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-2 text-center animate-fade-in ${message.isError
                ? 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
                : 'bg-sky-500/15 border border-sky-500/30 text-sky-400'
              }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{message.text}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2.5 mt-4">
          <button
            type="button"
            onClick={handleCheckIn}
            disabled={actionLoading !== null}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white shadow-md shadow-emerald-950/30 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            {actionLoading === 'check_in' ? 'Checking in…' : 'Check In'}
          </button>
          <button
            type="button"
            onClick={handleCheckOut}
            disabled={actionLoading !== null}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-semibold text-xs bg-rose-600 hover:bg-rose-500 active:scale-95 disabled:opacity-50 text-white shadow-md shadow-rose-950/30 transition-all cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            {actionLoading === 'check_out' ? 'Checking out…' : 'Check Out'}
          </button>
        </div>
      </div>

      {/* Activity Logs Table Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
            <ListOrdered className="w-3.5 h-3.5 text-sky-400" />
            Today's Logs
          </h2>
          <span className="text-[11px] font-medium text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-md border border-slate-700/50">
            {logs.length} {logs.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800/60 bg-slate-950/40">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
                <th className="py-2 px-3 w-8">#</th>
                <th className="py-2 px-3">Action</th>
                <th className="py-2 px-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-5 px-3 text-center text-slate-500 italic text-xs">
                    No activity logged today
                  </td>
                </tr>
              ) : (
                logs.map((log, idx) => {
                  const isCheckIn = log.type === 'check_in';
                  return (
                    <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">{idx + 1}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-semibold text-[11px] border ${isCheckIn
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                            }`}
                        >
                          {isCheckIn ? <Sun className="w-3 h-3 text-emerald-400" /> : <Moon className="w-3 h-3 text-rose-400" />}
                          {isCheckIn ? 'Check In' : 'Check Out'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[11px] text-slate-300">
                        {formatTimeWithSec(log.timestamp)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Today's Schedule Card */}
      <div className="rounded-2xl bg-slate-900/80 border border-slate-800/80 p-4 shadow-lg">
        <h2 className="text-xs font-bold tracking-wider uppercase text-slate-400 flex items-center gap-1.5 mb-3">
          <Clock className="w-3.5 h-3.5 text-sky-400" />
          Today's Schedule
        </h2>

        <div className="flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between py-1 border-b border-slate-800/50">
            <span className="text-slate-400 font-medium">Check In</span>
            <span className="font-semibold text-slate-200 font-mono">
              {todaySchedule?.enabled ? todaySchedule.check_in : '—'}
            </span>
          </div>

          <div className="flex items-center justify-between py-1 border-b border-slate-800/50">
            <span className="text-slate-400 font-medium">Check Out</span>
            <span className="font-semibold text-slate-200 font-mono">
              {todaySchedule?.enabled ? todaySchedule.check_out : '—'}
            </span>
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-slate-400 font-medium flex items-center gap-1">
              <Bell className="w-3 h-3 text-amber-400" />
              Next Reminder
            </span>
            <span className="font-semibold text-sky-400 font-mono">
              {nextReminder
                ? `${nextReminder.type === 'check_in' ? 'Check In' : 'Check Out'} at ${formatTimeStr(nextReminder.at)}`
                : 'None scheduled'}
            </span>
          </div>
        </div>
      </div>

      {/* Settings Navigation */}
      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={onNavigateSettings}
          className="inline-flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/60 transition-all active:scale-95 cursor-pointer shadow-sm"
        >
          <SettingsIcon className="w-3.5 h-3.5 text-slate-400" />
          <span>Settings</span>
        </button>
      </div>

      {/* Footer Build Info */}
      <div className="text-center pt-1 text-[10px] text-slate-600 font-mono">
        Build: {appInfo?.build_time || '—'}
      </div>
    </div>
  );
};
