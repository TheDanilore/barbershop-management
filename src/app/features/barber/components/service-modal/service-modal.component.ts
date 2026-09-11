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
import { ServiceItem } from '../../../../core/models/barber.models';
import { BarberService } from '../../../../core/services/barber.service';
import { HapticsService } from '../../../../core/services/haptics.service';
import { BottomSheetDirective } from '../../../../shared/directives/bottom-sheet.directive';

@Component({
  selector: 'app-service-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, BottomSheetDirective],
  templateUrl: './service-modal.component.html',
  styleUrl: './service-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServiceModalComponent implements OnChanges {
  readonly barberService = inject(BarberService);
  private readonly haptics = inject(HapticsService);
  private readonly fb = inject(FormBuilder);

  @Input() isOpen = false;
  @Input() serviceToEdit: ServiceItem | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<string>();

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly serviceForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    price: [15, [Validators.required, Validators.min(0.5)]],
    durationMinutes: [30, [Validators.required, Validators.min(5)]],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.errorMessage.set(null);
      if (this.serviceToEdit) {
        this.serviceForm.reset({
          name: this.serviceToEdit.name,
          price: this.serviceToEdit.price,
          durationMinutes: this.serviceToEdit.durationMinutes,
        });
      } else {
        this.serviceForm.reset({
          name: '',
          price: 15,
          durationMinutes: 30,
        });
      }
    }
  }

  close(): void {
    this.haptics.lightTap();
    this.closed.emit();
  }

  async submit(): Promise<void> {
    if (this.serviceForm.invalid || this.isSubmitting()) {
      this.serviceForm.markAllAsTouched();
      this.haptics.warning();
      return;
    }

    const { name, price, durationMinutes } = this.serviceForm.value;
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      if (this.serviceToEdit) {
        await this.barberService.updateService(
          this.serviceToEdit.id,
          name.trim(),
          Number(price),
          Number(durationMinutes),
          this.serviceToEdit.isActive ?? true
        );
        this.haptics.success();
        this.saved.emit('Servicio actualizado con éxito');
      } else {
        await this.barberService.createService(
          name.trim(),
          Number(price),
          Number(durationMinutes)
        );
        this.haptics.success();
        this.saved.emit('Nuevo servicio creado');
      }
      this.close();
    } catch (err: any) {
      this.haptics.warning();
      this.errorMessage.set(err?.message || 'Error al guardar el servicio');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
