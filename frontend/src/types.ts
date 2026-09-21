export type LogActionType = 'check_in' | 'check_out' | string;

export interface LogEntry {
  type: LogActionType;
  timestamp: string | Date;
}

export interface DailyStatus {
  date: string;
  checked_in: boolean;
  logs?: LogEntry[];
}

export interface DaySchedule {
  enabled: boolean;
  check_in: string; // "HH:MM"
  check_out: string; // "HH:MM"
}

export type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type ScheduleSettings = Record<DayKey, DaySchedule>;

export interface Settings {
  schedule: ScheduleSettings;
  url?: string;
  autostart: boolean;
  scheduler_enabled?: boolean;
  log_threshold_minutes?: number;
  check_out_window_before_minutes?: number;
  check_out_window_after_minutes?: number;
  snooze_duration_minutes?: number;
}


export interface NextReminder {
  at: Date | string;
  type: LogActionType | string;
}

export interface CheckResult {
  ok: boolean;
  message?: string;
}

export interface AppInfo {
  version: string;
  build_time: string;
  os?: string;
  arch?: string;
}
