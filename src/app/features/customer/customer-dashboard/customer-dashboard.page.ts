import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { Appointment } from '../../../core/models/barber.models';
import { BarberService } from '../../../core/services/barber.service';
import { HapticsService } from '../../../core/services/haptics.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { BookingModal } from '../components/booking-modal/booking-modal';
import { LoyaltyCard } from '../components/loyalty-card/loyalty-card';

@Component({
  selector: 'app-customer-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    LoyaltyCard,
    BookingModal,
  ],
  templateUrl: './customer-dashboard.page.html',
  styleUrl: './customer-dashboard.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerDashboardPage implements OnInit {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  // Nombre reactivo de cliente extraído del perfil real o mock
  readonly displayName = computed(() => {
    return (
      this.supabaseService.userProfile()?.full_name ||
      this.barberService.currentClient().name
    );
  });

  // Tab activo: 'inicio' | 'fidelidad' | 'historial' | 'perfil'
  readonly clientTab = signal<'inicio' | 'fidelidad' | 'historial' | 'perfil'>('inicio');

  // Modales
  readonly isBookingModalOpen = signal(false);
  readonly isReviewModalOpen = signal(false);

  // Toast feedback
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Formulario reactivo de reseña
  readonly reviewForm: FormGroup = this.fb.group({
    rating: [5, [Validators.required, Validators.min(1), Validators.max(5)]],
    comment: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
    });
  }

  ngOnInit(): void {
    if (this.supabaseService.isConfigured() && this.supabaseService.isAuthenticated) {
      this.barberService.syncFromSupabase();
    }
  }

  setTab(tab: 'inicio' | 'fidelidad' | 'historial' | 'perfil'): void {
    this.haptics.lightTap();
    this.clientTab.set(tab);
  }

  switchToBarber(): void {
    this.haptics.lightTap();
    this.barberService.setRole('barber');
    this.router.navigate(['/barber']);
  }

  logout(): void {
    this.haptics.lightTap();
    this.supabaseService.signOut();
    this.router.navigate(['/login']);
  }

  openBookingModal(): void {
    this.haptics.lightTap();
    this.isBookingModalOpen.set(true);
  }

  closeBookingModal(): void {
    this.isBookingModalOpen.set(false);
  }

  onBookingSuccess(msg: string): void {
    this.showToast(msg);
  }

  cancelAppointment(apt: Appointment): void {
    this.haptics.warning();
    this.barberService.updateAppointmentStatus(apt.id, 'cancelled');
    this.showToast(`Cita de las ${apt.time} cancelada`);
  }

  openReviewModal(): void {
    this.haptics.lightTap();
    this.reviewForm.reset({ rating: 5, comment: '' });
    this.isReviewModalOpen.set(true);
  }

  closeReviewModal(): void {
    this.haptics.lightTap();
    this.isReviewModalOpen.set(false);
  }

  setRating(stars: number): void {
    this.haptics.selection();
    this.reviewForm.patchValue({ rating: stars });
  }

  submitReview(): void {
    if (this.reviewForm.invalid) {
      this.reviewForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Escribe tu opinión para enviar');
      return;
    }

    const { rating, comment } = this.reviewForm.value;
    this.barberService.addReview(rating, comment.trim());
    this.haptics.success();
    this.isReviewModalOpen.set(false);
    this.showToast('¡Gracias por tu valoración!');
  }

  showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 3500);
  }

  formatDate(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoDate;
    }
  }

  getPaymentLabel(method: string): string {
    switch (method) {
      case 'cash': return 'Efectivo';
      case 'card': return 'Tarjeta';
      case 'transfer': return 'Yape / Transf.';
      default: return method;
    }
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'confirmed': return 'Confirmado';
      case 'in-progress': return 'En atención';
      case 'completed': return 'Completado';
      case 'cancelled': return 'Cancelado';
      default: return 'Pendiente';
    }
  }
}
