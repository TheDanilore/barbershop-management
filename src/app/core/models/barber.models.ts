// ==============================================================================
// MODELOS E INTERFACES DE DOMINIO Y SUPABASE PARA BARBERTRACK (CORE)
// ==============================================================================

export type UserRole = 'customer' | 'barber' | 'admin';
export type MembershipTier = 'Bronze' | 'Silver' | 'Gold' | 'VIP';
export type AppointmentStatus = 'pending' | 'confirmed' | 'in-progress' | 'completed' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'credit';

// Tipos reflejo de la base de datos Supabase (PostgreSQL)
export interface ProfileRow {
  id: string; // uuid
  auth_user_id: string | null;
  full_name: string;
  avatar_url: string | null;
  role: UserRole;
  phone: string | null;
  membership_tier: MembershipTier;
  created_at: string;
  is_active: boolean;
}

export interface ServiceRow {
  id: string; // uuid
  name: string;
  base_price: number;
  duration_minutes: number;
  is_active: boolean;
  created_at: string;
}

export interface LoyaltyProgressRow {
  id: string; // uuid
  customer_id: string;
  current_stamps: number;
  total_historical_cuts: number;
  rewards_claimed: number;
  updated_at: string;
}

export interface AppointmentRow {
  id: string; // uuid
  customer_id: string;
  barber_id: string;
  service_id: string;
  scheduled_at: string;
  status: AppointmentStatus;
  created_at: string;
  // Campos resultantes de JOIN de PostgREST
  customer?: { id: string; full_name: string; phone: string | null };
  barber?: { id: string; full_name: string };
  service?: { id: string; name: string; base_price: number; duration_minutes: number };
}

export interface SaleHistoryRow {
  id: string; // uuid
  customer_id: string | null;
  barber_id: string;
  service_id: string;
  appointment_id: string | null;
  final_price: number;
  payment_method: string;
  created_at: string;
  // Campos resultantes de JOIN de PostgREST
  customer?: { id: string; full_name: string; phone: string | null };
  barber?: { id: string; full_name: string };
  service?: { id: string; name: string };
}

export interface ReviewRow {
  id: string; // uuid
  sale_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

// Modelos de Dominio de Alto Nivel para la Vista / UI (Clean Architecture)
export interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
  cutsCount: number;
  loyaltyStamps: number; // 0 a stampsRequired
  membershipLevel: MembershipTier;
  lastVisitDate?: string;
  avatarUrl?: string;
  notes?: string;
  currentDebt?: number;
  creditLimit?: number;
}

export interface Barber {
  id: string;
  name: string;
  specialty: string;
  avatarUrl: string;
  rating: number;
  totalCuts: number;
}

export interface ServiceItem {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  description?: string;
  popular?: boolean;
  isActive?: boolean;
}

export interface CutRecord {
  id: string;
  clientId: string;
  clientName: string;
  barberId: string;
  barberName: string;
  serviceId: string;
  serviceName: string;
  price: number;
  date: string; // ISO string
  paymentMethod: PaymentMethod;
  notes?: string;
}

export interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  barberId: string;
  barberName: string;
  serviceId: string;
  serviceName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  price: number;
  status: AppointmentStatus;
  notes?: string;
}

export interface Review {
  id: string;
  clientName: string;
  barberName: string;
  rating: number;
  comment: string;
  date: string;
}

export interface DashboardKpis {
  cutsToday: number;
  cutsThisMonth: number;
  revenueToday: number;
  revenueThisWeek: number;
  revenueThisMonth: number;
  totalRevenue: number;
  totalCuts: number;
  activeClients: number;
  averageRating: number;
}

export interface BusinessSettings {
  id: string;
  businessName: string;
  currencySymbol: string;
}

export interface AppSetting {
  key: string;
  value: number;
  description?: string;
  updated_at?: string;
}

export type AccountType = 'cash' | 'bank' | 'digital_wallet';

export interface FinancialAccount {
  id: string;
  name: string;
  type: AccountType;
  currentBalance: number;
  isActive: boolean;
  createdAt?: string;
}

export type ShiftStatus = 'open' | 'closed';

export interface CashShift {
  id: string;
  accountId: string;
  barberId: string;
  openedAt: string;
  closedAt?: string | null;
  initialCash: number;
  cashSales: number;
  cashExpenses: number;
  expectedCash: number;
  actualCash?: number | null;
  difference?: number | null;
  status: ShiftStatus;
  notes?: string | null;
  barberName?: string;
}

export type MovementType = 'income' | 'expense' | 'transfer_in' | 'transfer_out';
export type ReferenceType = 'sale' | 'credit_payment' | 'manual' | 'expense' | 'transfer' | 'shift_adjustment';

export interface AccountMovement {
  id: string;
  accountId: string;
  movementType: MovementType;
  amount: number;
  description: string;
  referenceType?: ReferenceType | null;
  referenceId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  shiftId?: string | null;
  accountName?: string;
}

export interface CustomerCredit {
  id: string;
  profileId: string;
  creditLimit: number;
  currentDebt: number;
  isActive: boolean;
  updatedAt: string;
}

export type CreditMovementType = 'CHARGE' | 'PAYMENT';

export interface CustomerCreditMovement {
  id: string;
  customerCreditId: string;
  saleId?: string | null;
  movementType: CreditMovementType;
  amount: number;
  paymentMethod?: string | null;
  notes?: string | null;
  createdAt: string;
  createdBy?: string | null;
}

export interface SystemUser {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  role: UserRole;
  isActive: boolean;
  avatarUrl?: string;
  createdAt?: string;
}


