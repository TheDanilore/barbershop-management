import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BarberService } from '../../../../core/services/barber.service';

@Component({
  selector: 'app-loyalty-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loyalty-card.html',
  styleUrl: './loyalty-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoyaltyCard {
  readonly barberService = inject(BarberService);
}
