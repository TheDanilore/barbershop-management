import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BarberMetrics } from './barber-metrics';

describe('BarberMetrics', () => {
  let component: BarberMetrics;
  let fixture: ComponentFixture<BarberMetrics>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BarberMetrics],
    }).compileComponents();

    fixture = TestBed.createComponent(BarberMetrics);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
