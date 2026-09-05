import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RoleSelectionPage } from './role-selection.page';

describe('RoleSelectionPage', () => {
  let component: RoleSelectionPage;
  let fixture: ComponentFixture<RoleSelectionPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RoleSelectionPage],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(RoleSelectionPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
