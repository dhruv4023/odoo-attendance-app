import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Events } from '@wailsio/runtime';
import * as AppService from '../../bindings/odoo-attendance-app/appservice.js';
import { Settings as SettingsModel } from '../../bindings/odoo-attendance-app/internal/schedule/models.js';
import { DailyStatus, Settings, AppInfo, OdooStatus } from '../types.js';
import odooLogo from '../assets/images/odoo_o.png';
import {
  CheckCircle2,
  LogOut,
  LogIn,
  Settings as SettingsIcon,
  ListOrdered,
  Sun,
  Moon,
  Calendar,
  Clock,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  X,
  RefreshCw,
  User,
  Save,
  KeyRound,
  Globe,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Timer
} from 'lucide-react';

interface MainViewProps {
  status: DailyStatus | null;
  onRefresh: () => void;
}

export const MainView: React.FC<MainViewProps> = ({
  status,
  onRefresh,
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [settings, setSettings] = useState<Settings | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [odooStatus, setOdooStatus] = useState<OdooStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError?: boolean } | null>(null);

  // Modals
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Settings form state inside modal
  const [settingsUrl, setSettingsUrl] = useState('');
  const [settingsApiKey, setSettingsApiKey] = useState('');
  const [settingsOdooSyncEnabled, setSettingsOdooSyncEnabled] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [settingsAutostart, setSettingsAutostart] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  // Test connection state
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; employee?: string } | null>(null);

  // Live clock ticker
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Load Settings, Odoo Status, and AppInfo
  const loadData = useCallback(async () => {
    try {
      const [setts, info, odooSt] = await Promise.all([
        AppService.GetSettings(),
        typeof AppService.GetAppInfo === 'function' ? AppService.GetAppInfo() : Promise.resolve(null),
        typeof AppService.GetOdooStatus === 'function' ? AppService.GetOdooStatus().catch(() => null) : Promise.resolve(null),
      ]);
      if (setts) {
        setSettings(setts);
        if (setts.url) setSettingsUrl(setts.url);
        if (setts.api_key) setSettingsApiKey(setts.api_key);
        if (setts.odoo_sync_enabled !== undefined) setSettingsOdooSyncEnabled(setts.odoo_sync_enabled);
        if (setts.autostart !== undefined) setSettingsAutostart(setts.autostart);
      }
      if (info) setAppInfo(info);
      if (odooSt) setOdooStatus(odooSt);
    } catch (e) {
      console.warn('loadData error:', e);
    }
  }, []);

  useEffect(() => {
    loadData();

    // Listen for Odoo status changes pushed from backend events
    Events.On('odoo-status-changed', (ev: any) => {
      const data = ev?.data ?? ev;
      if (data) {
        setOdooStatus(data);
      }
    });
  }, [loadData]);

  const showToast = (text: string, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage(null), 4000);
  };

  const formatOdooErrorMessage = (err: any): string => {
    if (!err) return 'Unknown error occurred';

    let raw = '';
    if (typeof err === 'string') {
      raw = err;
    } else if (err instanceof Error || (typeof err === 'object' && err.message)) {
      raw = err.message;
    } else {
      try {
        raw = JSON.stringify(err);
      } catch {
        raw = String(err);
      }
    }

    raw = raw.trim();

    // Extract status code if present (e.g. "odoo api error (401): ...")
    let statusCode = '';
    const statusMatch = raw.match(/\((\d{3})\)/);
    if (statusMatch) {
      statusCode = statusMatch[1];
    }

    // Check if there is JSON inside the string (e.g. after "odoo api error (401): ")
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      const jsonSubstr = raw.substring(jsonStart, jsonEnd + 1);
      try {
        const parsed = JSON.parse(jsonSubstr);

        // Check common Odoo / Werkzeug fields
        let msg = '';
        if (parsed.message && typeof parsed.message === 'string') {
          msg = parsed.message;
        } else if (parsed.error_description && typeof parsed.error_description === 'string') {
          msg = parsed.error_description;
        } else if (parsed.error && typeof parsed.error === 'string') {
          msg = parsed.error;
        } else if (parsed.error && typeof parsed.error === 'object') {
          if (parsed.error.data?.message && typeof parsed.error.data.message === 'string') {
            msg = parsed.error.data.message;
          } else if (parsed.error.message && typeof parsed.error.message === 'string') {
            msg = parsed.error.message;
          }
        } else if (Array.isArray(parsed.arguments) && parsed.arguments.length > 0) {
          if (typeof parsed.arguments[0] === 'string') {
            msg = parsed.arguments[0];
          }
        }

        if (msg) {
          // Strip python / werkzeug prefixes if present (e.g. "401 Unauthorized: Invalid apikey" -> "Invalid apikey")
          if (msg.includes(': ')) {
            const parts = msg.split(': ');
            const candidate = parts[parts.length - 1].trim();
            if (candidate && !candidate.includes('\n')) {
              msg = candidate;
            }
          }
          return statusCode ? `${msg} (${statusCode})` : msg;
        }
      } catch {
        // Fall through
      }
    }

    // If HTML
    if (raw.toLowerCase().includes('<!doctype') || raw.toLowerCase().includes('<html')) {
      if (statusCode === '401') return 'Invalid API key or unauthorized (401)';
      if (statusCode === '403') return 'Access forbidden: check permissions (403)';
      if (statusCode === '404') return 'Odoo endpoint or database not found (404)';
      if (statusCode === '502' || statusCode === '503' || statusCode === '504') return `Odoo server unavailable (${statusCode})`;
      return statusCode ? `Server returned HTTP ${statusCode}` : 'Server connection failed';
    }

    // Clean standard prefixes
    const cleaned = raw
      .replace(/^Error:\s*/i, '')
      .replace(/^odoo api error \(\d+\):\s*/i, '')
      .replace(/^odoo:\s*/i, '')
      .trim();

    if (cleaned.startsWith('{') || cleaned.includes('Traceback (most recent call last)')) {
      if (statusCode === '401') return 'Invalid API key or unauthorized (401)';
      if (statusCode === '403') return 'Access denied (403)';
      if (statusCode === '404') return 'Odoo endpoint not found (404)';
      if (statusCode) return `Odoo error (${statusCode})`;
      return 'Odoo request failed';
    }

    return statusCode && !cleaned.includes(statusCode) ? `${cleaned} (${statusCode})` : cleaned;
  };

  // Manual Odoo sync trigger
  const handleManualSync = async () => {
    if (isSyncing || settings?.odoo_sync_enabled === false) return;
    setIsSyncing(true);
    try {
      const st = await AppService.SyncOdooStatus();
      if (st && st.connected) {
        setOdooStatus(st);
        showToast(`Synced with Odoo: ${st.employee_name || 'Success'}`);
      } else if (st && st.error_message) {
        showToast(`Sync failed: ${formatOdooErrorMessage(st.error_message)}`, true);
      }
      onRefresh();
    } catch (e: any) {
      showToast(`Sync failed: ${formatOdooErrorMessage(e)}`, true);
    } finally {
      setIsSyncing(false);
    }
  };

  const isLiveSyncConfigured = Boolean(settings?.odoo_sync_enabled);

  const logs = useMemo(() => status?.logs ?? [], [status?.logs]);
  const lastLog = useMemo(() => (logs.length > 0 ? logs[logs.length - 1] : null), [logs]);
  const lastInLog = useMemo(() => logs.slice().reverse().find(l => l.type === 'check_in'), [logs]);
  const lastOutLog = useMemo(() => logs.slice().reverse().find(l => l.type === 'check_out'), [logs]);

  const isCheckedIn = useMemo(() => {
    if (isLiveSyncConfigured) {
      return Boolean(odooStatus?.attendance_state === 'checked_in');
    }
    return Boolean(lastLog ? lastLog.type === 'check_in' : status?.checked_in);
  }, [isLiveSyncConfigured, odooStatus?.attendance_state, lastLog, status?.checked_in]);

  const employeeName = isLiveSyncConfigured
    ? (odooStatus?.employee_name || settings?.employee_name || '')
    : (status?.employee_name || '');

  const parseTimestampMs = (val?: any): number | null => {
    if (!val) return null;
    try {
      if (typeof val === 'string') {
        if (val.length === 19 && val[10] === ' ') {
          const d = new Date(val.replace(' ', 'T') + 'Z').getTime();
          return isNaN(d) ? null : d;
        }
        const d = new Date(val).getTime();
        return isNaN(d) ? null : d;
      }
      if (val instanceof Date) {
        return isNaN(val.getTime()) ? null : val.getTime();
      }
      const d = new Date(String(val)).getTime();
      return isNaN(d) ? null : d;
    } catch {
      return null;
    }
  };

  const isSameCalendarDay = (d1: Date, d2: Date) => {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  const formatTimeStr = (iso?: any) => {
    if (!iso) return '';
    try {
      const ms = parseTimestampMs(iso);
      if (!ms) return String(iso);
      const d = new Date(ms);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return String(iso);
    }
  };

  const formatDateTimeStr = (iso?: any) => {
    if (!iso) return '';
    try {
      const ms = parseTimestampMs(iso);
      if (!ms) return String(iso);
      const d = new Date(ms);
      const datePart = d.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const timePart = d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      return `${datePart}, ${timePart}`;
    } catch {
      return String(iso);
    }
  };

  // Determine last check in / out time
  const lastEventInfo = useMemo(() => {
    // If live sync is configured, show status fetched strictly from Odoo
    if (isLiveSyncConfigured) {
      if (!odooStatus) return null;

      if (odooStatus.attendance_state === 'checked_in' && odooStatus.last_check_in) {
        const time = odooStatus.last_check_in;
        const ms = parseTimestampMs(time);
        if (ms && isSameCalendarDay(new Date(ms), currentTime)) {
          return {
            type: 'check_in' as const,
            timeStr: formatTimeStr(time),
            dateTimeStr: formatDateTimeStr(time),
            label: 'Last Check In Time',
          };
        }
      }
      if (odooStatus.attendance_state === 'checked_out' && odooStatus.last_check_out) {
        const time = odooStatus.last_check_out;
        const ms = parseTimestampMs(time);
        if (ms && isSameCalendarDay(new Date(ms), currentTime)) {
          return {
            type: 'check_out' as const,
            timeStr: formatTimeStr(time),
            dateTimeStr: formatDateTimeStr(time),
            label: 'Last Check Out Time',
          };
        }
      }
      if (odooStatus.last_check_out) {
        const ms = parseTimestampMs(odooStatus.last_check_out);
        if (ms && isSameCalendarDay(new Date(ms), currentTime)) {
          return {
            type: 'check_out' as const,
            timeStr: formatTimeStr(odooStatus.last_check_out),
            dateTimeStr: formatDateTimeStr(odooStatus.last_check_out),
            label: 'Last Check Out Time',
          };
        }
      }
      if (odooStatus.last_check_in) {
        const ms = parseTimestampMs(odooStatus.last_check_in);
        if (ms && isSameCalendarDay(new Date(ms), currentTime)) {
          return {
            type: 'check_in' as const,
            timeStr: formatTimeStr(odooStatus.last_check_in),
            dateTimeStr: formatDateTimeStr(odooStatus.last_check_in),
            label: 'Last Check In Time',
          };
        }
      }
      return null;
    }

    // Otherwise show as per last log recorded locally
    if (lastLog) {
      const isCheckIn = lastLog.type === 'check_in';
      return {
        type: isCheckIn ? ('check_in' as const) : ('check_out' as const),
        timeStr: formatTimeStr(lastLog.timestamp),
        dateTimeStr: formatDateTimeStr(lastLog.timestamp),
        label: isCheckIn ? 'Last Check In Time' : 'Last Check Out Time',
      };
    }

    return null;
  }, [isLiveSyncConfigured, odooStatus, lastLog, currentTime]);

  // Detailed working duration for hero timer
  const workingDuration = useMemo(() => {
    if (isLiveSyncConfigured) {
      if (isCheckedIn) {
        const startMs = parseTimestampMs(odooStatus?.last_check_in);
        if (!startMs) return null;

        const diffMs = Math.max(0, currentTime.getTime() - startMs);
        const totalSecs = Math.floor(diffMs / 1000);
        const hrs = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;
        return {
          hours: hrs,
          minutes: mins,
          seconds: secs,
          hoursStr: String(hrs).padStart(2, '0'),
          minsStr: String(mins).padStart(2, '0'),
          secsStr: String(secs).padStart(2, '0'),
          formatted: `${hrs}h ${mins}m ${secs}s`,
          label: 'Active Working Duration',
          isActive: true,
        };
      }

      // When Checked Out in Live Sync: Calculate today's worked duration strictly from Odoo
      let totalSecs = 0;
      if (odooStatus?.hours_today && odooStatus.hours_today > 0) {
        totalSecs = Math.floor(odooStatus.hours_today * 3600);
      } else if (odooStatus?.last_check_in && odooStatus?.last_check_out) {
        const inMs = parseTimestampMs(odooStatus.last_check_in);
        const outMs = parseTimestampMs(odooStatus.last_check_out);
        if (inMs && outMs && outMs >= inMs) {
          const outDate = new Date(outMs);
          if (isSameCalendarDay(outDate, currentTime)) {
            totalSecs = Math.floor((outMs - inMs) / 1000);
          }
        }
      }

      if (totalSecs > 0) {
        const hrs = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;
        return {
          hours: hrs,
          minutes: mins,
          seconds: secs,
          hoursStr: String(hrs).padStart(2, '0'),
          minsStr: String(mins).padStart(2, '0'),
          secsStr: String(secs).padStart(2, '0'),
          formatted: `${hrs}h ${mins}m`,
          label: "Today's Worked Duration",
          isActive: false,
        };
      }

      return null;
    }

    // Local mode (isLiveSyncConfigured is false)
    if (isCheckedIn) {
      const startMs = parseTimestampMs(lastInLog?.timestamp);
      if (!startMs) return null;

      const diffMs = Math.max(0, currentTime.getTime() - startMs);
      const totalSecs = Math.floor(diffMs / 1000);
      const hrs = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      const secs = totalSecs % 60;
      return {
        hours: hrs,
        minutes: mins,
        seconds: secs,
        hoursStr: String(hrs).padStart(2, '0'),
        minsStr: String(mins).padStart(2, '0'),
        secsStr: String(secs).padStart(2, '0'),
        formatted: `${hrs}h ${mins}m ${secs}s`,
        label: 'Active Working Duration',
        isActive: true,
      };
    }

    // Local Checked Out: Calculate from local logs sum
    let sumMs = 0;
    let openInMs: number | null = null;
    for (const logItem of logs) {
      const itemMs = parseTimestampMs(logItem.timestamp);
      if (!itemMs) continue;
      const itemDate = new Date(itemMs);
      if (!isSameCalendarDay(itemDate, currentTime)) continue;

      if (logItem.type === 'check_in') {
        openInMs = itemMs;
      } else if (logItem.type === 'check_out' && openInMs !== null) {
        if (itemMs >= openInMs) {
          sumMs += itemMs - openInMs;
        }
        openInMs = null;
      }
    }
    if (sumMs > 0) {
      const totalSecs = Math.floor(sumMs / 1000);
      const hrs = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      const secs = totalSecs % 60;
      return {
        hours: hrs,
        minutes: mins,
        seconds: secs,
        hoursStr: String(hrs).padStart(2, '0'),
        minsStr: String(mins).padStart(2, '0'),
        secsStr: String(secs).padStart(2, '0'),
        formatted: `${hrs}h ${mins}m`,
        label: "Today's Worked Duration",
        isActive: false,
      };
    }

    return null;
  }, [isLiveSyncConfigured, isCheckedIn, odooStatus, lastInLog, logs, currentTime]);

  // Check In Handler - checks after 30 seconds
  const handleCheckIn = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const res = await AppService.CheckIn();
      if (res.ok) {
        showToast('Check-in initiated. Syncing status in 30s...');
        onRefresh();
      } else if (res.message) {
        showToast(res.message, true);
      }
    } catch (e) {
      showToast(String(e), true);
    } finally {
      setActionLoading(false);
    }
  };

  // Check Out Handler - checks after 30 seconds
  const handleCheckOut = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const res = await AppService.CheckOut();
      if (res.ok) {
        showToast('Check-out initiated. Syncing status in 30s...');
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

  // Test Odoo connection from Settings modal
  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      if (typeof AppService.TestOdooConnection === 'function') {
        const res: OdooStatus | null = await AppService.TestOdooConnection(settingsUrl.trim(), settingsApiKey.trim());
        if (res && res.connected) {
          setTestResult({
            success: true,
            message: `Connected! Logged in as User #${res.user_id}, Employee: ${res.employee_name} (#${res.employee_id})`,
            employee: res.employee_name,
          });
        } else {
          setTestResult({
            success: false,
            message: formatOdooErrorMessage(res?.error_message || 'Connection failed. Please check URL and API Key.'),
          });
        }
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        message: formatOdooErrorMessage(e),
      });
    } finally {
      setTestingConn(false);
    }
  };

  // Save Settings from modal
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      await AppService.SaveSettings(new SettingsModel({
        url: settingsUrl.trim(),
        api_key: settingsApiKey.trim(),
        odoo_sync_enabled: settingsOdooSyncEnabled,
        autostart: settingsAutostart,
        user_id: settings?.user_id,
        employee_id: settings?.employee_id,
        employee_name: settings?.employee_name,
      }));
      setSettingsMsg({ text: 'Settings saved successfully!' });
      await loadData();
      setTimeout(() => setShowSettingsModal(false), 1000);
    } catch (e: any) {
      setSettingsMsg({ text: formatOdooErrorMessage(e), isError: true });
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="relative w-screen h-screen bg-[#1c1722] text-[#f8f7f9] flex flex-col justify-between select-none overflow-hidden font-sans">
      {/* Ambient Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-[38rem] h-[38rem] bg-[#6b3e66]/25 rounded-full blur-[130px] pointer-events-none animate-pulse-subtle" />
      <div className="absolute bottom-1/4 right-1/4 w-[38rem] h-[38rem] bg-[#7b4775]/20 rounded-full blur-[130px] pointer-events-none" />

      {/* ── TOP BAR: App branding, Employee Badge & Actions ── */}
      <header className="w-full px-8 py-5 flex items-center justify-between z-20 border-b border-[#3d3248]/40 bg-[#1c1722]/60 backdrop-blur-md">
        {/* Top-Left: Logo & Employee */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 mr-2">
            <div className="w-9 h-9 rounded-xl bg-[#6b3e66]/40 border border-[#6b3e66]/60 flex items-center justify-center shadow-sm p-1.5 overflow-hidden">
              <img src={odooLogo} alt="Odoo Logo" className="w-full h-full object-contain" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-white block">
                Attendance Reminder
              </span>
              {employeeName && (
                <span className="text-[11px] text-[#a69eb0] flex items-center gap-1">
                  <User className="w-3 h-3 text-[#875A7B]" />
                  <span>{employeeName}</span>
                </span>
              )}
            </div>
          </div>

          {/* Odoo Live Sync Indicator Badge */}
          <div
            className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#251f2e] border border-[#3d3248] text-[11px] font-medium text-[#cfc9d6]"
            title={odooStatus?.error_message ? formatOdooErrorMessage(odooStatus.error_message) : undefined}
          >
            <span
              className={`w-2 h-2 rounded-full ${isLiveSyncConfigured ? 'bg-[#00A09D] animate-pulse' : 'bg-[#e05666]'
                }`}
            />
            <span>
              {isLiveSyncConfigured
                ? 'Connected'
                : settings?.odoo_sync_enabled && odooStatus?.error_message
                  ? `Error: ${formatOdooErrorMessage(odooStatus.error_message)}`
                  : 'Offline / Local'}
            </span>
          </div>
        </div>

        {/* Top-Right: Actions */}
        <div className="flex items-center gap-2.5">
          {/* Refresh / Sync Button */}
          {isLiveSyncConfigured && (
            <button
              type="button"
              onClick={handleManualSync}
              disabled={isSyncing}
              className="p-2.5 rounded-xl border border-[#3d3248] bg-[#251f2e]/90 text-[#cfc9d6] hover:text-white hover:bg-[#6b3e66]/30 hover:border-[#6b3e66]/50 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
              title="Sync Status with Odoo"
            >
              <RefreshCw className={`w-4 h-4 text-white ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">{isSyncing ? 'Syncing…' : 'Sync'}</span>
            </button>
          )}

          {/* Logs Icon Button - ONLY shown when live status sync is NOT configured */}
          {!isLiveSyncConfigured && (
            <button
              type="button"
              onClick={() => setShowLogsModal(true)}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center gap-2 text-xs font-semibold ${showLogsModal
                ? 'bg-[#6b3e66] border-[#6b3e66] text-white shadow-md'
                : 'bg-[#251f2e]/90 border-[#3d3248] text-[#cfc9d6] hover:text-white hover:bg-[#6b3e66]/30 hover:border-[#6b3e66]/50'
                }`}
              title="View Attendance Logs"
            >
              <ListOrdered className="w-4 h-4 text-white" />
              <span className="hidden md:inline">Logs</span>
              {logs.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#7b4775] text-white border border-[#8b5185]">
                  {logs.length}
                </span>
              )}
            </button>
          )}

          {/* Settings Icon Button */}
          <button
            type="button"
            onClick={() => setShowSettingsModal(true)}
            className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center gap-2 text-xs font-semibold ${showSettingsModal
              ? 'bg-[#6b3e66] border-[#6b3e66] text-white shadow-md'
              : 'bg-[#251f2e]/90 border-[#3d3248] text-[#cfc9d6] hover:text-white hover:bg-[#6b3e66]/30 hover:border-[#6b3e66]/50'
              }`}
            title="Configure Settings"
          >
            <SettingsIcon className="w-4 h-4 text-white" />
            <span className="hidden md:inline">Settings</span>
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {message && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 animate-slide-up">
          <div
            className={`px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center gap-2 border shadow-2xl backdrop-blur-md ${message.isError
              ? 'bg-[#3f1925]/95 border-[#d9485e]/50 text-[#fca5a5]'
              : 'bg-[#132c2c]/95 border-[#00A09D]/50 text-[#a7f3d0]'
              }`}
          >
            {message.isError ? (
              <AlertCircle className="w-4 h-4 text-[#e05666]" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-[#00A09D]" />
            )}
            <span>{message.text}</span>
          </div>
        </div>
      )}

      {/* ── CENTER HERO: Small Date & Live Clock + BIG Last Check In / Check Out Display ── */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 z-10 text-center max-w-2xl mx-auto w-full">
        {/* 1. Date and Current Live Time Header */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          {/* Today's Date */}
          <div className="px-4 py-2 rounded-full bg-[#251f2e]/90 border border-[#3d3248] text-sm font-medium text-[#cfc9d6] flex items-center gap-2 shadow-sm">
            <Calendar className="w-4 h-4 text-[#875A7B]" />
            <span>
              {currentTime.toLocaleDateString([], {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>

          {/* Current Time */}
          <div className="px-4 py-2 rounded-full bg-[#251f2e]/90 border border-[#3d3248] text-sm font-mono font-medium text-[#a69eb0] flex items-center gap-2 shadow-sm">
            <Clock className="w-4 h-4 text-[#00A09D]" />
            <span>
              {currentTime.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </div>
        </div>

        {/* 2. BIG DURATION DISPLAY: Active / Total Worked Duration Hero Card */}
        <div className="mb-8 w-full max-w-lg">
          <div
            className={`relative overflow-hidden p-6 sm:p-8 rounded-3xl border backdrop-blur-xl transition-all duration-300 shadow-2xl ${isCheckedIn
                ? 'bg-gradient-to-b from-[#6b3e66]/35 to-[#251f2e]/90 border-[#6b3e66]/60 shadow-[0_12px_40px_rgba(107,62,102,0.3)]'
                : 'bg-gradient-to-b from-[#2b2336]/90 to-[#1f1927]/90 border-[#3d3248] shadow-[0_12px_40px_rgba(0,0,0,0.4)]'
              }`}
          >
            {/* Ambient background glow */}
            <div
              className={`absolute -top-16 -right-16 w-44 h-44 rounded-full blur-3xl pointer-events-none transition-all duration-500 ${isCheckedIn ? 'bg-[#00A09D]/15' : 'bg-[#6b3e66]/10'
                }`}
            />
            <div
              className={`absolute -bottom-16 -left-16 w-44 h-44 rounded-full blur-3xl pointer-events-none transition-all duration-500 ${isCheckedIn ? 'bg-[#6b3e66]/25' : 'bg-[#3d3248]/20'
                }`}
            />

            {/* Top Badges: Status & Session Pill */}
            <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 mb-3">
              <div
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wide border shadow-sm transition-colors ${isCheckedIn
                    ? 'bg-[#00A09D]/15 text-[#34d399] border-[#00A09D]/30'
                    : lastEventInfo?.type === 'check_out'
                      ? 'bg-[#e05666]/15 text-[#f87171] border-[#e05666]/30'
                      : 'bg-[#2b2435] text-[#a69eb0] border-[#3d3248]'
                  }`}
              >
                {isCheckedIn ? (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#34d399] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#34d399]"></span>
                  </span>
                ) : (
                  <Timer className="w-3.5 h-3.5 text-[#a69eb0]" />
                )}
                <span>
                  {workingDuration?.label || (isCheckedIn ? 'Active Working Duration' : 'Work Duration Today')}
                </span>
              </div>
            </div>

            {/* BIG DURATION HERO DISPLAY */}
            <div className="relative z-10 my-2">
              {workingDuration ? (
                <div className="flex items-baseline justify-center gap-1 sm:gap-1.5 font-mono font-black text-white text-5xl sm:text-6xl md:text-7xl tracking-tight drop-shadow-md py-1">
                  <span>{workingDuration.hoursStr}</span>
                  <span className="text-xl sm:text-2xl md:text-3xl text-[#cfc9d6]/70 font-sans font-medium mr-1">h</span>
                  <span className="text-white/30 text-3xl sm:text-4xl md:text-5xl font-sans">:</span>
                  <span>{workingDuration.minsStr}</span>
                  <span className="text-xl sm:text-2xl md:text-3xl text-[#cfc9d6]/70 font-sans font-medium mr-1">m</span>
                  <span className="text-white/30 text-3xl sm:text-4xl md:text-5xl font-sans">:</span>
                  <span className="text-[#00A09D]">{workingDuration.secsStr}</span>
                  <span className="text-lg sm:text-xl md:text-2xl text-[#00A09D]/80 font-sans font-medium">s</span>
                </div>
              ) : (
                <div className="py-2 flex flex-col items-center justify-center">
                  <div className="font-mono font-black text-4xl sm:text-5xl text-[#7e748c] tracking-tight">
                    00h 00m
                  </div>
                  <span className="text-xs text-[#6e647c] mt-1.5">No work duration recorded today</span>
                </div>
              )}
            </div>

            {/* Sub-Card: Last Check In / Check Out Timestamp */}
            <div className="relative z-10 mt-3 flex items-center justify-center">
              {lastEventInfo?.dateTimeStr || lastEventInfo?.timeStr ? (
                <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-[#cfc9d6] shadow-sm backdrop-blur-sm">
                  {lastEventInfo.type === 'check_in' || isCheckedIn ? (
                    <LogIn className="w-4 h-4 text-[#00A09D]" />
                  ) : (
                    <LogOut className="w-4 h-4 text-[#e05666]" />
                  )}
                  <span>
                    {isCheckedIn ? 'Checked in at' : 'Checked out at'}{' '}
                    <strong className="text-white font-mono text-sm sm:text-base font-bold ml-1">
                      {lastEventInfo.dateTimeStr || lastEventInfo.timeStr}
                    </strong>
                  </span>
                </div>
              ) : (
                <div className="text-sm text-[#6e647c]">Ready for your next check-in</div>
              )}
            </div>

            {/* Bottom Employee Status Strip */}
            <div className="relative z-10 mt-5 pt-4 border-t border-[#3d3248]/60 flex items-center justify-center gap-2 text-xs">
              <div className="p-1 rounded-full bg-[#3d3248]/50 text-[#cfc9d6]">
                <User className="w-3 h-3" />
              </div>
              <span className="text-[#cfc9d6] font-medium">
                {employeeName || 'Local User'}
              </span>
              <span className="text-[#6e647c]">•</span>
              <span
                className={`font-semibold ${isCheckedIn
                    ? 'text-[#34d399]'
                    : lastEventInfo?.type === 'check_out'
                      ? 'text-[#f87171]'
                      : 'text-[#8a8097]'
                  }`}
              >
                {isCheckedIn
                  ? 'Checked In'
                  : lastEventInfo?.type === 'check_out'
                    ? 'Checked Out'
                    : 'Not checked in'}
              </span>
            </div>
          </div>
        </div>

        {/* ── 3. THE PRIMARY ACTION BUTTON ── */}
        <div className="w-full max-w-md">
          {!isCheckedIn ? (
            /* CHECK IN BUTTON */
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={actionLoading}
              className="w-full group relative inline-flex items-center justify-center gap-3 py-4.5 px-8 rounded-3xl font-extrabold text-lg bg-[#6b3e66] hover:bg-[#7b4775] active:bg-[#8b5185] active:scale-98 disabled:opacity-50 text-white shadow-2xl shadow-[rgba(129,91,125,0.45)] transition-all cursor-pointer border border-[#6b3e66] hover:border-[#7b4775] active:border-[#8b5185] focus:outline-none focus:ring-4 focus:ring-[rgba(129,91,125,0.35)]"
            >
              <div className="p-2 rounded-2xl bg-white/15 group-hover:scale-110 transition-transform">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <div className="text-left">
                <div className="leading-tight">{actionLoading ? 'Checking in…' : 'Check In'}</div>
                <div className="text-[11px] font-normal text-white/90 flex items-center gap-1">
                  <span>Record attendance in Odoo</span>
                  <ExternalLink className="w-3 h-3 opacity-80" />
                </div>
              </div>
            </button>
          ) : (
            /* CHECK OUT BUTTON */
            <button
              type="button"
              onClick={handleCheckOut}
              disabled={actionLoading}
              className="w-full group relative inline-flex items-center justify-center gap-3 py-4.5 px-8 rounded-3xl font-extrabold text-lg bg-[#6b3e66] hover:bg-[#7b4775] active:bg-[#8b5185] active:scale-98 disabled:opacity-50 text-white shadow-2xl shadow-[rgba(129,91,125,0.45)] transition-all cursor-pointer border border-[#6b3e66] hover:border-[#7b4775] active:border-[#8b5185] focus:outline-none focus:ring-4 focus:ring-[rgba(129,91,125,0.35)]"
            >
              <div className="p-2 rounded-2xl bg-white/15 group-hover:scale-110 transition-transform">
                <LogOut className="w-6 h-6 text-white" />
              </div>
              <div className="text-left">
                <div className="leading-tight">{actionLoading ? 'Checking out…' : 'Check Out'}</div>
                <div className="text-[11px] font-normal text-white/90 flex items-center gap-1">
                  <span>Record departure in Odoo</span>
                  <ExternalLink className="w-3 h-3 opacity-80" />
                </div>
              </div>
            </button>
          )}
        </div>

        {/* Sub-note */}
        <div className="mt-6 text-xs text-[#8a8097] flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-[#714B67]" />
          <span>  Logout & power-off are monitored</span>
        </div>
      </main>

      {/* Bottom Footer */}
      <footer className="w-full px-8 py-4 flex items-center justify-between text-[11px] text-[#7e748c] font-mono z-10 border-t border-[#3d3248]/30">
        <span>Attendance Reminder</span>
        <span>v{appInfo?.version || '1.0.0'}</span>
      </footer>

      {/* ── MODAL 1: LOCAL ACTIVITY LOGS (ONLY IF LIVE SYNC NOT CONFIGURED) ── */}
      {!isLiveSyncConfigured && showLogsModal && (
        <div className="fixed inset-0 z-50 bg-[#141018]/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="relative w-full max-w-xl rounded-3xl bg-[#251f2e] border border-[#3d3248] p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-4 border-b border-[#3d3248]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#6b3e66]/30 text-white">
                  <ListOrdered className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Local Attendance Logs</h2>
                  <p className="text-xs text-[#a69eb0]">
                    {currentTime.toLocaleDateString([], {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowLogsModal(false)}
                className="p-1.5 rounded-xl text-[#a69eb0] hover:text-white hover:bg-[#342b3e] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto my-4 rounded-2xl border border-[#3d3248] bg-[#1a1520]">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#3d3248] bg-[#221b2b] text-[#a69eb0] font-semibold uppercase text-[10px] tracking-wider">
                    <th className="py-2.5 px-4 w-10">#</th>
                    <th className="py-2.5 px-4">Event</th>
                    <th className="py-2.5 px-4 text-right">Recorded Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#3d3248]/50">
                  {logs.length > 0 ? (
                    logs.map((log, idx) => {
                      const isCheckInItem = log.type === 'check_in';
                      return (
                        <tr key={idx} className="hover:bg-[#2e2638] transition-colors">
                          <td className="py-3 px-4 text-[#7e748c] font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-semibold text-xs border ${isCheckInItem
                                ? 'bg-[#6b3e66] text-white border-[#7b4775]'
                                : 'bg-[#7b4775] text-white border-[#8b5185]'
                                }`}
                            >
                              {isCheckInItem ? (
                                <Sun className="w-3.5 h-3.5" />
                              ) : (
                                <Moon className="w-3.5 h-3.5" />
                              )}
                              {isCheckInItem ? 'Check In' : 'Check Out'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[#f8f7f9]">
                            {formatTimeStr(log.timestamp)}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-[#7e748c] italic">
                        No check-in or check-out recorded yet today.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowLogsModal(false)}
                className="px-5 py-2 rounded-xl text-xs font-semibold bg-[#342b3e] hover:bg-[#3f344c] text-[#f8f7f9] transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL 2: APPLICATION & ODOO SETTINGS ── */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-[#141018]/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="relative w-full max-w-lg rounded-3xl bg-[#251f2e] border border-[#3d3248] p-6 shadow-2xl flex flex-col max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-[#3d3248]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#6b3e66]/30 text-white">
                  <SettingsIcon className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Application Settings</h2>
                  <p className="text-xs text-[#a69eb0]">Configure Odoo Server & Preferences</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="p-1.5 rounded-xl text-[#a69eb0] hover:text-white hover:bg-[#342b3e] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {settingsMsg && (
              <div
                className={`mt-4 p-3 rounded-xl text-xs font-semibold flex items-center gap-2 border ${settingsMsg.isError
                  ? 'bg-[#3f1925]/95 border-[#d9485e]/50 text-[#fca5a5]'
                  : 'bg-[#132c2c]/95 border-[#00A09D]/50 text-[#a7f3d0]'
                  }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{settingsMsg.text}</span>
              </div>
            )}

            <div className="space-y-4 my-5">
              {/* Odoo Live Sync Toggle */}
              <div className="rounded-2xl bg-[#1c1722]/80 border border-[#3d3248] p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-[#f8f7f9] flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-[#875A7B]" />
                    <span>Enable Odoo Live Sync</span>
                  </h3>
                  <p className="text-[11px] text-[#a69eb0]">
                    Synchronize check-in/check-out status with Odoo server via API
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsOdooSyncEnabled(!settingsOdooSyncEnabled)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${settingsOdooSyncEnabled ? 'bg-[#6b3e66]' : 'bg-[#342b3e]'
                    }`}
                  aria-label="Toggle Odoo sync"
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settingsOdooSyncEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                  />
                </button>
              </div>

              {settingsOdooSyncEnabled ? (
                <>
                  {/* Odoo API Key */}
                  <div className="rounded-2xl bg-[#1c1722]/80 border border-[#3d3248] p-4">
                    <label htmlFor="odoo-api-key" className="text-xs font-bold text-[#f8f7f9] mb-1 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-[#875A7B]" />
                      <span>Odoo API Key</span>
                    </label>
                    <p className="text-[11px] text-[#a69eb0] mb-2.5">
                      Your Odoo user API Key generated under User Preferences / Account Security.
                    </p>
                    <div className="relative">
                      <input
                        id="odoo-api-key"
                        type={showApiKey ? 'text' : 'password'}
                        value={settingsApiKey}
                        onChange={e => setSettingsApiKey(e.target.value)}
                        placeholder="Enter Odoo API key…"
                        className="w-full bg-[#251f2e] border border-[#3d3248] rounded-xl px-3.5 py-2 pr-10 text-xs text-white placeholder-[#7e748c] font-mono focus:outline-none focus:border-[#7b4775] focus:ring-2 focus:ring-[rgba(129,91,125,0.25)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#a69eb0] hover:text-white transition-colors cursor-pointer"
                      >
                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    {/* Test Connection Button & Result */}
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleTestConnection}
                        disabled={testingConn || !settingsUrl || !settingsApiKey}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#342b3e] hover:bg-[#3f344c] active:scale-95 disabled:opacity-50 text-white border border-[#4a3c57] transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${testingConn ? 'animate-spin' : ''}`} />
                        <span>{testingConn ? 'Testing…' : 'Test Connection'}</span>
                      </button>

                      {testResult && (
                        <div
                          className={`text-[11px] font-medium flex items-center gap-1 ${testResult.success ? 'text-[#a7f3d0]' : 'text-[#fca5a5]'
                            }`}
                        >
                          {testResult.success ? (
                            <CheckCircle className="w-3.5 h-3.5 text-[#00A09D]" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-[#e05666]" />
                          )}
                          <span>{testResult.message}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl bg-[#1c1722]/50 border border-[#3d3248]/50 p-3.5 text-xs text-[#a69eb0] italic">
                  Live Odoo synchronization is currently disabled. The app will record attendance locally on this device.
                </div>
              )}

              {/* Attendance Page Web URL */}
              <div className="rounded-2xl bg-[#1c1722]/80 border border-[#3d3248] p-4">
                <label htmlFor="odoo-url-input" className="block text-xs font-bold text-[#f8f7f9] mb-1">
                  The base URL of your Odoo instance
                </label>
                <p className="text-[11px] text-[#a69eb0] mb-2.5">
                  Opened in your web browser when you check in or check out.
                </p>
                <div className="flex gap-2">
                  <input
                    id="odoo-url-input"
                    type="url"
                    value={settingsUrl}
                    onChange={e => setSettingsUrl(e.target.value)}
                    placeholder="https://your-odoo-instance.com"
                    className="flex-1 bg-[#251f2e] border border-[#3d3248] rounded-xl px-3.5 py-2 text-xs text-white placeholder-[#7e748c] font-mono focus:outline-none focus:border-[#7b4775] focus:ring-2 focus:ring-[rgba(129,91,125,0.25)]"
                  />
                  {settingsUrl && (
                    <a
                      href={settingsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 rounded-xl bg-[#342b3e] hover:bg-[#3f344c] text-[#cfc9d6] flex items-center justify-center cursor-pointer"
                      title="Test URL"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>

              {/* Launch on Startup */}
              <div className="rounded-2xl bg-[#1c1722]/80 border border-[#3d3248] p-4 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-[#f8f7f9]">Launch on System Startup</h3>
                  <p className="text-[11px] text-[#a69eb0]">
                    Opens check-in screen automatically when you log in
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsAutostart(!settingsAutostart)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${settingsAutostart ? 'bg-[#6b3e66]' : 'bg-[#342b3e]'
                    }`}
                  aria-label="Toggle autostart"
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settingsAutostart ? 'translate-x-5' : 'translate-x-0'
                      }`}
                  />
                </button>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#3d3248]">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#342b3e] hover:bg-[#3f344c] text-[#cfc9d6] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold bg-[#6b3e66] hover:bg-[#7b4775] active:bg-[#8b5185] active:scale-95 disabled:opacity-50 text-white shadow-lg shadow-[rgba(129,91,125,0.4)] transition-all cursor-pointer border border-[#6b3e66] hover:border-[#7b4775] active:border-[#8b5185]"
              >
                <Save className="w-3.5 h-3.5 text-white" />
                <span>{savingSettings ? 'Saving…' : 'Save Settings'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
