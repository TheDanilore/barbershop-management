import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Client } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

@Component({
  selector: 'app-barber-clients',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './barber-clients.page.html',
  styleUrl: './barber-clients.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberClientsPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  readonly clientSearchQuery = signal('');
  readonly isNewClientModalOpen = signal(false);
  readonly isDebtPaymentModalOpen = signal(false);
  readonly debtPaymentClient = signal<Client | null>(null);
  readonly isSubmitting = signal(false);

  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly newClientForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    phone: ['', [Validators.pattern(/^[+0-9\s-]{7,20}$/)]],
    notes: [''],
  });

  readonly debtPaymentForm: FormGroup = this.fb.group({
    amount: [null, [Validators.required, Validators.min(0.5)]],
    paymentMethod: ['cash', [Validators.required]],
    notes: [''],
  });

  readonly filteredClients = computed(() => {
    const q = this.clientSearchQuery().toLowerCase().trim();
    if (!q) return this.barberService.clients();
    return this.barberService
      .clients()
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q));
  });

  readonly clientsWithDebt = computed(() => {
    return this.barberService.clients().filter((c) => (c.currentDebt || 0) > 0);
  });

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastMessage.set(null), 3500);
  }

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
      this.showToast('Ingresa el nombre del cliente');
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
      this.showToast(`Cliente "${newClient.name}" registrado`);
      this.closeNewClientModal();
    } catch {
      this.haptics.warning();
      this.showToast('Error al registrar cliente');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openDebtPaymentModal(client: Client): void {
    this.haptics.lightTap();
    this.debtPaymentClient.set(client);
    this.debtPaymentForm.reset({
      amount: client.currentDebt,
      paymentMethod: 'cash',
      notes: '',
    });
    this.isDebtPaymentModalOpen.set(true);
  }

  closeDebtPaymentModal(): void {
    this.haptics.lightTap();
    this.isDebtPaymentModalOpen.set(false);
    this.debtPaymentClient.set(null);
  }

  async submitPayClientDebt(): Promise<void> {
    if (this.debtPaymentForm.invalid || this.isSubmitting() || !this.debtPaymentClient()) {
      this.debtPaymentForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Ingresa un monto válido para abonar');
      return;
    }

    const client = this.debtPaymentClient()!;
    const { amount, paymentMethod, notes } = this.debtPaymentForm.value;
    const defaultAcc = this.barberService.financialAccounts()[0]?.id || '';

    this.isSubmitting.set(true);
    try {
      await this.barberService.registerCreditPayment({
        clientId: client.id,
        amount: Number(amount),
        accountId: defaultAcc,
        paymentMethod: paymentMethod || 'cash',
        notes: notes ? notes.trim() : undefined,
      });

      this.haptics.success();
      this.showToast(`Abono de $${amount} registrado a ${client.name}`);
      this.closeDebtPaymentModal();
    } catch (err: any) {
      this.haptics.warning();
      this.showToast(err?.message || 'Error al procesar el abono');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
