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
import { FormsModule } from '@angular/forms';
import { Client } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { ClientActionSheetComponent } from '../../components/client-action-sheet/client-action-sheet.component';
import { NewClientModalComponent } from '../../components/new-client-modal/new-client-modal.component';

export type ClientFilterSegment = 'all' | 'debt' | 'vip' | 'clear' | 'inactive';
export type ClientViewMode = 'cards' | 'table';

const VIEW_MODE_STORAGE_KEY = 'barbertrack_clients_view_mode';

@Component({
  selector: 'app-barber-clients',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NewClientModalComponent,
    ClientActionSheetComponent,
  ],
  templateUrl: './barber-clients.page.html',
  styleUrl: './barber-clients.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberClientsPage {
  protected readonly Math = Math;
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) clearTimeout(this.toastTimeout);
    });
  }

  // Estado de Carga Inicial Real (SWR): Solo shimmer si la caché local está 100% vacía
  readonly isClientsInitialLoading = computed(() => {
    return this.barberService.isLoading() && this.barberService.clients().length === 0;
  });

  // Sincronización en segundo plano (los datos en caché se muestran al instante)
  readonly isBackgroundSyncing = computed(() => {
    return this.barberService.isLoading() && this.barberService.clients().length > 0;
  });

  // Vista activa (Cards visual ↔ Tabla ERP DataGrid de alta densidad)
  readonly viewMode = signal<ClientViewMode>(this.loadInitialViewMode());

  // Filtros y Segmentación
  readonly clientSearchQuery = signal('');
  readonly selectedSegment = signal<ClientFilterSegment>('all');

  // Estados de Modales y Action Sheet
  readonly isNewClientModalOpen = signal(false);
  readonly clientToEdit = signal<Client | null>(null);
  readonly clientActionSheetTarget = signal<Client | null>(null);

  // Navegación táctica por teclado (Power User Desktop)
  readonly focusedClientIndex = signal<number>(-1);

  // Notificaciones Toast
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  // Clientes Activos e Inactivos
  readonly activeClients = computed(() => {
    return this.barberService.clients().filter((c) => c.isActive !== false);
  });

  readonly inactiveClients = computed(() => {
    return this.barberService.clients().filter((c) => c.isActive === false);
  });

  // Clientes con Deuda Activa (Sobre cartera activa)
  readonly clientsWithDebt = computed(() => {
    return this.activeClients().filter((c) => (c.currentDebt || 0) > 0);
  });

  // Saldo Total de Cartera por Cobrar (Deuda global activa)
  readonly totalReceivableDebt = computed(() => {
    return this.clientsWithDebt().reduce((sum, c) => sum + (c.currentDebt || 0), 0);
  });

  // Clientes VIP y Gold activos
  readonly vipClientsCount = computed(() => {
    return this.activeClients().filter(
      (c) => c.membershipLevel === 'VIP' || c.membershipLevel === 'Gold'
    ).length;
  });

  // Clientes al día (sin deuda activos)
  readonly clearClientsCount = computed(() => {
    return this.activeClients().filter((c) => (c.currentDebt || 0) <= 0).length;
  });

  // Clientes Filtrados Reactivos (Búsqueda + Pestaña de Segmentación)
  readonly filteredClients = computed(() => {
    const q = this.clientSearchQuery().toLowerCase().trim();
    const segment = this.selectedSegment();
    let list: Client[];

    // Filtro por Segmento
    if (segment === 'debt') {
      list = this.clientsWithDebt();
    } else if (segment === 'vip') {
      list = this.activeClients().filter(
        (c) => c.membershipLevel === 'VIP' || c.membershipLevel === 'Gold'
      );
    } else if (segment === 'clear') {
      list = this.activeClients().filter((c) => (c.currentDebt || 0) <= 0);
    } else if (segment === 'inactive') {
      list = this.inactiveClients();
    } else {
      // 'all': Muestra activos primero, e inactivos al final si no hay búsqueda
      const active = this.activeClients();
      const inactive = this.inactiveClients();
      list = [...active, ...inactive];
    }

    // Filtro por Búsqueda (Nombre o Teléfono)
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.notes && c.notes.toLowerCase().includes(q))
    );
  });

  private loadInitialViewMode(): ClientViewMode {
    try {
      const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === 'cards' || saved === 'table') return saved;
      // Default: en pantallas desktop anchas se inicia en cards o table
      return 'cards';
    } catch {
      return 'cards';
    }
  }

  setViewMode(mode: ClientViewMode): void {
    this.haptics.selection();
    this.viewMode.set(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // no-op
    }
  }

  toggleViewMode(): void {
    const nextMode: ClientViewMode = this.viewMode() === 'cards' ? 'table' : 'cards';
    this.setViewMode(nextMode);
    this.showToast(`Modo cambiado a: ${nextMode === 'cards' ? 'Tarjetas Visuales' : 'Tabla ERP DataGrid'}`);
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardShortcut(event: KeyboardEvent): void {
    // Si el modal de nuevo cliente está abierto, no interceptar atajos globales
    if (this.isNewClientModalOpen()) return;

    const targetTag = (event.target as HTMLElement)?.tagName?.toLowerCase();
    const isInputActive = targetTag === 'input' || targetTag === 'textarea';

    // Cerrar Action Sheet si está abierto con Escape
    if (event.key === 'Escape' && this.clientActionSheetTarget()) {
      event.preventDefault();
      this.closeClientActionSheet();
      return;
    }

    // Alt + N: Nuevo cliente
    if (event.altKey && (event.key === 'n' || event.key === 'N')) {
      event.preventDefault();
      this.openNewClientModal();
      return;
    }

    // / (slash): Enfocar buscador rápido si no está en un input
    if (event.key === '/' && !isInputActive) {
      event.preventDefault();
      const searchEl = document.getElementById('clientSearchInput');
      if (searchEl) {
        searchEl.focus();
        (searchEl as HTMLInputElement).select();
      }
      return;
    }

    // Escape: Limpiar búsqueda si hay texto y estamos en el input
    if (event.key === 'Escape') {
      if (this.clientSearchQuery()) {
        this.clearSearch();
        const searchEl = document.getElementById('clientSearchInput');
        searchEl?.blur();
      }
      return;
    }

    // Si estamos escribiendo en el buscador, ignorar comandos de una letra
    if (isInputActive) return;

    // V: Alternar entre vista de tarjetas y tabla ERP
    if (event.key === 'v' || event.key === 'V') {
      event.preventDefault();
      this.toggleViewMode();
      return;
    }

    const clients = this.filteredClients();
    if (!clients.length) return;

    // Navegación J / K o Flechas Abajo / Arriba
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIdx = Math.min(this.focusedClientIndex() + 1, clients.length - 1);
      this.focusedClientIndex.set(nextIdx);
      this.scrollFocusedClientIntoView(nextIdx);
      return;
    }

    if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      const prevIdx = Math.max(this.focusedClientIndex() - 1, 0);
      this.focusedClientIndex.set(prevIdx);
      this.scrollFocusedClientIntoView(prevIdx);
      return;
    }

    // Comandos sobre el cliente enfocado
    const currentIdx = this.focusedClientIndex();
    if (currentIdx >= 0 && currentIdx < clients.length) {
      const activeClient = clients[currentIdx];

      // D: Abonar deuda si tiene deuda
      if (event.key === 'd' || event.key === 'D') {
        event.preventDefault();
        this.openDebtPaymentModal(activeClient);
        return;
      }

      // C: Cobrar / Registrar corte
      if (event.key === 'c' || event.key === 'C') {
        event.preventDefault();
        this.openRegisterCutForClient(activeClient);
        return;
      }

      // E: Editar cliente
      if (event.key === 'e' || event.key === 'E') {
        event.preventDefault();
        this.openEditClientModal(activeClient);
        return;
      }

      // A: Agendar cita
      if (event.key === 'a' || event.key === 'A') {
        event.preventDefault();
        this.openBookAppointmentForClient(activeClient);
        return;
      }
    }
  }

  private scrollFocusedClientIntoView(idx: number): void {
    const el = document.querySelector(`[data-client-index="${idx}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastMessage.set(null), 3500);
  }

  setSegment(segment: ClientFilterSegment): void {
    this.haptics.selection();
    this.selectedSegment.set(segment);
    this.focusedClientIndex.set(-1);
  }

  clearSearch(): void {
    this.haptics.lightTap();
    this.clientSearchQuery.set('');
    this.focusedClientIndex.set(-1);
  }

  // --- ALTA Y EDICIÓN DE CLIENTE ---
  openNewClientModal(): void {
    this.haptics.lightTap();
    this.clientToEdit.set(null);
    this.isNewClientModalOpen.set(true);
  }

  openEditClientModal(client: Client, event?: Event): void {
    event?.stopPropagation();
    this.closeClientActionSheet();
    this.haptics.lightTap();
    this.clientToEdit.set(client);
    this.isNewClientModalOpen.set(true);
  }

  closeNewClientModal(): void {
    this.haptics.lightTap();
    this.isNewClientModalOpen.set(false);
    this.clientToEdit.set(null);
  }

  onClientCreated(client: Client): void {
    this.showToast(`Cliente "${client.name}" registrado con éxito`);
    this.closeNewClientModal();
  }

  onClientUpdated(client: Client): void {
    this.showToast(`Cliente "${client.name}" actualizado con éxito`);
    this.closeNewClientModal();
  }

  // --- ACTION SHEET TÁCTIL (MÓVIL & TABLET) ---
  openClientActionSheet(client: Client, event?: Event): void {
    event?.stopPropagation();
    this.haptics.selection();
    this.clientActionSheetTarget.set(client);
  }

  closeClientActionSheet(): void {
    this.clientActionSheetTarget.set(null);
  }

  // --- ACTIVAR / DESACTIVAR ESTADO DE CLIENTE ---
  async toggleClientStatus(client: Client, event?: Event): Promise<void> {
    event?.stopPropagation();
    this.closeClientActionSheet();
    const previousState = client.isActive !== false;
    const nextState = !previousState;
    try {
      await this.barberService.toggleClientStatus(client.id, nextState);
      this.haptics.lightTap();
      this.showToast(nextState ? `Cliente ${client.name} reactivado` : `Cliente ${client.name} pausado`);
    } catch (err: any) {
      // Reversión local inmediata si la petición al backend falla
      await this.barberService.toggleClientStatus(client.id, previousState).catch(() => {});
      this.haptics.warning();
      this.showToast('Error de conexión: No se pudo modificar el estado');
    }
  }

  // --- ACCIONES RÁPIDAS OPERATIVAS ---
  openDebtPaymentModal(client: Client, event?: Event): void {
    event?.stopPropagation();
    this.closeClientActionSheet();
    this.haptics.lightTap();
    this.barberService.openDebtPaymentModal(client);
  }

  openRegisterCutForClient(client: Client, event?: Event): void {
    event?.stopPropagation();
    this.closeClientActionSheet();
    this.haptics.lightTap();
    this.barberService.openRegisterCutModal({ clientId: client.id });
  }

  openBookAppointmentForClient(client: Client, event?: Event): void {
    event?.stopPropagation();
    this.closeClientActionSheet();
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

