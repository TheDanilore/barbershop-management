import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';

export interface CommandItem {
  id: string;
  type: 'action' | 'navigation' | 'client';
  title: string;
  subtitle?: string;
  badge?: string;
  shortcut?: string;
  icon: string;
  action: () => void;
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPaletteComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly router = inject(Router);
  private readonly haptics = inject(HapticsService);

  @Input() isOpen = false;

  @Output() closed = new EventEmitter<void>();
  @Output() triggerCut = new EventEmitter<string | undefined>();
  @Output() triggerAppointment = new EventEmitter<void>();
  @Output() triggerNewClient = new EventEmitter<void>();

  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;

  readonly searchQuery = signal('');
  readonly selectedIndex = signal(0);

  // Lista base de comandos disponibles
  readonly baseCommands = computed<CommandItem[]>(() => {
    return [
      {
        id: 'new-cut',
        type: 'action',
        title: 'Registrar Corte / Cobro Express POS',
        subtitle: 'Cobrar servicio y actualizar caja',
        shortcut: 'Alt + N',
        icon: 'cut',
        action: () => {
          this.triggerCut.emit(undefined);
          this.closePalette();
        },
      },
      {
        id: 'new-appointment',
        type: 'action',
        title: 'Agendar Nueva Cita',
        subtitle: 'Reservar turno en la agenda',
        shortcut: 'Alt + A',
        icon: 'calendar',
        action: () => {
          this.triggerAppointment.emit();
          this.closePalette();
        },
      },
      {
        id: 'new-client',
        type: 'action',
        title: 'Alta Rápida de Cliente',
        subtitle: 'Registrar nuevo cliente en el directorio',
        shortcut: 'Alt + C',
        icon: 'user-plus',
        action: () => {
          this.triggerNewClient.emit();
          this.closePalette();
        },
      },
      {
        id: 'nav-overview',
        type: 'navigation',
        title: 'Ir a Panel General',
        subtitle: 'Métricas de hoy, turnos y accesos rápidos',
        icon: 'home',
        action: () => this.navigate('/barber/overview'),
      },
      {
        id: 'nav-appointments',
        type: 'navigation',
        title: 'Ir a Agenda & Turnos',
        subtitle: 'Ver calendario y citas del día',
        badge: `${this.barberService.todayAppointments().length} hoy`,
        icon: 'calendar',
        action: () => this.navigate('/barber/appointments'),
      },
      {
        id: 'nav-clients',
        type: 'navigation',
        title: 'Ir a Directorio de Clientes',
        subtitle: 'Buscar fichas, historial de cortes y deudas',
        badge: `${this.barberService.clients().length} clientes`,
        icon: 'users',
        action: () => this.navigate('/barber/clients'),
      },
      {
        id: 'nav-cash',
        type: 'navigation',
        title: 'Ir a Caja & Cuentas Financieras',
        subtitle: 'Apertura/cierre de turnos y saldo en efectivo',
        badge: this.barberService.activeCashShift() ? 'Abierta' : 'Cerrada',
        icon: 'wallet',
        action: () => this.navigate('/barber/cash'),
      },
      {
        id: 'nav-stats',
        type: 'navigation',
        title: 'Ir a Finanzas & Estadísticas',
        subtitle: 'Ingresos, reportes mensuales y rankings',
        icon: 'chart',
        action: () => this.navigate('/barber/stats'),
      },
      {
        id: 'nav-services',
        type: 'navigation',
        title: 'Ir a Catálogo de Servicios',
        subtitle: 'Precios, duraciones y comisiones',
        icon: 'scissors',
        action: () => this.navigate('/barber/services'),
      },
      {
        id: 'nav-loyalty',
        type: 'navigation',
        title: 'Ir a Fidelización & Sellos',
        subtitle: 'Tarjetas digitales y canje de recompensas',
        badge: `${this.barberService.pendingRewardClaims().length} pendientes`,
        icon: 'gift',
        action: () => this.navigate('/barber/loyalty'),
      },
    ];
  });

  // Clientes filtrados por la búsqueda
  readonly matchedClients = computed<CommandItem[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q || q.length < 2) return [];

    const clients = this.barberService.clients();
    return clients
      .filter((c) => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q)))
      .slice(0, 5)
      .map((c) => {
        const debt = Number(c.currentDebt) || 0;
        return {
          id: `client-${c.id}`,
          type: 'client' as const,
          title: c.name,
          subtitle: `${c.phone || 'Sin teléfono'} • ${c.loyaltyStamps} sellos${debt > 0 ? ' • Debe ' + this.barberService.currencySymbol() + debt.toFixed(2) : ''}`,
          badge: debt > 0 ? 'Deuda' : `${c.loyaltyStamps} ⭐`,
          icon: 'user',
          action: () => {
            this.triggerCut.emit(c.id);
            this.closePalette();
          },
        };
      });
  });

  // Comandos filtrados
  readonly filteredCommands = computed<CommandItem[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const clientItems = this.matchedClients();

    if (!q) {
      return this.baseCommands();
    }

    const filteredBase = this.baseCommands().filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q))
    );

    return [...clientItems, ...filteredBase];
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.searchQuery.set('');
      this.selectedIndex.set(0);
      setTimeout(() => {
        this.searchInputRef?.nativeElement.focus();
      }, 50);
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalKey(event: KeyboardEvent): void {
    if (!this.isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closePalette();
      return;
    }

    const items = this.filteredCommands();
    if (items.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.haptics.selection();
      this.selectedIndex.update((i) => (i + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.haptics.selection();
      this.selectedIndex.update((i) => (i - 1 + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const current = items[this.selectedIndex()];
      if (current) {
        this.haptics.lightTap();
        current.action();
      }
    }
  }

  onSearchChange(val: string): void {
    this.searchQuery.set(val);
    this.selectedIndex.set(0);
  }

  selectIndex(idx: number): void {
    this.selectedIndex.set(idx);
  }

  closePalette(): void {
    this.haptics.lightTap();
    this.closed.emit();
  }

  executeItem(item: CommandItem): void {
    this.haptics.lightTap();
    item.action();
  }

  navigate(url: string): void {
    this.router.navigateByUrl(url);
    this.closePalette();
  }
}
