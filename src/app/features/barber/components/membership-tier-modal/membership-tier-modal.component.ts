import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
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
import { MembershipTierConfig } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-membership-tier-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './membership-tier-modal.component.html',
  styleUrl: './membership-tier-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MembershipTierModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() tierToEdit: MembershipTierConfig | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // Lista local reactiva de beneficios/perks para edición en tiempo real
  readonly currentPerks = signal<string[]>([]);
  readonly newPerkInput = signal<string>('');

  readonly tierForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    badgeLabel: ['', [Validators.required, Validators.maxLength(40)]],
    minCutsRequired: [0, [Validators.required, Validators.min(0), Validators.max(999)]],
    discountPercentage: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    tagline: ['', [Validators.maxLength(120)]],
    isActive: [true],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      this.newPerkInput.set('');

      if (this.tierToEdit) {
        this.tierForm.reset({
          name: this.tierToEdit.name,
          badgeLabel: this.tierToEdit.badgeLabel || '',
          minCutsRequired: this.tierToEdit.minCutsRequired ?? 0,
          discountPercentage: this.tierToEdit.discountPercentage ?? 0,
          tagline: this.tierToEdit.tagline || '',
          isActive: this.tierToEdit.isActive ?? true,
        });
        this.currentPerks.set([...(this.tierToEdit.perks || [])]);
      }
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  close(): void {
    this.errorMessage.set(null);
    this.haptics.lightTap();
    this.closed.emit();
  }

  addPerk(): void {
    const raw = this.newPerkInput().trim();
    if (!raw) return;
    if (this.currentPerks().length >= 8) {
      this.errorMessage.set('Máximo 8 beneficios por nivel para optimizar la visualización');
      this.haptics.warning();
      return;
    }
    const clean = raw.slice(0, 80);
    this.currentPerks.update((perks) => [...perks, clean]);
    this.newPerkInput.set('');
    this.errorMessage.set(null);
    this.haptics.lightTap();
  }

  removePerk(index: number): void {
    this.currentPerks.update((perks) => perks.filter((_, i) => i !== index));
    this.haptics.lightTap();
  }

  onNewPerkKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.addPerk();
    }
  }

  async submit(): Promise<void> {
    if (this.tierForm.invalid || this.isSubmitting() || !this.tierToEdit) {
      this.tierForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const {
      name,
      badgeLabel,
      minCutsRequired,
      discountPercentage,
      tagline,
      isActive,
    } = this.tierForm.value;

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      await this.barberService.updateMembershipTier(String(this.tierToEdit.id), {
        name: String(name).trim(),
        badgeLabel: String(badgeLabel).trim(),
        minCutsRequired: Math.max(0, Math.floor(Number(minCutsRequired))),
        discountPercentage: Math.max(0, Math.min(100, Number(discountPercentage))),
        tagline: tagline ? String(tagline).trim() : '',
        perks: this.currentPerks(),
        isActive: Boolean(isActive),
      });

      this.haptics.success();
      this.saved.emit(`Nivel "${name}" actualizado con éxito`);
      this.close();
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error al guardar el nivel de membresía');
    } finally {
      this.isSubmitting.set(false);
    }
  }

  getTierIcon(id: string | undefined): string {
    switch (id) {
      case 'VIP': return '👑';
      case 'Gold': return '🥇';
      case 'Silver': return '🥈';
      default: return '🥉';
    }
  }
}
