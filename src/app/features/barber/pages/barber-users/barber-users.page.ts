import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SystemUser } from '../../../../core/models/barber.models';
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

  // Filters & State
  readonly searchTerm = signal('');
  readonly roleFilter = signal<'all' | 'admin' | 'barber'>('all');
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

  readonly filteredUsers = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const role = this.roleFilter();
    return this.barberService.systemUsers().filter((u) => {
      const matchRole = role === 'all' || u.role === role;
      const matchTerm =
        !term ||
        u.fullName.toLowerCase().includes(term) ||
        (u.phone && u.phone.toLowerCase().includes(term)) ||
        (u.email && u.email.toLowerCase().includes(term));
      return matchRole && matchTerm;
    });
  });

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

  async toggleUserStatus(user: SystemUser): Promise<void> {
    const nextState = !user.isActive;
    try {
      await this.barberService.toggleSystemUserStatus(user.id, nextState);
      this.haptics.lightTap();
      this.showToast(nextState ? `Usuario ${user.fullName} activado` : `Usuario ${user.fullName} pausado`);
    } catch (err: any) {
      this.haptics.warning();
      this.showToast('Error al actualizar estado del usuario');
    }
  }

  setRoleFilter(role: 'all' | 'admin' | 'barber'): void {
    this.haptics.lightTap();
    this.roleFilter.set(role);
  }

  formatDate(isoDate: string): string {
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
