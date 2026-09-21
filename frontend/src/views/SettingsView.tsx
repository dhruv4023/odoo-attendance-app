import React, { useState, useEffect } from 'react';
import * as AppService from '../../bindings/time-check/appservice.js';
import { Settings, AppInfo } from '../types.js';
import {
  ChevronLeft,
  Link,
  Laptop,
  Clock,
  Save,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Sparkles
} from 'lucide-react';

interface SettingsViewProps {
  onBack: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onBack }) => {
  const [url, setUrl] = useState('https://www.odoo.com/odoo');
  const [autostart, setAutostart] = useState(true);
  const [logThresholdMinutes, setLogThresholdMinutes] = useState(3);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const setts: Settings = await AppService.GetSettings();
        if (setts?.url) {
          setUrl(setts.url);
        }
        if (setts?.autostart !== undefined) {
          setAutostart(Boolean(setts.autostart));
        }
        if (setts?.log_threshold_minutes !== undefined) {
          setLogThresholdMinutes(setts.log_threshold_minutes);
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

    if (url && !validateURL(url)) {
      newErrors.url = 'Must be a valid http or https URL';
    }

    if (isNaN(logThresholdMinutes) || logThresholdMinutes < 1) {
      newErrors.threshold = 'Threshold must be at least 1 minute';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      const currentSettings = await AppService.GetSettings();
      await AppService.SaveSettings({
        ...currentSettings,
        url: url.trim(),
        autostart,
        log_threshold_minutes: Number(logThresholdMinutes) || 3,
      });
      showMsg('Settings saved successfully!');
    } catch (e: any) {
      showMsg(e?.message || 'Failed to save settings', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 select-none">
      {/* Header */}
      <header className="px-5 py-4 border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-md flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Back to dashboard"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">Settings</h1>
            <p className="text-[11px] text-slate-400">Configure attendance URL & checkout behavior</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 py-1.5 px-3.5 rounded-xl font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white shadow-md shadow-emerald-950/40 transition-all cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{saving ? 'Saving…' : 'Save'}</span>
        </button>
      </header>

      {/* Message Toast */}
      {message && (
        <div
          className={`mx-5 mt-4 p-3 rounded-xl text-xs font-medium flex items-center gap-2 border animate-slide-up ${
            message.isError
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {message.isError ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Section 1: Attendance URL */}
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-sky-500/15 text-sky-400">
              <Link className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Attendance URL</h2>
              <p className="text-[11px] text-slate-400">Opened when you click Check In or Check Out</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://www.odoo.com/odoo"
                className="flex-1 bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 font-mono transition-colors"
              />
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors inline-flex items-center justify-center cursor-pointer"
                  title="Open URL in browser"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
            {errors.url && <p className="text-[11px] text-rose-400">{errors.url}</p>}
          </div>
        </div>

        {/* Section 2: Session Inactivity Threshold for Checkout */}
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Session Inactivity Threshold</h2>
              <p className="text-[11px] text-slate-400">Re-prompt if PC is used after check-out</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="threshold-input" className="text-xs text-slate-300 flex-1">
                Threshold Duration (minutes)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="threshold-input"
                  type="number"
                  min="1"
                  max="120"
                  value={logThresholdMinutes}
                  onChange={e => setLogThresholdMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-20 bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-center text-white focus:outline-none focus:border-amber-500 font-mono"
                />
                <span className="text-xs text-slate-400">min</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 bg-slate-950/40 rounded-xl p-3 border border-slate-800/50 leading-relaxed">
              If you check out but continue using your computer, TimeCheck will prompt you for check-out again when logging out or shutting down if more than{' '}
              <strong className="text-slate-200">{logThresholdMinutes} minutes</strong> have elapsed since your last checkout.
            </p>
            {errors.threshold && <p className="text-[11px] text-rose-400">{errors.threshold}</p>}
          </div>
        </div>

        {/* Section 3: System Startup & Autostart */}
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400">
                <Laptop className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Launch on System Startup</h2>
                <p className="text-[11px] text-slate-400">Opens check-in screen automatically when you log in</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAutostart(!autostart)}
              className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                autostart ? 'bg-emerald-600' : 'bg-slate-700'
              }`}
              aria-label="Toggle autostart"
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  autostart ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Section 4: App Info */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 px-2 pt-2">
          <span>TimeCheck Attendance</span>
          <span>
            v{appInfo?.version || '1.0.0'}
            {appInfo?.build_time ? ` (${appInfo.build_time.split(' ')[0]})` : ''}
          </span>
        </div>
      </div>
    </div>
  );
};
