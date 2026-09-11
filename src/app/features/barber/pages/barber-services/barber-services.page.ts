import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ServiceItem } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

import { ServiceModalComponent } from '../../components/service-modal/service-modal.component';

@Component({
  selector: 'app-barber-services',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ServiceModalComponent],
  templateUrl: './barber-services.page.html',
  styleUrl: './barber-services.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberServicesPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);

  readonly isServiceModalOpen = signal(false);
  readonly editingService = signal<ServiceItem | null>(null);

  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastMessage.set(null), 3500);
  }

  openCreateServiceModal(): void {
    this.haptics.lightTap();
    this.editingService.set(null);
    this.isServiceModalOpen.set(true);
  }

  openEditServiceModal(service: ServiceItem): void {
    this.haptics.lightTap();
    this.editingService.set(service);
    this.isServiceModalOpen.set(true);
  }

  closeServiceModal(): void {
    this.haptics.lightTap();
    this.isServiceModalOpen.set(false);
    this.editingService.set(null);
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
