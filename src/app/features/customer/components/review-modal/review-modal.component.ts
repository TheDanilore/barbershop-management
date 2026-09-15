import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-review-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './review-modal.component.html',
  styleUrl: './review-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewModalComponent implements OnChanges {
  private readonly fb = inject(FormBuilder);
  private readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly logger = inject(LoggerService);

  @Input() isOpen = false;
  @Input() orderId?: string;
  @Input() barberName?: string;
  @Input() serviceName?: string;
  @Input() date?: string;

  @Output() close = new EventEmitter<void>();
  @Output() reviewed = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly hoveredStar = signal<number | null>(null);

  readonly isVip = computed<boolean>(() => {
    return this.barberService.currentClient().membershipLevel === 'VIP';
  });

  readonly reviewForm: FormGroup = this.fb.group({
    rating: [5, [Validators.required, Validators.min(1), Validators.max(5)]],
    comment: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      this.reviewForm.reset({ rating: 5, comment: '' });
      this.hoveredStar.set(null);
    }
  }

  @HostListener('window:keydown.escape')
  handleEscape(): void {
    if (this.isOpen && !this.isSubmitting()) {
      this.onClose();
    }
  }

  setRating(stars: number): void {
    if (this.isSubmitting()) return;
    this.haptics.selection();
    this.reviewForm.patchValue({ rating: stars });
  }

  setHoverStar(stars: number | null): void {
    if (this.isSubmitting()) return;
    this.hoveredStar.set(stars);
  }

  getStarDescription(rating: number): string {
    switch (rating) {
      case 5: return '¡Experiencia de lujo impecable!';
      case 4: return 'Muy buen servicio, altamente recomendado';
      case 3: return 'Buen servicio, dentro de lo esperado';
      case 2: return 'Servicio regular, puede mejorar';
      case 1: return 'No cumplió con mis expectativas';
      default: return 'Selecciona una puntuación';
    }
  }

  onClose(): void {
    if (this.isSubmitting()) return;
    this.haptics.lightTap();
    this.errorMessage.set(null);
    this.close.emit();
  }

  async submitReview(): Promise<void> {
    if (this.reviewForm.invalid || this.isSubmitting()) {
      this.reviewForm.markAllAsTouched();
      this.haptics.warning();
      this.errorMessage.set('Por favor ingresa un comentario válido para tu valoración.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.reviewForm.disable({ emitEvent: false });

    const { rating, comment } = this.reviewForm.value;

    try {
      await this.barberService.addOrderReview({
        orderId: this.orderId,
        rating,
        comment: (comment || '').trim(),
        barberName: this.barberName,
      });

      this.haptics.success();
      this.reviewed.emit('¡Gracias por tu valoración!');
      this.reviewForm.reset({ rating: 5, comment: '' });
      this.close.emit();
    } catch (err: unknown) {
      this.haptics.warning();
      const message =
        err instanceof Error ? err.message : 'Error al registrar la valoración. Inténtalo nuevamente.';
      this.errorMessage.set(message);
      this.logger.error('ReviewModalComponent', `Fallo al publicar reseña: ${message}`, err);
    } finally {
      this.reviewForm.enable({ emitEvent: false });
      this.isSubmitting.set(false);
    }
  }
}
