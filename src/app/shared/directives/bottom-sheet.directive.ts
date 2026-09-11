import {
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  Input,
  OnDestroy,
  OnInit,
  Output,
  Renderer2,
} from '@angular/core';
import { HapticsService } from '../../core/services/haptics.service';

/**
 * Directiva Standalone para Bottom Sheets nativos inspirados en Apple HIG.
 * Permite:
 * 1. Arrastre táctil hacia abajo para descartar (drag-to-dismiss) con física de resorte.
 * 2. Arrastre táctil hacia arriba o tap en la manija para expandir a pantalla completa (pull-to-expand).
 * 3. Soporte para mouse drag en la manija para pruebas en emulación de escritorio.
 * 4. Feedback háptico sincronizado con cada acción.
 */
@Directive({
  selector: '[appBottomSheet]',
  standalone: true,
})
export class BottomSheetDirective implements OnInit, OnDestroy {
  private readonly el = inject(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly haptics = inject(HapticsService);

  @Input() appBottomSheetEnabled = true;
  @Input() dismissThreshold = 90; // px necesarios para cerrar
  @Input() velocityThreshold = 0.35; // velocidad mínima para flick-close

  @Output() dismiss = new EventEmitter<void>();
  @Output() expandChange = new EventEmitter<boolean>();

  private isDragging = false;
  private isExpanded = false;
  private startY = 0;
  private startX = 0;
  private currentY = 0;
  private startTime = 0;
  private wasHandleTarget = false;

  private unlistenMouseMove: (() => void) | null = null;
  private unlistenMouseUp: (() => void) | null = null;

  ngOnInit(): void {
    // Aseguramos que el elemento tenga posición y transformación base preparadas
    this.renderer.setStyle(this.el.nativeElement, 'touch-action', 'pan-y');
    this.renderer.setStyle(this.el.nativeElement, 'will-change', 'transform, height');
  }

  ngOnDestroy(): void {
    this.cleanupMouseListeners();
  }

  // =========================================================================
  // GESTOS TÁCTILES (Mobile / Tablet Touch)
  // =========================================================================

  @HostListener('touchstart', ['$event'])
  onTouchStart(e: TouchEvent): void {
    if (!this.appBottomSheetEnabled || e.touches.length !== 1) return;

    const target = e.target as HTMLElement;
    this.wasHandleTarget = this.isDragHandle(target);

    // Solo iniciamos arrastre si se tocó la manija, la cabecera, o si el scroll interno está al tope superior
    const isAtTop = this.el.nativeElement.scrollTop <= 0;
    if (!this.wasHandleTarget && !this.isHeader(target) && !isAtTop) {
      return;
    }

    this.startY = e.touches[0].clientY;
    this.startX = e.touches[0].clientX;
    this.currentY = this.startY;
    this.startTime = Date.now();
    this.isDragging = true;

    // Desactivamos transiciones durante el arrastre para respuesta a 120fps
    this.renderer.setStyle(this.el.nativeElement, 'transition', 'none');
  }

  @HostListener('touchmove', ['$event'])
  onTouchMove(e: TouchEvent): void {
    if (!this.isDragging || e.touches.length !== 1) return;

    this.currentY = e.touches[0].clientY;
    const deltaY = this.currentY - this.startY;
    const deltaX = e.touches[0].clientX - this.startX;

    // Si el movimiento horizontal es dominante, no interferir con scroll
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      return;
    }

    if (deltaY > 0) {
      // Arrastre hacia abajo (Descartar)
      if (e.cancelable && (this.wasHandleTarget || this.el.nativeElement.scrollTop <= 0)) {
        e.preventDefault();
      }
      this.renderer.setStyle(this.el.nativeElement, 'transform', `translateY(${deltaY}px)`);
    } else if (deltaY < 0) {
      // Arrastre hacia arriba (Expandir)
      if (!this.isExpanded) {
        if (e.cancelable) e.preventDefault();
        const resistedY = deltaY * 0.35; // Resistencia elástica
        this.renderer.setStyle(this.el.nativeElement, 'transform', `translateY(${resistedY}px)`);
      }
    }
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(e: TouchEvent): void {
    if (!this.isDragging) return;
    this.isDragging = false;

    const deltaY = (e.changedTouches[0]?.clientY || this.currentY) - this.startY;
    const duration = Math.max(Date.now() - this.startTime, 1);
    const velocity = deltaY / duration;

    // 1. Descartar hacia abajo (Swipe down o desplazamiento superado)
    if (deltaY > this.dismissThreshold || (velocity > this.velocityThreshold && deltaY > 30)) {
      this.animateDismiss();
      return;
    }

    // 2. Expandir hacia arriba (Swipe up)
    if (deltaY < -50 || (velocity < -this.velocityThreshold && deltaY < -20)) {
      this.setExpanded(true);
      return;
    }

    // 3. Si fue solo un tap en la manija (desplazamiento mínimo < 8px)
    if (this.wasHandleTarget && Math.abs(deltaY) < 8 && duration < 300) {
      this.toggleExpanded();
      return;
    }

    // 4. Volver a la posición de reposo con resorte suave
    this.snapBack();
  }

  @HostListener('touchcancel')
  onTouchCancel(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.snapBack();
    }
  }

