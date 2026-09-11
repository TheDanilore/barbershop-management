import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Client } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

export type ClientFilterSegment = 'all' | 'debt' | 'vip' | 'clear';

@Component({
  selector: 'app-barber-clients',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './barber-clients.page.html',
  styleUrl: './barber-clients.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberClientsPage {
  protected readonly Math = Math;
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  // Filtros y Segmentación
  readonly clientSearchQuery = signal('');
  readonly selectedSegment = signal<ClientFilterSegment>('all');

  // Estados de Modales Locales
  readonly isNewClientModalOpen = signal(false);
  readonly isSubmitting = signal(false);

  // Notificaciones Toast
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Formulario de Alta Rápida de Cliente
  readonly newClientForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    phone: ['', [Validators.pattern(/^[+0-9\s-]{7,20}$/)]],
    notes: [''],
  });

  // Clientes con Deuda Activa
  readonly clientsWithDebt = computed(() => {
    return this.barberService.clients().filter((c) => (c.currentDebt || 0) > 0);
  });

  // Saldo Total de Cartera por Cobrar (Deuda global)
  readonly totalReceivableDebt = computed(() => {
    return this.clientsWithDebt().reduce((sum, c) => sum + (c.currentDebt || 0), 0);
  });

  // Clientes VIP y Gold
  readonly vipClientsCount = computed(() => {
    return this.barberService.clients().filter((c) => c.membershipLevel === 'VIP' || c.membershipLevel === 'Gold').length;
  });

  // Clientes Filtrados Reactivos (Búsqueda + Pestaña de Segmentación)
  readonly filteredClients = computed(() => {
    const q = this.clientSearchQuery().toLowerCase().trim();
    const segment = this.selectedSegment();
    let list = this.barberService.clients();

    // Filtro por Segmento
    if (segment === 'debt') {
      list = list.filter((c) => (c.currentDebt || 0) > 0);
    } else if (segment === 'vip') {
      list = list.filter((c) => c.membershipLevel === 'VIP' || c.membershipLevel === 'Gold');
    } else if (segment === 'clear') {
      list = list.filter((c) => (c.currentDebt || 0) <= 0);
    }

    // Filtro por Búsqueda (Nombre o Teléfono)
    if (!q) return list;
    return list.filter((c) => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q)));
  });

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastMessage.set(null), 3500);
  }

  setSegment(segment: ClientFilterSegment): void {
    this.haptics.selection();
    this.selectedSegment.set(segment);
  }

  clearSearch(): void {
    this.haptics.lightTap();
    this.clientSearchQuery.set('');
  }

  // --- ALTA DE CLIENTE ---
  openNewClientModal(): void {
    this.haptics.lightTap();
    this.newClientForm.reset({ fullName: '', phone: '', notes: '' });
    this.isNewClientModalOpen.set(true);
  }

  closeNewClientModal(): void {
    this.haptics.lightTap();
    this.isNewClientModalOpen.set(false);
  }

  async submitNewClient(): Promise<void> {
    if (this.newClientForm.invalid || this.isSubmitting()) {
      this.newClientForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Ingresa un nombre válido para el cliente');
      return;
    }

    const { fullName, phone, notes } = this.newClientForm.value;
    this.isSubmitting.set(true);
    try {
      const cleanName = fullName!.trim();
      const cleanPhone = phone ? phone.trim() : '';
      const newClient = await this.barberService.createClient(
        cleanName,
        cleanPhone,
        undefined,
        notes ? notes.trim() : undefined
      );

      this.haptics.success();
      this.showToast(`Cliente "${newClient.name}" registrado con éxito`);
      this.closeNewClientModal();
    } catch {
      this.haptics.warning();
      this.showToast('Error al registrar el cliente');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  // --- ACCIONES RÁPIDAS OPERATIVAS ---
  openDebtPaymentModal(client: Client): void {
    this.haptics.lightTap();
    this.barberService.openDebtPaymentModal(client);
  }

  openRegisterCutForClient(client: Client): void {
    this.haptics.lightTap();
    this.barberService.openRegisterCutModal({ clientId: client.id });
  }

  openBookAppointmentForClient(client: Client): void {
    this.haptics.lightTap();
    this.barberService.openBookingModal();
  }

  getWhatsAppUrl(phone: string): string {
    if (!phone) return '#';
    const digits = phone.replace(/\D/g, '');
    const cleanNumber = digits.length === 9 ? `51${digits}` : digits;
    return `https://wa.me/${cleanNumber}?text=Hola%20te%20escribimos%20de%20BarberTrack%20PRO`;
  }
}
