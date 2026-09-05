import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BarberAgenda } from './barber-agenda';

describe('BarberAgenda', () => {
  let component: BarberAgenda;
  let fixture: ComponentFixture<BarberAgenda>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BarberAgenda],
    }).compileComponents();

    fixture = TestBed.createComponent(BarberAgenda);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
