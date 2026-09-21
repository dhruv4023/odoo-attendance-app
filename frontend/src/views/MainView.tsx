import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as AppService from '../../bindings/time-check/appservice.js';
import { DailyStatus, Settings, AppInfo } from '../types.js';
import {
  CheckCircle2,
  LogOut,
  Settings as SettingsIcon,
  ListOrdered,
  Sun,
  Moon,
  Calendar,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  X,
  Minimize2,
  Laptop,
  Clock,
  Save,
  ShieldAlert,
  HelpCircle,
  Sparkles
} from 'lucide-react';

interface MainViewProps {
  status: DailyStatus | null;
  onRefresh: () => void;
  shutdownAction?: string | null;
  onClearShutdownAction?: () => void;
}

export const MainView: React.FC<MainViewProps> = ({
  status,
  onRefresh,
  shutdownAction,
  onClearShutdownAction,
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  // Modals / Drawers
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Settings form state inside modal
  const [settingsUrl, setSettingsUrl] = useState('https://www.odoo.com/odoo');
  const [settingsAutostart, setSettingsAutostart] = useState(true);
  const [settingsThreshold, setSettingsThreshold] = useState(3);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  // Clock ticker
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Load Settings and AppInfo
  const loadData = useCallback(async () => {
    try {
      const [setts, info] = await Promise.all([
        AppService.GetSettings(),
        typeof AppService.GetAppInfo === 'function' ? AppService.GetAppInfo() : Promise.resolve(null),
      ]);
      if (setts) {
        setSettings(setts);
        if (setts.url) setSettingsUrl(setts.url);
        if (setts.autostart !== undefined) setSettingsAutostart(setts.autostart);
        if (setts.log_threshold_minutes !== undefined) setSettingsThreshold(setts.log_threshold_minutes);
      }
      if (info) setAppInfo(info);
    } catch (e) {
      console.warn('loadData error:', e);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showToast = (text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 4000);
  };

  // Status computation based on last activity recorded
  const logs = useMemo(() => status?.logs ?? [], [status?.logs]);
  const lastLog = useMemo(() => (logs.length > 0 ? logs[logs.length - 1] : null), [logs]);
  const isCheckedIn = Boolean(lastLog ? lastLog.type === 'check_in' : status?.checked_in);

  const lastInLog = useMemo(() => logs.slice().reverse().find(l => l.type === 'check_in'), [logs]);
  const lastOutLog = useMemo(() => logs.slice().reverse().find(l => l.type === 'check_out'), [logs]);

  const formatTimeStr = (iso?: any) => {
    if (!iso) return '';
    try {
      const d = typeof iso === 'string' ? new Date(iso) : iso instanceof Date ? iso : new Date(String(iso));
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return String(iso);
    }
  };

  // Duration working counter
  const workingDurationStr = useMemo(() => {
    if (!isCheckedIn || !lastInLog) return null;
    const start = new Date(lastInLog.timestamp).getTime();
    const diffMs = Math.max(0, currentTime.getTime() - start);
    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }, [isCheckedIn, lastInLog, currentTime]);

  // Check In Handler
  const handleCheckIn = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const res = await AppService.CheckIn();
      if (!res.ok && res.message) {
        showToast(res.message, true);
      }
    } catch (e) {
      showToast(String(e), true);
    } finally {
      setActionLoading(false);
    }
  };

  // Check Out Handler
  const handleCheckOut = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const res = await AppService.CheckOut();
      if (res.ok) {
        showToast('Checked out! Opening Odoo attendance…');
        onRefresh();
      } else {
        showToast(res.message || 'Check-out failed', true);
      }
    } catch (e) {
      showToast(String(e), true);
    } finally {
      setActionLoading(false);
    }
  };

  // Minimize / Hide window
  const handleMinimize = () => {
    AppService.HideWindow();
  };

  // Save Settings from modal
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      await AppService.SaveSettings({
        url: settingsUrl.trim(),
        autostart: settingsAutostart,
        log_threshold_minutes: Number(settingsThreshold) || 3,
      });
      setSettingsMsg({ text: 'Settings saved!' });
      await loadData();
      setTimeout(() => setShowSettingsModal(false), 1000);
    } catch (e: any) {
      setSettingsMsg({ text: e?.message || 'Failed to save', isError: true });
    } finally {
      setSavingSettings(false);
    }
  };

  // Shutdown Prompt Actions
  const handleShutdownCheckOut = async () => {
    setActionLoading(true);
    try {
      await AppService.ShutdownCheckOut();
      onClearShutdownAction?.();
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleShutdownCancel = async () => {
    setActionLoading(true);
    try {
      await AppService.ShutdownCancel();
      onClearShutdownAction?.();
    } finally {
      setActionLoading(false);
    }
  };

  const handleShutdownSkip = async () => {
    setActionLoading(true);
    try {
      await AppService.ShutdownSkip();
      onClearShutdownAction?.();
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="relative w-screen h-screen bg-slate-950 text-slate-100 flex flex-col justify-between select-none overflow-hidden font-sans">
      {/* Dynamic Ambient Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-[36rem] h-[36rem] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none animate-pulse-subtle" />
      <div className="absolute bottom-1/4 right-1/4 w-[36rem] h-[36rem] bg-sky-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* ── TOP BAR: Top-Left Icon Bar (in right direction) & Top-Right Minimize ── */}
      <header className="w-full px-8 py-6 flex items-center justify-between z-20">
        {/* Top-Left Action Icons in Horizontal Right Direction */}
        <div className="flex items-center gap-3">
          {/* App Badge */}
          <div className="flex items-center gap-2.5 mr-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-sm">
              <Sun className="w-5 h-5 text-emerald-400" />
            </div>
            <span className="font-bold text-sm tracking-tight text-white hidden sm:inline-block">
              TimeCheck
            </span>
          </div>

          {/* Logs Icon Button */}
          <button
            type="button"
            onClick={() => setShowLogsModal(true)}
            className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center gap-2 text-xs font-semibold ${
              showLogsModal
                ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800/80 hover:border-slate-700'
            }`}
            title="View Today's Activity Logs"
          >
            <ListOrdered className="w-4 h-4 text-sky-400" />
            <span className="hidden md:inline">Logs</span>
            {logs.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30">
                {logs.length}
              </span>
            )}
          </button>

          {/* Settings Icon Button */}
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center gap-2 text-xs font-semibold ${
              showSettingsModal
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800/80 hover:border-slate-700'
            }`}
            title="Configure Settings"
          >
            <SettingsIcon className="w-4 h-4 text-amber-400" />
            <span className="hidden md:inline">Settings</span>
          </button>
        </div>

        {/* Top-Right Minimize to Tray Button */}
        <button
          type="button"
          onClick={handleMinimize}
          className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 hover:border-slate-700 transition-all cursor-pointer flex items-center gap-2 text-xs"
          title="Minimize to System Tray"
        >
          <span className="hidden sm:inline text-[11px] font-medium text-slate-400">Minimize</span>
          <Minimize2 className="w-4 h-4" />
        </button>
      </header>

      {/* Toast Notification */}
      {message && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 animate-slide-up">
          <div
            className={`px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2 border shadow-2xl backdrop-blur-md ${
              message.isError
                ? 'bg-rose-950/90 border-rose-500/40 text-rose-200'
                : 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
            }`}
          >
            {message.isError ? (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <span>{message.text}</span>
          </div>
        </div>
      )}

      {/* ── CENTER HERO: Live Clock, Status & ONLY ONE PRIMARY ACTION BUTTON ── */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 z-10 text-center max-w-2xl mx-auto w-full">
        {/* Date & Live Clock */}
        <div className="mb-8 animate-fade-in">
          <div className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-2 flex items-center justify-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <span>{currentTime.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </div>
          <div className="text-6xl sm:text-7xl font-extrabold tracking-tight text-white font-mono drop-shadow-md">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>

        {/* Current Attendance Status Card */}
        <div className="mb-10 w-full max-w-md">
          <div
            className={`p-4 rounded-2xl border backdrop-blur-md transition-all shadow-xl ${
              isCheckedIn
                ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                : lastOutLog
                  ? 'bg-slate-900/60 border-slate-800 text-slate-300'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400'
            }`}
          >
            <div className="flex items-center justify-center gap-2 text-sm font-bold">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isCheckedIn ? 'bg-emerald-400 animate-pulse-subtle' : 'bg-slate-500'
                }`}
              />
              <span>
                {isCheckedIn
                  ? 'You are currently Checked In'
                  : lastOutLog
                    ? `Checked out at ${formatTimeStr(lastOutLog.timestamp)}`
                    : 'Not checked in today'}
              </span>
            </div>

            {isCheckedIn && lastInLog && (
              <div className="text-xs text-emerald-400/80 mt-1.5 font-medium flex items-center justify-center gap-2">
                <span>Checked in at {formatTimeStr(lastInLog.timestamp)}</span>
                {workingDurationStr && (
                  <span className="font-mono bg-emerald-500/15 px-2 py-0.5 rounded-md border border-emerald-500/20">
                    ⏱ {workingDurationStr}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── THE ONLY BUTTON BASED ON LAST ACTIVITY RECORDED ── */}
        <div className="w-full max-w-md">
          {!isCheckedIn ? (
            /* CHECK IN BUTTON (Shown when not checked in or last was check out) */
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={actionLoading}
              className="w-full group relative inline-flex items-center justify-center gap-3 py-5 px-8 rounded-3xl font-extrabold text-lg bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 active:scale-98 disabled:opacity-50 text-white shadow-2xl shadow-emerald-950/80 transition-all cursor-pointer border border-emerald-400/30"
            >
              <div className="p-2 rounded-2xl bg-white/10 group-hover:scale-110 transition-transform">
                <CheckCircle2 className="w-7 h-7 text-emerald-100" />
              </div>
              <div className="text-left">
                <div className="leading-tight">{actionLoading ? 'Checking in…' : 'Check In'}</div>
                <div className="text-[11px] font-normal text-emerald-100/80 flex items-center gap-1">
                  <span>Record attendance & open Odoo</span>
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </div>
              </div>
            </button>
          ) : (
            /* CHECK OUT BUTTON (Shown when checked in) */
            <button
              type="button"
              onClick={handleCheckOut}
              disabled={actionLoading}
              className="w-full group relative inline-flex items-center justify-center gap-3 py-5 px-8 rounded-3xl font-extrabold text-lg bg-gradient-to-r from-rose-600 via-rose-500 to-amber-600 hover:from-rose-500 hover:to-amber-500 active:scale-98 disabled:opacity-50 text-white shadow-2xl shadow-rose-950/80 transition-all cursor-pointer border border-rose-400/30"
            >
              <div className="p-2 rounded-2xl bg-white/10 group-hover:scale-110 transition-transform">
                <LogOut className="w-7 h-7 text-rose-100" />
              </div>
              <div className="text-left">
                <div className="leading-tight">{actionLoading ? 'Checking out…' : 'Check Out'}</div>
                <div className="text-[11px] font-normal text-rose-100/80 flex items-center gap-1">
                  <span>Record departure & open Odoo</span>
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Sub-note */}
        <div className="mt-8 text-xs text-slate-500 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
          <span>Session protection active · Logout & power-off are monitored</span>
        </div>
      </main>

      {/* Bottom Footer */}
      <footer className="w-full px-8 py-4 flex items-center justify-between text-[11px] text-slate-600 font-mono z-10">
        <span>Attendance Assistant</span>
        <span>v{appInfo?.version || '1.0.0'}</span>
      </footer>

      {/* ── MODAL 1: TODAY'S ACTIVITY LOGS ── */}
      {showLogsModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-700/80 p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-sky-500/15 text-sky-400">
                  <ListOrdered className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Today's Activity Logs</h2>
                  <p className="text-xs text-slate-400">{currentTime.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowLogsModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto my-4 rounded-2xl border border-slate-800 bg-slate-950/50">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 font-semibold uppercase text-[10px] tracking-wider">
                    <th className="py-2.5 px-4 w-10">#</th>
                    <th className="py-2.5 px-4">Event</th>
                    <th className="py-2.5 px-4 text-right">Recorded Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-500 italic">
                        No check-in or check-out recorded yet today.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log, idx) => {
                      const isCheckInItem = log.type === 'check_in';
                      return (
                        <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">{idx + 1}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold text-xs border ${
                                isCheckInItem
                                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                              }`}
                            >
                              {isCheckInItem ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                              {isCheckInItem ? 'Check In' : 'Check Out'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-200">
                            {formatTimeStr(log.timestamp)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowLogsModal(false)}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: SETTINGS ── */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-700/80 p-6 shadow-2xl flex flex-col max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400">
                  <SettingsIcon className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Application Settings</h2>
                  <p className="text-xs text-slate-400">Customize attendance URL & session behavior</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {settingsMsg && (
              <div
                className={`mt-4 p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${
                  settingsMsg.isError
                    ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{settingsMsg.text}</span>
              </div>
            )}

            <div className="space-y-5 my-5">
              {/* Odoo Attendance URL */}
              <div className="rounded-2xl bg-slate-950/60 border border-slate-800 p-4">
                <label htmlFor="odoo-url-input" className="block text-xs font-bold text-slate-200 mb-1">
                  Attendance URL
                </label>
                <p className="text-[11px] text-slate-400 mb-2.5">
                  Opened in browser when you check in or check out.
                </p>
                <div className="flex gap-2">
                  <input
                    id="odoo-url-input"
                    type="url"
                    value={settingsUrl}
                    onChange={e => setSettingsUrl(e.target.value)}
                    placeholder="https://www.odoo.com/odoo"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-amber-500"
                  />
                  {settingsUrl && (
                    <a
                      href={settingsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer"
                      title="Test URL"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>

              {/* Session Inactivity Threshold */}
              <div className="rounded-2xl bg-slate-950/60 border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="modal-threshold-input" className="text-xs font-bold text-slate-200">
                    Session Inactivity Threshold
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="modal-threshold-input"
                      type="number"
                      min="1"
                      max="120"
                      value={settingsThreshold}
                      onChange={e => setSettingsThreshold(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-16 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-xs text-center text-white font-mono focus:outline-none focus:border-amber-500"
                    />
                    <span className="text-xs text-slate-400 font-medium">min</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed mt-2">
                  If you check out but continue using your computer, TimeCheck will remind you again upon logout once this threshold has elapsed.
                </p>
              </div>

              {/* Launch on Startup */}
              <div className="rounded-2xl bg-slate-950/60 border border-slate-800 p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-200">Launch on System Startup</h3>
                  <p className="text-[11px] text-slate-400">Opens full-screen check-in screen automatically when you log in</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsAutostart(!settingsAutostart)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    settingsAutostart ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                  aria-label="Toggle autostart"
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      settingsAutostart ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white shadow-lg transition-all cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingSettings ? 'Saving…' : 'Save Settings'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 3: SHUTDOWN / LOGOUT CHECKOUT PROMPT ── */}
      {shutdownAction && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-4 animate-slide-up">
          <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-rose-500/40 p-7 shadow-2xl flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 shadow-inner">
              <LogOut className="w-7 h-7 animate-pulse-subtle" />
            </div>

            <h2 className="text-xl font-bold tracking-tight text-white mb-2">
              Did you check out in Odoo?
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed mb-6">
              You are about to {shutdownAction === 'logout' ? 'log out' : shutdownAction === 'reboot' ? 'restart' : 'power off'}. No recent check-out was recorded.
            </p>

            <div className="flex flex-col gap-2.5 w-full">
              <button
                type="button"
                onClick={handleShutdownCheckOut}
                disabled={actionLoading}
                className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-bold text-sm bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 active:scale-98 disabled:opacity-50 text-white shadow-xl shadow-rose-950/60 transition-all cursor-pointer border border-rose-400/30"
              >
                <LogOut className="w-4 h-4 shrink-0 text-rose-200" />
                <span>{actionLoading ? 'Opening Odoo…' : 'Check Out in Odoo'}</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-70 ml-0.5" />
              </button>

              <div className="flex gap-2 w-full">
                <button
                  type="button"
                  onClick={handleShutdownCancel}
                  disabled={actionLoading}
                  className="flex-1 inline-flex items-center justify-center py-2.5 px-3 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 active:scale-98 disabled:opacity-50 text-slate-200 border border-slate-700 transition-all cursor-pointer"
                >
                  <span>Stay Logged In</span>
                </button>

                <button
                  type="button"
                  onClick={handleShutdownSkip}
                  disabled={actionLoading}
                  className="inline-flex items-center justify-center py-2.5 px-3 rounded-xl font-medium text-xs bg-slate-900 hover:bg-slate-800 active:scale-98 disabled:opacity-50 text-slate-400 hover:text-slate-300 border border-slate-800 transition-all cursor-pointer"
                >
                  <span>Skip & Log Out</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
