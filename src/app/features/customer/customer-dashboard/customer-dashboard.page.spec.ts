import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CustomerDashboardPage } from './customer-dashboard.page';

describe('CustomerDashboardPage', () => {
  let component: CustomerDashboardPage;
  let fixture: ComponentFixture<CustomerDashboardPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomerDashboardPage],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomerDashboardPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
