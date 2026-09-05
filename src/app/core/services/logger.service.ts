import { Injectable, isDevMode } from '@angular/core';

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  context: string;
  message: string;
  details?: unknown;
  stack?: string;
}

@Injectable({
  providedIn: 'root',
})
export class LoggerService {
  private readonly maxStoredLogs = 50;
  private readonly logs: LogEntry[] = [];

  info(context: string, message: string, details?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      context,
      message,
      details,
    };
    this.addLog(entry);
    if (isDevMode()) {
      console.info(`[${entry.timestamp}] [INFO] [${context}] ${message}`, details ?? '');
    }
  }

  warn(context: string, message: string, details?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      context,
      message,
      details,
    };
    this.addLog(entry);
    console.warn(`[${entry.timestamp}] [WARN] [${context}] ${message}`, details ?? '');
  }

  error(context: string, message: string, error?: unknown): void {
    let stack: string | undefined;
    let details: unknown = error;

    if (error instanceof Error) {
      stack = error.stack;
      details = { message: error.message, name: error.name };
    } else if (typeof error === 'object' && error !== null) {
      details = error;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      context,
      message,
      details,
      stack,
    };

    this.addLog(entry);
    console.error(`[${entry.timestamp}] [ERROR] [${context}] ${message}`, details, stack ? `\n${stack}` : '');
  }

  private addLog(entry: LogEntry): void {
    this.logs.unshift(entry);
    if (this.logs.length > this.maxStoredLogs) {
      this.logs.pop();
    }
  }

  getRecentLogs(): readonly LogEntry[] {
    return this.logs;
  }
}
