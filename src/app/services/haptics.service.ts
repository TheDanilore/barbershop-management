import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class HapticsService {
  private isVibrationSupported(): boolean {
    return typeof navigator !== 'undefined' && 'vibrate' in navigator;
  }

  /**
   * Vibración suave para taps y cambios de pestaña
   */
  lightTap(): void {
    if (this.isVibrationSupported()) {
      try {
        navigator.vibrate(12);
      } catch (e) {
        // Ignorar en plataformas que no lo permitan
      }
    }
  }

  /**
   * Vibración de selección rápida para chips o opciones
   */
  selection(): void {
    if (this.isVibrationSupported()) {
      try {
        navigator.vibrate(8);
      } catch (e) {
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
        // Patrón corto: vibra 25ms, pausa 50ms, vibra 25ms
        navigator.vibrate([25, 50, 25]);
      } catch (e) {
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
      } catch (e) {
        // Ignorar
      }
    }
  }
}
