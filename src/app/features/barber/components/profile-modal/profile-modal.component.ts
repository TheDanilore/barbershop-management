import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { SupabaseService } from '../../../../core/services/supabase.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-profile-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './profile-modal.component.html',
  styleUrl: './profile-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileModalComponent implements OnChanges {
  readonly supabaseService = inject(SupabaseService);
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() profile: { full_name?: string | null; phone?: string | null; email?: string | null } | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly profileForm: FormGroup = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(70)]],
    phone: ['', [Validators.pattern(/^\+?[0-9\s-]{7,15}$/)]],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      this.profileForm.reset({
        fullName: this.profile?.full_name || '',
        phone: this.profile?.phone || '',
      });
    }
  }

  close(): void {
    this.haptics.lightTap();
    this.closed.emit();
  }

  async submit(): Promise<void> {
    if (this.profileForm.invalid || this.isSubmitting()) {
      this.profileForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const { fullName, phone } = this.profileForm.value;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const current = this.supabaseService.userProfile();
      if (current && this.supabaseService.isConfigured()) {
        const { error } = await this.supabaseService.supabase
          .from('profiles')
          .update({
            full_name: fullName?.trim(),
            phone: phone?.trim() || null,
          })
          .eq('id', current.id);

        if (!error) {
          await this.supabaseService.refreshUserProfile();
          await this.barberService.syncFromSupabase();
          this.haptics.success();
          this.saved.emit('✅ Perfil actualizado con éxito');
          this.close();
        } else {
          this.haptics.warning();
          this.errorMessage.set('Error al actualizar el perfil en la base de datos');
        }
      } else {
        this.saved.emit('⚠️ Sin conexión a Supabase — cambios en modo local');
        this.close();
      }
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error inesperado al guardar el perfil');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
