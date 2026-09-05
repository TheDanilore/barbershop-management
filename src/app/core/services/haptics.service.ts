import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class HapticsService {
  private isVibrationSupported(): boolean {
    return typeof navigator !== 'undefined' && 'vibrate' in navigator;
  }

  /**
   * Vibración suave para taps y cambios de pestaña (12ms)
   */
  lightTap(): void {
    if (this.isVibrationSupported()) {
      try {
        navigator.vibrate(12);
      } catch {
        // Ignorar
      }
    }
  }

  /**
   * Vibración de selección rápida para chips o opciones (8ms)
   */
  selection(): void {
    if (this.isVibrationSupported()) {
      try {
        navigator.vibrate(8);
      } catch {
        // Ignorar
      }
    }
  }

  /**
   * Vibración de confirmación de éxito (ej. corte registrado, cita confirmada)
   */
  success(): void {
    if (this.isVibrationSupported()) {
      try {
        navigator.vibrate([25, 50, 25]);
      } catch {
        // Ignorar
      }
    }
  }

  /**
   * Vibración para alertas, cancelaciones o errores
   */
  warning(): void {
    if (this.isVibrationSupported()) {
      try {
        navigator.vibrate([40, 30, 40]);
      } catch {
        // Ignorar
      }
    }
  }
}
