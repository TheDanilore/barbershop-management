import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { SupabaseService } from '../../../../core/services/supabase.service';

@Component({
  selector: 'app-barber-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './barber-profile.page.html',
  styleUrl: './barber-profile.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarberProfilePage {
  readonly supabaseService = inject(SupabaseService);
  readonly barberService = inject(BarberService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly isEditingProfile = signal(false);
  readonly isSubmitting = signal(false);
  readonly toastMessage = signal<string | null>(null);
  private toastTimeout: any = null;

  readonly profileForm = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    phone: [''],
  });

  openEditProfile(): void {
    this.haptics.lightTap();
    const profile = this.supabaseService.userProfile();
    this.profileForm.reset({
      fullName: profile?.full_name || '',
      phone: profile?.phone || '',
    });
    this.isEditingProfile.set(true);
  }

  cancelEditProfile(): void {
    this.haptics.lightTap();
    this.isEditingProfile.set(false);
  }

  async submitProfile(): Promise<void> {
    if (this.profileForm.invalid || this.isSubmitting()) {
      this.profileForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const { fullName, phone } = this.profileForm.value;
    this.isSubmitting.set(true);

    try {
      const profile = this.supabaseService.userProfile();
      if (profile && this.supabaseService.isConfigured()) {
        const { error } = await this.supabaseService.supabase
          .from('profiles')
          .update({
            full_name: fullName?.trim(),
            phone: phone?.trim() || null,
          })
          .eq('id', profile.id);

        if (!error) {
          await this.supabaseService.refreshUserProfile();
          await this.barberService.syncFromSupabase();
          this.haptics.success();
          this.isEditingProfile.set(false);
          this.showToast('✅ Perfil actualizado con éxito');
        } else {
          this.haptics.warning();
          this.showToast('Error al actualizar perfil en la base de datos');
        }
      } else {
        this.showToast('Sin conexión a Supabase — cambios locales');
        this.isEditingProfile.set(false);
      }
    } catch {
      this.haptics.warning();
      this.showToast('Error inesperado al guardar el perfil');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  logout(): void {
    this.haptics.lightTap();
    this.supabaseService.signOut();
    this.router.navigate(['/login']);
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

  getRoleLabel(role?: string): string {
    switch (role) {
      case 'admin':
        return 'Administrador';
      case 'barber':
        return 'Barbero / Estilista';
      case 'customer':
        return 'Cliente';
      default:
        return 'Usuario Autorizado';
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