  // =========================================================================
  // GESTOS CON MOUSE (Para pruebas en emulador responsivo)
  // =========================================================================

  @HostListener('mousedown', ['$event'])
  onMouseDown(e: MouseEvent): void {
    if (!this.appBottomSheetEnabled || e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (!this.isDragHandle(target)) return; // Con mouse solo permitimos arrastrar desde la manija

    e.preventDefault();
    this.wasHandleTarget = true;
    this.startY = e.clientY;
    this.currentY = this.startY;
    this.startTime = Date.now();
    this.isDragging = true;

    this.renderer.setStyle(this.el.nativeElement, 'transition', 'none');

    this.unlistenMouseMove = this.renderer.listen('window', 'mousemove', (me: MouseEvent) => {
      if (!this.isDragging) return;
      this.currentY = me.clientY;
      const deltaY = this.currentY - this.startY;

      if (deltaY > 0) {
        this.renderer.setStyle(this.el.nativeElement, 'transform', `translateY(${deltaY}px)`);
      } else if (deltaY < 0 && !this.isExpanded) {
        this.renderer.setStyle(this.el.nativeElement, 'transform', `translateY(${deltaY * 0.35}px)`);
      }
    });

    this.unlistenMouseUp = this.renderer.listen('window', 'mouseup', (me: MouseEvent) => {
      this.cleanupMouseListeners();
      if (!this.isDragging) return;
      this.isDragging = false;

      const deltaY = me.clientY - this.startY;
      const duration = Math.max(Date.now() - this.startTime, 1);
      const velocity = deltaY / duration;

      if (deltaY > this.dismissThreshold || (velocity > this.velocityThreshold && deltaY > 30)) {
        this.animateDismiss();
      } else if (deltaY < -50 || (velocity < -this.velocityThreshold && deltaY < -20)) {
        this.setExpanded(true);
      } else if (Math.abs(deltaY) < 8 && duration < 300) {
        this.toggleExpanded();
      } else {
        this.snapBack();
      }
    });
  }

  // =========================================================================
  // CONTROL DE ANIMACIONES Y ESTADOS
  // =========================================================================

  private animateDismiss(): void {
    this.renderer.setStyle(
      this.el.nativeElement,
      'transition',
      'transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)'
    );
    this.renderer.setStyle(this.el.nativeElement, 'transform', 'translateY(100%)');
    this.haptics.lightTap();

    setTimeout(() => {
      this.dismiss.emit();
    }, 220);
  }

  private snapBack(): void {
    this.renderer.setStyle(
      this.el.nativeElement,
      'transition',
      'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)'
    );
    this.renderer.setStyle(this.el.nativeElement, 'transform', 'translateY(0)');
  }

  private setExpanded(expand: boolean): void {
    this.isExpanded = expand;
    this.haptics.selection();

    this.renderer.setStyle(
      this.el.nativeElement,
      'transition',
      'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), height 0.28s cubic-bezier(0.16, 1, 0.3, 1), max-height 0.28s cubic-bezier(0.16, 1, 0.3, 1)'
    );
    this.renderer.setStyle(this.el.nativeElement, 'transform', 'translateY(0)');

    if (expand) {
      this.renderer.addClass(this.el.nativeElement, 'sheet-expanded');
    } else {
      this.renderer.removeClass(this.el.nativeElement, 'sheet-expanded');
    }

    this.expandChange.emit(this.isExpanded);
  }

  public toggleExpanded(): void {
    this.setExpanded(!this.isExpanded);
  }

  private isDragHandle(target: HTMLElement | null): boolean {
    if (!target) return false;
    return !!(
      target.classList.contains('sheet-drag-handle') ||
      target.classList.contains('sheet-drag-handle-zone') ||
      target.classList.contains('mas-drag-handle') ||
      target.closest('.sheet-drag-handle-zone') ||
      target.closest('.sheet-drag-handle')
    );
  }

  private isHeader(target: HTMLElement | null): boolean {
    if (!target) return false;
    return !!(
      target.classList.contains('sheet-header') ||
      target.classList.contains('mas-header') ||
      target.closest('.sheet-header') ||
      target.closest('.mas-header')
    );
  }

  private cleanupMouseListeners(): void {
    if (this.unlistenMouseMove) {
      this.unlistenMouseMove();
      this.unlistenMouseMove = null;
    }
    if (this.unlistenMouseUp) {
      this.unlistenMouseUp();
      this.unlistenMouseUp = null;
    }
  }
}
