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
import { Client } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-new-client-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './new-client-modal.component.html',
  styleUrl: './new-client-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewClientModalComponent implements OnChanges {
  private readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() clientToEdit: Client | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() clientCreated = new EventEmitter<Client>();
  @Output() clientUpdated = new EventEmitter<Client>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly clientForm: FormGroup = this.fb.group({
    fullName: [
      '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(80)],
    ],
    phone: ['', [Validators.pattern(/^[+0-9\s-]{7,20}$/)]],
    notes: [''],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['isOpen'] && this.isOpen) || changes['clientToEdit']) {
      this.errorMessage.set(null);
      if (this.clientToEdit) {
        this.clientForm.reset({
          fullName: this.clientToEdit.name,
          phone: this.clientToEdit.phone || '',
          notes: this.clientToEdit.notes || '',
        });
      } else {
        this.clientForm.reset({ fullName: '', phone: '', notes: '' });
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
    this.haptics.lightTap();
    this.closed.emit();
  }

  async submit(): Promise<void> {
    if (this.clientForm.invalid || this.isSubmitting()) {
      this.clientForm.markAllAsTouched();
      this.haptics.warning();
      this.errorMessage.set('Ingresa un nombre válido para el cliente');
      return;
    }

    const { fullName, phone, notes } = this.clientForm.value;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const cleanName = (fullName || '').trim();
      const cleanPhone = phone ? phone.trim() : '';

      if (this.clientToEdit) {
        const updated = await this.barberService.updateClient(this.clientToEdit.id, {
          name: cleanName,
          phone: cleanPhone,
          notes: notes ? notes.trim() : undefined,
        });

        this.haptics.success();
        this.clientUpdated.emit(updated);
        this.close();
      } else {
        const newClient = await this.barberService.createClient(
          cleanName,
          cleanPhone,
          undefined,
          notes ? notes.trim() : undefined
        );

        this.haptics.success();
        this.clientCreated.emit(newClient);
        this.close();
      }
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error al procesar el cliente');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
