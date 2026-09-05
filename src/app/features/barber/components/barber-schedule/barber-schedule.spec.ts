import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BarberSchedule } from './barber-schedule';

describe('BarberSchedule', () => {
  let component: BarberSchedule;
  let fixture: ComponentFixture<BarberSchedule>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BarberSchedule],
    }).compileComponents();

    fixture = TestBed.createComponent(BarberSchedule);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
