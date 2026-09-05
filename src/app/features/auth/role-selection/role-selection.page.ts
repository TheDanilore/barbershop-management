import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BarberService } from '../../../core/services/barber.service';
import { HapticsService } from '../../../core/services/haptics.service';

@Component({
  selector: 'app-role-selection',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './role-selection.page.html',
  styleUrl: './role-selection.page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleSelectionPage {
  private readonly router = inject(Router);
  private readonly haptics = inject(HapticsService);
  private readonly barberService = inject(BarberService);

  selectRole(role: 'barber' | 'customer'): void {
    this.haptics.lightTap();
    this.barberService.setRole(role === 'customer' ? 'client' : 'barber');
    this.router.navigate(['/' + role]);
  }
}
