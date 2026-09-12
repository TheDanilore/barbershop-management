import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { SystemUser, UserRole } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { UserModalComponent } from '../../components/user-modal/user-modal.component';

@Component({
  selector: 'app-barber-users',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, UserModalComponent],
  templateUrl: './barber-users.page.html',
  styleUrl: './barber-users.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberUsersPage {
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('searchInput') searchInputElement?: ElementRef<HTMLInputElement>;

  // Filters & State
  readonly searchTerm = signal('');
  readonly roleFilter = signal<'all' | 'admin' | 'barber' | 'customer'>('all');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  readonly viewMode = signal<'grid' | 'table'>('grid');
  readonly isUserModalOpen = signal(false);
  readonly editingUser = signal<SystemUser | null>(null);
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
        this.toastTimeout = null;
      }
    });
  }

  // --- Executive KPI Computeds ---
  readonly totalUsersCount = computed(() => this.barberService.systemUsers().length);

  readonly activeBarbersCount = computed(() =>
    this.barberService.systemUsers().filter((u) => u.role === 'barber' && u.isActive).length
  );

  readonly totalBarbersCount = computed(() =>
    this.barberService.systemUsers().filter((u) => u.role === 'barber').length
  );

  readonly adminsCount = computed(() =>
    this.barberService.systemUsers().filter((u) => u.role === 'admin').length
  );

  readonly pausedCount = computed(() =>
    this.barberService.systemUsers().filter((u) => !u.isActive).length
  );

  readonly customersCount = computed(() =>
    this.barberService.systemUsers().filter((u) => u.role === 'customer').length
  );

  // --- Filtered Users List ---
  readonly filteredUsers = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const role = this.roleFilter();
    const status = this.statusFilter();

    return this.barberService.systemUsers().filter((u) => {
      const matchRole = role === 'all' || u.role === role;
      const matchStatus =
        status === 'all' ||
        (status === 'active' && u.isActive) ||
        (status === 'inactive' && !u.isActive);

      const matchTerm =
        !term ||
        u.fullName.toLowerCase().includes(term) ||
        (u.phone && u.phone.toLowerCase().includes(term)) ||
        (u.email && u.email.toLowerCase().includes(term));

      return matchRole && matchStatus && matchTerm;
    });
  });

  // --- Global Keyboard Shortcuts (Power User) ---
  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (this.isUserModalOpen()) return;

    if (event.altKey && (event.key === 'u' || event.key === 'U' || event.key === 'n' || event.key === 'N')) {
      event.preventDefault();
      this.openCreateUserModal();
    } else if (event.key === '/' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      this.focusSearch();
    } else if (event.key === 'Escape' && this.searchTerm()) {
      event.preventDefault();
      this.clearSearch();
    }
  }

  focusSearch(): void {
    this.searchInputElement?.nativeElement.focus();
    this.searchInputElement?.nativeElement.select();
  }

  clearSearch(): void {
    this.searchTerm.set('');
    this.haptics.lightTap();
  }

  setViewMode(mode: 'grid' | 'table'): void {
    this.haptics.lightTap();
    this.viewMode.set(mode);
  }

  setRoleFilter(role: 'all' | 'admin' | 'barber' | 'customer'): void {
    this.haptics.lightTap();
    this.roleFilter.set(role);
  }

  setStatusFilter(status: 'all' | 'active' | 'inactive'): void {
    this.haptics.lightTap();
    this.statusFilter.set(status);
  }

  openCreateUserModal(): void {
    this.haptics.lightTap();
    this.editingUser.set(null);
    this.isUserModalOpen.set(true);
  }

  openEditUserModal(user: SystemUser): void {
    this.haptics.lightTap();
    this.editingUser.set(user);
    this.isUserModalOpen.set(true);
  }

  closeUserModal(): void {
    this.isUserModalOpen.set(false);
    this.editingUser.set(null);
  }

  async toggleUserStatus(user: SystemUser, event?: Event): Promise<void> {
    if (event) {
      event.stopPropagation();
    }
    const nextState = !user.isActive;
    try {
      await this.barberService.toggleSystemUserStatus(user.id, nextState);
      this.haptics.lightTap();
      this.showToast(nextState ? `Usuario "${user.fullName}" activado` : `Acceso pausado para "${user.fullName}"`);
    } catch (err: any) {
      this.haptics.warning();
      this.showToast('Error al actualizar estado del usuario');
    }
  }

  getCleanPhone(phone?: string): string {
    if (!phone) return '';
    return phone.replace(/[^0-9+]/g, '');
  }

  openWhatsApp(phone?: string, event?: Event): void {
    if (event) event.stopPropagation();
    const clean = this.getCleanPhone(phone);
    if (!clean) return;
    const cleanNumber = clean.replace('+', '');
    window.open(`https://wa.me/${cleanNumber}`, '_blank', 'noopener,noreferrer');
    this.haptics.lightTap();
  }

  copyPhone(phone?: string, event?: Event): void {
    if (event) event.stopPropagation();
    if (!phone) return;
    navigator.clipboard?.writeText(phone);
    this.haptics.lightTap();
    this.showToast(`Teléfono ${phone} copiado al portapapeles`);
  }

  getInitials(name: string): string {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  formatDate(isoDate?: string): string {
    if (!isoDate) return 'Reciente';
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return isoDate;
    }
  }

  showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set(null);
    }, 3500);
  }
}
