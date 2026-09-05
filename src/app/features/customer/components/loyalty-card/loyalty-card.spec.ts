import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoyaltyCard } from './loyalty-card';

describe('LoyaltyCard', () => {
  let component: LoyaltyCard;
  let fixture: ComponentFixture<LoyaltyCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoyaltyCard],
    }).compileComponents();

    fixture = TestBed.createComponent(LoyaltyCard);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
