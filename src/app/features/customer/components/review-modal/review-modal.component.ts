import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

@Component({
  selector: 'app-review-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './review-modal.component.html',
  styleUrl: './review-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);

  @Input() isOpen = false;
  @Input() orderId?: string;
  @Input() barberName?: string;
  @Input() serviceName?: string;
  @Input() date?: string;

  @Output() close = new EventEmitter<void>();
  @Output() reviewed = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly hoveredStar = signal<number | null>(null);

  readonly reviewForm: FormGroup = this.fb.group({
    rating: [5, [Validators.required, Validators.min(1), Validators.max(5)]],
    comment: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
  });

  @HostListener('window:keydown.escape')
  handleEscape(): void {
    if (this.isOpen && !this.isSubmitting()) {
      this.onClose();
    }
  }

  setRating(stars: number): void {
    this.haptics.selection();
    this.reviewForm.patchValue({ rating: stars });
  }

  setHoverStar(stars: number | null): void {
    this.hoveredStar.set(stars);
  }

  getStarDescription(rating: number): string {
    switch (rating) {
      case 5: return '¡Excelente servicio y atención!';
      case 4: return 'Muy buen corte, recomendado';
      case 3: return 'Buen servicio, aceptable';
      case 2: return 'Regular, podría mejorar';
      case 1: return 'No cumplió mis expectativas';
      default: return 'Selecciona una puntuación';
    }
  }

  onClose(): void {
    this.haptics.lightTap();
    this.close.emit();
  }

  async submitReview(): Promise<void> {
    if (this.reviewForm.invalid || this.isSubmitting()) {
      this.reviewForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    this.isSubmitting.set(true);
    const { rating, comment } = this.reviewForm.value;

    try {
      await this.barberService.addOrderReview({
        orderId: this.orderId,
        rating,
        comment: comment.trim(),
        barberName: this.barberName,
      });

      this.haptics.success();
      this.reviewed.emit('¡Gracias por tu valoración!');
      this.reviewForm.reset({ rating: 5, comment: '' });
      this.close.emit();
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
