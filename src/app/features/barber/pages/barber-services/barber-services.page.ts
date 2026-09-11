import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ServiceItem } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

@Component({
  selector: 'app-barber-services',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './barber-services.page.html',
  styleUrl: './barber-services.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberServicesPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  readonly isServiceModalOpen = signal(false);
  readonly editingServiceId = signal<string | null>(null);
  readonly isSubmitting = signal(false);

  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly serviceForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    price: [15, [Validators.required, Validators.min(0.5)]],
    durationMinutes: [30, [Validators.required, Validators.min(5)]],
  });

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastMessage.set(null), 3500);
  }

  openCreateServiceModal(): void {
    this.haptics.lightTap();
    this.editingServiceId.set(null);
    this.serviceForm.reset({ name: '', price: 15, durationMinutes: 30 });
    this.isServiceModalOpen.set(true);
  }

  openEditServiceModal(service: ServiceItem): void {
    this.haptics.lightTap();
    this.editingServiceId.set(service.id);
    this.serviceForm.patchValue({
      name: service.name,
      price: service.price,
      durationMinutes: service.durationMinutes,
    });
    this.isServiceModalOpen.set(true);
  }

  closeServiceModal(): void {
    this.haptics.lightTap();
    this.isServiceModalOpen.set(false);
    this.editingServiceId.set(null);
  }

  async submitService(): Promise<void> {
    if (this.serviceForm.invalid || this.isSubmitting()) {
      this.serviceForm.markAllAsTouched();
      this.haptics.warning();
      this.showToast('Completa los campos requeridos');
      return;
    }

    const { name, price, durationMinutes } = this.serviceForm.value;
    const editingId = this.editingServiceId();

    this.isSubmitting.set(true);
    try {
      if (editingId) {
        const current = this.barberService.services().find((s) => s.id === editingId);
        await this.barberService.updateService(
          editingId,
          name!,
          Number(price),
          Number(durationMinutes),
          current?.isActive ?? true
        );
        this.haptics.success();
        this.showToast('Servicio actualizado');
      } else {
        await this.barberService.createService(
          name!,
          Number(price),
          Number(durationMinutes)
        );
        this.haptics.success();
        this.showToast('Servicio agregado al catálogo');
      }
      this.closeServiceModal();
    } catch {
      this.haptics.warning();
      this.showToast('Error al guardar el servicio');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async toggleServiceActive(service: ServiceItem): Promise<void> {
    const nextState = service.isActive === false ? true : false;
    try {
      await this.barberService.updateService(
        service.id,
        service.name,
        service.price,
        service.durationMinutes,
        nextState
      );
      this.haptics.lightTap();
      this.showToast(nextState ? 'Servicio activado' : 'Servicio desactivado');
    } catch {
      this.haptics.warning();
      this.showToast('Error al cambiar el estado del servicio');
    }
  }
}
