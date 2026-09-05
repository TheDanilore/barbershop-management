import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BarberDashboardPage } from './barber-dashboard.page';

describe('BarberDashboardPage', () => {
  let component: BarberDashboardPage;
  let fixture: ComponentFixture<BarberDashboardPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BarberDashboardPage],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(BarberDashboardPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
