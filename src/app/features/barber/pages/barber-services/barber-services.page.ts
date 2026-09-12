import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ServiceItem } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { ServiceModalComponent } from '../../components/service-modal/service-modal.component';

export type ServiceFilterSegment = 'all' | 'active' | 'paused';
export type ServiceViewMode = 'cards' | 'table';

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
  private readonly destroyRef = inject(DestroyRef);

  // Estados de control de vista y filtros
  readonly searchQuery = signal<string>('');
  readonly selectedSegment = signal<ServiceFilterSegment>('all');
  readonly viewMode = signal<ServiceViewMode>('cards');

  // Estados de modal
  readonly isServiceModalOpen = signal(false);
  readonly editingService = signal<ServiceItem | null>(null);

  // Notificación local flotante
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
    });
  }

  // Lista base de servicios
  readonly allServices = computed(() => this.barberService.services());

  // Estado SWR: Shimmer solo cuando la caché local esté vacía
  readonly isServicesInitialLoading = computed(() => {
    return this.barberService.isLoading() && this.allServices().length === 0;
  });

  // Métricas reactivas del catálogo
  readonly activeServicesCount = computed(() => {
    return this.allServices().filter((s) => s.isActive !== false).length;
  });

  readonly pausedServicesCount = computed(() => {
    return this.allServices().filter((s) => s.isActive === false).length;
  });

  readonly averagePrice = computed(() => {
    const list = this.allServices();
    if (list.length === 0) return 0;
    return list.reduce((sum, s) => sum + (Number(s.price) || 0), 0) / list.length;
  });

  readonly averageDuration = computed(() => {
    const list = this.allServices();
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, s) => sum + (Number(s.durationMinutes) || 0), 0) / list.length);
  });

  // Lista filtrada en tiempo real
  readonly filteredServices = computed(() => {
    let list = this.allServices();

    // 1. Filtrado por segmento
    const seg = this.selectedSegment();
    if (seg === 'active') {
      list = list.filter((s) => s.isActive !== false);
    } else if (seg === 'paused') {
      list = list.filter((s) => s.isActive === false);
    }

    // 2. Filtrado por texto de búsqueda
    const q = this.searchQuery().trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.price.toString().includes(q) ||
          s.durationMinutes.toString().includes(q)
      );
    }

    return list;
  });

  // Atajos de teclado para escritorio (Alt+S: Nuevo Servicio, Esc: Cerrar)
  @HostListener('window:keydown', ['$event'])
  handleKeyboard(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const isEditing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

    if (e.key === 'Escape') {
      if (this.isServiceModalOpen()) this.closeServiceModal();
      return;
    }

    if (isEditing) return;

    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      this.openCreateServiceModal();
    }
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastMessage.set(null), 3500);
  }

  setSegment(seg: ServiceFilterSegment): void {
    this.haptics.selection();
    this.selectedSegment.set(seg);
  }

  setViewMode(mode: ServiceViewMode): void {
    this.haptics.lightTap();
    this.viewMode.set(mode);
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }

  clearSearch(): void {
    this.haptics.lightTap();
    this.searchQuery.set('');
  }

  openCreateServiceModal(): void {
    this.haptics.lightTap();
    this.editingService.set(null);
    this.isServiceModalOpen.set(true);
  }

  openEditServiceModal(service: ServiceItem, event?: Event): void {
    if (event) event.stopPropagation();
    this.haptics.lightTap();
    this.editingService.set(service);
    this.isServiceModalOpen.set(true);
  }

  closeServiceModal(): void {
    this.haptics.lightTap();
    this.isServiceModalOpen.set(false);
    this.editingService.set(null);
  }

  async toggleServiceActive(service: ServiceItem, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
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
      this.showToast(nextState ? `Servicio "${service.name}" activado` : `Servicio "${service.name}" pausado`);
    } catch {
      this.haptics.warning();
      this.showToast('Error al actualizar estado del servicio');
    }
  }
}
