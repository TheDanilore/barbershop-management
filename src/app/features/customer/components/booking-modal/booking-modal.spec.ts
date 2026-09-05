import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BookingModal } from './booking-modal';

describe('BookingModal', () => {
  let component: BookingModal;
  let fixture: ComponentFixture<BookingModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookingModal],
    }).compileComponents();

    fixture = TestBed.createComponent(BookingModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
