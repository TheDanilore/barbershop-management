import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { SupabaseService } from '../../../../core/services/supabase.service';

@Component({
  selector: 'app-customer-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './customer-profile.page.html',
  styleUrl: './customer-profile.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerProfilePage implements OnInit {
  readonly barberService = inject(BarberService);
  readonly supabaseService = inject(SupabaseService);
  readonly haptics = inject(HapticsService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly isSaving = signal(false);
  readonly saveSuccess = signal(false);

  // Formulario reactivo
  readonly profileForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(3)]],
    phone: ['', [Validators.required, Validators.pattern(/^[0-9+\s-]{7,15}$/)]],
    email: [{ value: '', disabled: true }],
    preferredStyle: [''],
  });

  readonly currentClient = computed(() => this.barberService.currentClient());

  ngOnInit(): void {
    const client = this.currentClient();
    const userEmail = this.supabaseService.currentUser()?.email || client.email || '';

    this.profileForm.patchValue({
      fullName: client.name,
      phone: client.phone,
      email: userEmail,
      preferredStyle: client.notes || 'Degradado medio, navaja al ras',
    });
  }

  async saveProfile(): Promise<void> {
    if (this.profileForm.invalid || this.isSaving()) {
      this.profileForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    this.isSaving.set(true);
    const { fullName, phone, preferredStyle } = this.profileForm.getRawValue();

    try {
      // 1. Si Supabase está conectado, actualizar profiles en Supabase
      if (this.supabaseService.isConfigured() && this.supabaseService.isAuthenticated) {
        const userId = this.supabaseService.userProfile()?.id;
        if (userId) {
          const { error } = await this.supabaseService.supabase
            .from('profiles')
            .update({
              full_name: fullName.trim(),
              phone: phone.trim(),
            })
            .eq('id', userId);

          if (!error) {
            await this.supabaseService.refreshUserProfile();
          }
        }
      }

      // 2. Actualizar estado local
      const client = this.currentClient();
      client.name = fullName.trim();
      client.phone = phone.trim();
      client.notes = preferredStyle?.trim();

      this.haptics.success();
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 3000);
    } finally {
      this.isSaving.set(false);
    }
  }

  switchToBarber(): void {
    this.haptics.lightTap();
    this.barberService.setRole('barber');
    this.router.navigate(['/barber']);
  }

  logout(): void {
    this.haptics.lightTap();
    this.supabaseService.signOut();
    this.router.navigate(['/login']);
  }
}
