export type LogActionType = 'check_in' | 'check_out' | string;

export interface LogEntry {
  type: LogActionType;
  timestamp: string | Date;
}

export interface DailyStatus {
  date: string;
  checked_in: boolean;
  logs?: LogEntry[];
  employee_name?: string;
  employee_id?: number;
  odoo_connected?: boolean;
}

export interface DaySchedule {
  enabled: boolean;
  check_in: string; // "HH:MM"
  check_out: string; // "HH:MM"
}

export type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type ScheduleSettings = Record<DayKey, DaySchedule>;

export interface Settings {
  url?: string;
  api_key?: string;
  odoo_sync_enabled?: boolean;
  autostart: boolean;
  log_threshold_minutes?: number;
  user_id?: number;
  employee_id?: number;
  employee_name?: string;
}

export interface OdooAttendanceRecord {
  id: number;
  check_in: any;
  check_out: any;
  worked_hours: number;
}

export interface OdooStatus {
  connected: boolean;
  employee_name: string;
  employee_id: number;
  user_id: number;
  attendance_state: 'checked_in' | 'checked_out' | string;
  last_check_in?: string;
  last_check_out?: string;
  hours_today?: number;
  recent_attendances?: OdooAttendanceRecord[];
  error_message?: string;
  server_url?: string;
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
