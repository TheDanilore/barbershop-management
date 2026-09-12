import { Injectable, computed, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { SupabaseService } from './supabase.service';
import {
  getLocalDateString,
  getLocalTimeString,
  isPastDateTime,
  isDateInPast,
  getLocalDateFromIso,
  isSameLocalDate,
  isSameLocalYearMonth,
  isDateWithinPastDays,
} from '../utils/date.utils';
import {
  AccountMovement,
  AccountType,
  Appointment,
  AppointmentRow,
  AppointmentServiceItem,
  AppointmentStatus,
  Barber,
  BusinessSettings,
  CashShift,
  Client,
  CustomerCredit,
  CustomerCreditMovement,
  CutRecord,
  DashboardKpis,
  FinancialAccount,
  LoyaltyReward,
  LoyaltyRewardClaim,
  MembershipTier,
  MovementType,
  Order,
  OrderItem,
  PaymentMethod,
  ReferenceType,
  Review,
  SaleHistoryRow,
  ServiceItem,
  SystemUser,
  UserRole,
} from '../models/barber.models';

const STORAGE_KEYS = {
  CLIENTS: 'barbertrack_clients',
  CUTS: 'barbertrack_cuts',
  APPOINTMENTS: 'barbertrack_appointments',
  SERVICES: 'barbertrack_services',
  REVIEWS: 'barbertrack_reviews',
  ROLE: 'barbertrack_role',
  CURRENT_CLIENT_ID: 'barbertrack_current_client_id',
  FINANCIAL_ACCOUNTS: 'barbertrack_financial_accounts',
  CASH_SHIFTS: 'barbertrack_cash_shifts',
  ACCOUNT_MOVEMENTS: 'barbertrack_account_movements',
  BUSINESS_SETTINGS: 'barbertrack_business_settings',
  APP_SETTINGS: 'barbertrack_app_settings',
};

/** Mapeo bidireccional estricto entre Enums de TypeScript y PostgreSQL (public.appointment_status) */
export function toDbAppointmentStatus(status: AppointmentStatus): 'confirmed' | 'in_progress' | 'completed' | 'cancelled' {
  if (status === 'in-progress') return 'in_progress';
  if (status === 'pending') return 'confirmed';
  return status;
}

export function fromDbAppointmentStatus(status: string): AppointmentStatus {
  if (status === 'in_progress') return 'in-progress';
  return (status as AppointmentStatus) || 'confirmed';
}

const INITIAL_ACCOUNTS: FinancialAccount[] = [
  { id: 'acc-cash', name: 'Caja Principal (Efectivo)', type: 'cash', currentBalance: 0.0, isActive: true },
  { id: 'acc-bank', name: 'Cuenta Banco / POS Tarjetas', type: 'bank', currentBalance: 0.0, isActive: true },
  { id: 'acc-digital', name: 'Billetera Digital (Yape / Plin)', type: 'digital_wallet', currentBalance: 0.0, isActive: true },
];

const DEFAULT_KPIS: DashboardKpis = {
  cutsToday: 0,
  cutsThisMonth: 0,
  revenueToday: 0,
  revenueThisWeek: 0,
  revenueThisMonth: 0,
  totalRevenue: 0,
  totalCuts: 0,
  activeClients: 0,
  averageRating: 5.0,
};

const INITIAL_SERVICES: ServiceItem[] = [];
const INITIAL_BARBERS: Barber[] = [];
const INITIAL_CLIENTS: Client[] = [];
const INITIAL_CUTS: CutRecord[] = [];
const INITIAL_APPOINTMENTS: Appointment[] = [];
const INITIAL_REVIEWS: Review[] = [];

@Injectable({
  providedIn: 'root',
})
export class BarberService {
  private readonly supabaseService = inject(SupabaseService);
  private readonly logger = inject(LoggerService);

  // Estados reactivos gobernados por Signals
  readonly currentRole = signal<'landing' | 'barber' | 'client'>(this.loadRole());
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  readonly clients = signal<Client[]>(this.loadFromStorage(STORAGE_KEYS.CLIENTS, INITIAL_CLIENTS));
  readonly services = signal<ServiceItem[]>(this.loadFromStorage(STORAGE_KEYS.SERVICES, INITIAL_SERVICES));
  readonly barbers = signal<Barber[]>(INITIAL_BARBERS);
  readonly cuts = signal<CutRecord[]>(this.loadFromStorage(STORAGE_KEYS.CUTS, INITIAL_CUTS));
  readonly appointments = signal<Appointment[]>(this.loadFromStorage(STORAGE_KEYS.APPOINTMENTS, INITIAL_APPOINTMENTS));
  readonly reviews = signal<Review[]>(this.loadFromStorage(STORAGE_KEYS.REVIEWS, INITIAL_REVIEWS));
  readonly serverKpis = signal<DashboardKpis | null>(null);
  readonly systemUsers = signal<SystemUser[]>([]);

  // Modal global centralizado de Agendar Cita (Creación y Edición)
  readonly isBookingModalOpen = signal<boolean>(false);
  readonly bookingModalDate = signal<string>(getLocalDateString());
  readonly bookingModalTime = signal<string>('10:00');
  readonly bookingModalAppointmentToEdit = signal<Appointment | null>(null);

  openBookingModal(date?: string, time?: string, appointmentToEdit?: Appointment | null): void {
    if (appointmentToEdit) {
      this.bookingModalAppointmentToEdit.set(appointmentToEdit);
      this.bookingModalDate.set(appointmentToEdit.date);
      this.bookingModalTime.set(appointmentToEdit.time);
    } else {
      this.bookingModalAppointmentToEdit.set(null);
      const today = getLocalDateString();
      const targetDate = date && !isDateInPast(date) ? date : today;
      this.bookingModalDate.set(targetDate);

      // Si se proporcionó un horario válido en el futuro, usarlo; de lo contrario buscar el primer futuro
      if (time && !isPastDateTime(targetDate, time)) {
        this.bookingModalTime.set(time);
      } else {
        const standardSlots = [
          '08:30', '09:15', '10:00', '10:45', '11:30', '12:15',
          '14:00', '14:45', '15:30', '16:15', '17:00', '17:45',
          '18:30', '19:15', '20:00',
        ];
        const nextSlot = standardSlots.find((slot) => !isPastDateTime(targetDate, slot)) || standardSlots[0];
        this.bookingModalTime.set(nextSlot);
      }
    }
    this.isBookingModalOpen.set(true);
  }

  closeBookingModal(): void {
    this.isBookingModalOpen.set(false);
    this.bookingModalAppointmentToEdit.set(null);
  }

  // Estado reactivo de carga específico de citas/agenda (Evita flickers de estado vacío)
  readonly isAppointmentsLoading = signal<boolean>(false);

  // Modal global centralizado de Cobro Express POS (Venta y checkout seguro de citas)
  readonly isRegisterCutModalOpen = signal<boolean>(false);
  readonly registerCutModalInitialData = signal<{
    clientId?: string;
    barberId?: string;
    serviceIds?: string[];
    customPrice?: number | null;
    notes?: string;
    appointmentId?: string;
  } | null>(null);

  openRegisterCutModal(initialData?: {
    clientId?: string;
    barberId?: string;
    serviceIds?: string[];
    customPrice?: number | null;
    notes?: string;
    appointmentId?: string;
  }): void {
    this.registerCutModalInitialData.set(initialData || null);
    this.isRegisterCutModalOpen.set(true);
  }

  closeRegisterCutModal(): void {
    this.isRegisterCutModalOpen.set(false);
    this.registerCutModalInitialData.set(null);
  }

  // Modal global centralizado de Abono de Deuda (Cuentas por Cobrar / Fiados)
  readonly isDebtPaymentModalOpen = signal<boolean>(false);
  readonly debtPaymentModalClient = signal<Client | null>(null);

  openDebtPaymentModal(client: Client): void {
    this.debtPaymentModalClient.set(client);
    this.isDebtPaymentModalOpen.set(true);
  }

  closeDebtPaymentModal(): void {
    this.isDebtPaymentModalOpen.set(false);
    this.debtPaymentModalClient.set(null);
  }

  // Loyalty Rewards System (0..N premios configurables)
  readonly loyaltyRewards = signal<LoyaltyReward[]>([]);
  readonly pendingRewardClaims = signal<LoyaltyRewardClaim[]>([]);

  // Próximo hito de fidelización que el cliente actual aún no ha alcanzado
  readonly nextLoyaltyMilestone = computed<LoyaltyReward | null>(() => {
    const stamps = this.currentClient().loyaltyStamps;
    const active = this.loyaltyRewards().filter((r) => r.isActive);
    if (!active.length) return null;
    return (
      active
        .filter((r) => r.stampsRequired > stamps)
        .sort((a, b) => a.stampsRequired - b.stampsRequired)[0] ?? null
    );
  });

  // Configuración dinámica de negocio y aplicación
  readonly businessSettings = signal<BusinessSettings>(
    this.loadFromStorage(STORAGE_KEYS.BUSINESS_SETTINGS, {
      id: 'default',
      businessName: 'BarberTrack PRO',
      currencySymbol: 'S/',
      loyaltyMode: 'per_service',
    })
  );

  // Prefijo / Símbolo de moneda oficial reactivo en toda la PWA
  readonly currencySymbol = computed<string>(() => this.businessSettings().currencySymbol || 'S/');

  // Modo de acumulación de sellos de fidelización: 'per_service' (por servicio realizado) o 'per_visit' (1 por cita/ticket)
  readonly loyaltyMode = computed<'per_visit' | 'per_service'>(() => this.businessSettings().loyaltyMode || 'per_service');

  readonly appSettings = signal<Record<string, number>>(
    this.loadFromStorage(STORAGE_KEYS.APP_SETTINGS, { stamps_required: 10 })
  );

  readonly stampsRequired = computed(() => this.appSettings()['stamps_required'] ?? 10);

  // Módulo Financiero
  readonly financialAccounts = signal<FinancialAccount[]>(
    this.loadFromStorage(STORAGE_KEYS.FINANCIAL_ACCOUNTS, INITIAL_ACCOUNTS)
  );
  readonly activeCashShift = signal<CashShift | null>(null);
  readonly accountMovements = signal<AccountMovement[]>(
    this.loadFromStorage(STORAGE_KEYS.ACCOUNT_MOVEMENTS, [])
  );

  readonly currentClientId = signal<string>(this.loadFromStorage(STORAGE_KEYS.CURRENT_CLIENT_ID, 'cli-1'));

  // Cliente activo computado ligado al perfil real o fallback a demo
  readonly currentClient = computed<Client>(() => {
    const profile = this.supabaseService.userProfile();
    if (profile) {
      const found = this.clients().find(
        (c) => c.id === profile.id || (profile.auth_user_id && c.id === profile.auth_user_id)
      );
      if (found) return found;

      return {
        id: profile.id,
        name: profile.full_name || 'Mi Perfil',
        phone: profile.phone || '',
        email: this.supabaseService.currentUser()?.email || '',
        cutsCount: 0,
        loyaltyStamps: 0,
        membershipLevel: (profile.membership_tier as any) || 'Bronze',
      };
    }

    const found = this.clients().find((c) => c.id === this.currentClientId());
    return (
      found ||
      this.clients()[0] || {
        id: '',
        name: 'Cliente General',
        phone: '',
        cutsCount: 0,
        loyaltyStamps: 0,
        membershipLevel: 'Bronze',
      }
    );
  });

  // Métricas reactivas consolidadas — Fechas locales deterministas sin desfases UTC
  readonly cutsToday = computed(() => {
    const todayStr = getLocalDateString();
    const localCutsToday = this.cuts().filter((c) => isSameLocalDate(c.date, todayStr)).length;
    if (this.serverKpis()) {
      return Math.max(this.serverKpis()!.cutsToday, localCutsToday);
    }
    return localCutsToday;
  });

  readonly cutsThisMonth = computed(() => {
    const currentYearMonth = getLocalDateString().slice(0, 7);
    const localCutsMonth = this.cuts().filter((c) => isSameLocalYearMonth(c.date, currentYearMonth)).length;
    if (this.serverKpis()) {
      return Math.max(this.serverKpis()!.cutsThisMonth, localCutsMonth);
    }
    return localCutsMonth;
  });

  // Ventas Brutas / Producción del Día (Contado + Crédito/Fiado)
  readonly productionToday = computed(() => {
    const todayStr = getLocalDateString();
    return this.cuts()
      .filter((c) => isSameLocalDate(c.date, todayStr))
      .reduce((sum, c) => sum + (Number(c.price) || 0), 0);
  });

  // Recaudación Efectiva Cobrada Hoy (Cortes al Contado + Abonos de Deuda recibidos hoy)
  readonly collectedToday = computed(() => {
    const todayStr = getLocalDateString();
    const cashFromCuts = this.cuts()
      .filter((c) => isSameLocalDate(c.date, todayStr) && c.paymentMethod !== 'credit')
      .reduce((sum, c) => sum + (Number(c.price) || 0), 0);

    const debtPayments = this.accountMovements()
      .filter((m) => isSameLocalDate(m.createdAt, todayStr) && m.movementType === 'income' && m.referenceType === 'credit_payment')
      .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

    return cashFromCuts + debtPayments;
  });

  // Recaudación en Caja de Hoy (Compatible con llamadas existentes)
  readonly revenueToday = computed(() => {
    const localCollected = this.collectedToday();
    if (this.serverKpis()) {
      return Math.max(this.serverKpis()!.revenueToday, localCollected);
    }
    return localCollected;
  });

  readonly revenueThisWeek = computed(() => {
    const localWeek = this.cuts()
      .filter((c) => isDateWithinPastDays(c.date, 7))
      .reduce((sum, c) => sum + (Number(c.price) || 0), 0);
    if (localWeek > 0) return localWeek;
    if (this.serverKpis()) return this.serverKpis()!.revenueThisWeek;
    return 0;
  });

  readonly revenueThisMonth = computed(() => {
    const currentYearMonth = getLocalDateString().slice(0, 7);
    const localMonthRevenue = this.cuts()
      .filter((c) => isSameLocalYearMonth(c.date, currentYearMonth))
      .reduce((sum, c) => sum + (Number(c.price) || 0), 0);
    if (localMonthRevenue > 0) return localMonthRevenue;
    if (this.serverKpis()) return this.serverKpis()!.revenueThisMonth;
    return 0;
  });

  // Facturación Total / Producción Acumulada
  readonly totalProduction = computed(() => {
    const localTotal = this.cuts().reduce((sum, c) => sum + (Number(c.price) || 0), 0);
    if (this.serverKpis()) {
      return Math.max(this.serverKpis()!.totalRevenue, localTotal);
    }
    return localTotal;
  });

  // Alias compatible para totalRevenue
  readonly totalRevenue = computed(() => this.totalProduction());

  // Cartera Total por Cobrar (Deuda acumulada de clientes)
  readonly totalReceivableDebt = computed(() => {
    return this.clients().reduce((sum, c) => sum + (Number(c.currentDebt) || 0), 0);
  });

  // Saldo total consolidado en todas las cuentas financieras activas (Tesorería / Liquidez)
  readonly totalFinancialBalance = computed(() => {
    return this.financialAccounts()
      .filter((a) => a.isActive)
      .reduce((sum, a) => sum + (Number(a.currentBalance) || 0), 0);
  });

  // Saldo específico en caja de efectivo (efectivo físico en gaveta)
  readonly cashDrawerBalance = computed(() => {
    const cashAcc = this.financialAccounts().find((a) => a.type === 'cash' && a.isActive);
    return cashAcc ? Number(cashAcc.currentBalance) || 0 : 0;
  });

  // Función auxiliar para agregar estadísticas de servicios a partir de un listado de cortes
  calculateTopServicesFromCuts(cutsList: CutRecord[]): Array<{
    id: string;
    name: string;
    price: number;
    count: number;
    revenue: number;
    percentage: number;
  }> {
    const allServices = this.services();
    const countsMap = new Map<string, { id: string; name: string; price: number; count: number; revenue: number }>();

    // Inicializar con todos los servicios del catálogo para que aparezcan aunque tengan 0 cortes
    for (const s of allServices) {
      countsMap.set(s.id, { id: s.id, name: s.name, price: s.price, count: 0, revenue: 0 });
    }

    for (const cut of cutsList) {
      // 1. Si la orden contiene líneas de detalle (Multi-servicio / Combo)
      if (cut.items && cut.items.length > 0) {
        const subtotalSum = cut.items.reduce(
          (acc, it) => acc + (it.subtotal || it.unitPrice * (it.quantity || 1)),
          0
        );
        // Si hubo un precio personalizado / descuento global, prorratear el revenue
        const ratio = subtotalSum > 0 ? cut.price / subtotalSum : 1;

        for (const item of cut.items) {
          const qty = item.quantity || 1;
          const itemRevenue = (item.subtotal || item.unitPrice * qty) * ratio;

          // Buscar coincidencia por serviceId
          let target = item.serviceId ? countsMap.get(item.serviceId) : undefined;
          if (!target) {
            // Buscar por nombre de servicio (tolerancia a mayúsculas/minúsculas y sincronización)
            const matchedSrv = allServices.find(
              (s) => s.name.trim().toLowerCase() === (item.itemName || '').trim().toLowerCase()
            );
            if (matchedSrv) {
              target = countsMap.get(matchedSrv.id);
            }
          }

          if (target) {
            target.count += qty;
            target.revenue += itemRevenue;
          } else {
            // Si es un servicio histórico
            const key = item.serviceId || item.itemName || 'srv-extra';
            const existing = countsMap.get(key);
            if (existing) {
              existing.count += qty;
              existing.revenue += itemRevenue;
            } else {
              countsMap.set(key, {
                id: key,
                name: item.itemName || 'Servicio',
                price: item.unitPrice || 0,
                count: qty,
                revenue: itemRevenue,
              });
            }
          }
        }
      } else {
        // 2. Fallback para órdenes unitarias o históricas sin items[]
        let target = cut.serviceId ? countsMap.get(cut.serviceId) : undefined;
        if (!target) {
          const matchedSrv = allServices.find(
            (s) => s.name.trim().toLowerCase() === (cut.serviceName || '').trim().toLowerCase()
          );
          if (matchedSrv) {
            target = countsMap.get(matchedSrv.id);
          }
        }

        if (target) {
          target.count += 1;
          target.revenue += cut.price;
        } else {
          const fallbackKey = cut.serviceId || cut.serviceName || 'srv-fallback';
          countsMap.set(fallbackKey, {
            id: fallbackKey,
            name: cut.serviceName || 'Servicio',
            price: cut.price,
            count: 1,
            revenue: cut.price,
          });
        }
      }
    }

    const list = Array.from(countsMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.revenue - a.revenue;
    });

    const maxCount = Math.max(...list.map((l) => l.count), 1);

    return list.map((item) => ({
      ...item,
      percentage: item.count > 0 ? Math.round((item.count / maxCount) * 100) : 0,
    }));
  }

  // Servicios más solicitados computados reactivamente desde el historial completo
  readonly topRequestedServices = computed(() => {
    return this.calculateTopServicesFromCuts(this.cuts());
  });

  // Ranking de servicios más solicitados según período de tiempo
  getTopServicesByPeriod(period: 'today' | 'week' | 'month' | '6months' | 'year' | 'all'): Array<{
    id: string;
    name: string;
    price: number;
    count: number;
    revenue: number;
    percentage: number;
  }> {
    const allCuts = this.cuts();
    const now = new Date();
    const todayStr = getLocalDateString(now);

    let filteredCuts: CutRecord[] = [];
    switch (period) {
      case 'today':
        filteredCuts = allCuts.filter((c) => isSameLocalDate(c.date, todayStr));
        break;
      case 'week':
        filteredCuts = allCuts.filter((c) => isDateWithinPastDays(c.date, 7, now));
        break;
      case 'month':
        filteredCuts = allCuts.filter((c) => isDateWithinPastDays(c.date, 30, now));
        break;
      case '6months':
        filteredCuts = allCuts.filter((c) => isDateWithinPastDays(c.date, 180, now));
        break;
      case 'year':
        filteredCuts = allCuts.filter((c) => isDateWithinPastDays(c.date, 365, now));
        break;
      case 'all':
      default:
        filteredCuts = allCuts;
        break;
    }

    return this.calculateTopServicesFromCuts(filteredCuts);
  }

  readonly activeClientsCount = computed(() => {
    if (this.serverKpis()) return this.serverKpis()!.activeClients;
    return this.clients().length;
  });

  readonly averageRating = computed(() => {
    if (this.serverKpis()) return this.serverKpis()!.averageRating;
    const list = this.reviews();
    if (!list.length) return 5.0;
    const avg = list.reduce((sum, r) => sum + r.rating, 0) / list.length;
    return Math.round(avg * 10) / 10;
  });

  readonly todayAppointments = computed(() => {
    const todayStr = getLocalDateString();
    return this.appointments()
      .filter((a) => a.date === todayStr)
      .sort((a, b) => a.time.localeCompare(b.time));
  });

  readonly clientAppointments = computed(() => {
    const profile = this.supabaseService.userProfile();
    const cliId = profile?.id || this.currentClient().id;
    const authId = profile?.auth_user_id || this.supabaseService.currentUser()?.id;
    return this.appointments().filter(
      (a) => a.clientId === cliId || (authId && a.clientId === authId)
    );
  });

  readonly nextClientAppointment = computed<Appointment | null>(() => {
    const active = this.clientAppointments().find(
      (a) => a.status === 'confirmed' || a.status === 'pending' || a.status === 'in-progress'
    );
    return active || null;
  });

  readonly clientCutsHistory = computed(() => {
    const cliId = this.currentClient().id;
    return this.cuts().filter((c) => c.clientId === cliId);
  });

  /**
   * Genera métricas contables y operativas dinámicas para cualquier período de tiempo seleccionado.
   */
  getPeriodMetrics(period: 'today' | 'week' | 'month' | '6months' | 'year' | 'all', barberId?: string): {
    period: string;
    periodLabel: string;
    cutsCount: number;
    production: number;
    cashCollected: number;
    creditSales: number;
    averageTicket: number;
    uniqueClientsCount: number;
  } {
    const allCuts = this.cuts().filter((c) => !barberId || c.barberId === barberId);
    const now = new Date();
    const todayStr = getLocalDateString(now);

    let filteredCuts: CutRecord[] = [];
    let periodLabel = 'Hoy';

    switch (period) {
      case 'today':
        filteredCuts = allCuts.filter((c) => isSameLocalDate(c.date, todayStr));
        periodLabel = 'Hoy';
        break;
      case 'week':
        filteredCuts = allCuts.filter((c) => isDateWithinPastDays(c.date, 7, now));
        periodLabel = 'Esta Semana (7 días)';
        break;
      case 'month':
        filteredCuts = allCuts.filter((c) => isDateWithinPastDays(c.date, 30, now));
        periodLabel = 'Este Mes (30 días)';
        break;
      case '6months':
        filteredCuts = allCuts.filter((c) => isDateWithinPastDays(c.date, 180, now));
        periodLabel = 'Últimos 6 Meses';
        break;
      case 'year':
        filteredCuts = allCuts.filter((c) => isDateWithinPastDays(c.date, 365, now));
        periodLabel = 'Último Año';
        break;
      case 'all':
      default:
        filteredCuts = allCuts;
        periodLabel = 'Histórico Total';
        break;
    }

    const cutsCount = filteredCuts.length;
    const production = filteredCuts.reduce((sum, c) => sum + (Number(c.price) || 0), 0);
    const creditSales = filteredCuts.filter((c) => c.paymentMethod === 'credit').reduce((sum, c) => sum + (Number(c.price) || 0), 0);
    const cashFromCuts = production - creditSales;

    // Abonos de crédito recibidos en el período seleccionado
    const allMovs = this.accountMovements();
    let filteredMovs: AccountMovement[] = [];
    switch (period) {
      case 'today':
        filteredMovs = allMovs.filter((m) => isSameLocalDate(m.createdAt, todayStr) && m.movementType === 'income' && m.referenceType === 'credit_payment');
        break;
      case 'week':
        filteredMovs = allMovs.filter((m) => isDateWithinPastDays(m.createdAt, 7, now) && m.movementType === 'income' && m.referenceType === 'credit_payment');
        break;
      case 'month':
        filteredMovs = allMovs.filter((m) => isDateWithinPastDays(m.createdAt, 30, now) && m.movementType === 'income' && m.referenceType === 'credit_payment');
        break;
      case '6months':
        filteredMovs = allMovs.filter((m) => isDateWithinPastDays(m.createdAt, 180, now) && m.movementType === 'income' && m.referenceType === 'credit_payment');
        break;
      case 'year':
        filteredMovs = allMovs.filter((m) => isDateWithinPastDays(m.createdAt, 365, now) && m.movementType === 'income' && m.referenceType === 'credit_payment');
        break;
      case 'all':
      default:
        filteredMovs = allMovs.filter((m) => m.movementType === 'income' && m.referenceType === 'credit_payment');
        break;
    }
    const debtAbonos = filteredMovs.reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
    const cashCollected = cashFromCuts + debtAbonos;
    const averageTicket = cutsCount > 0 ? production / cutsCount : 0;
    const uniqueClientsCount = new Set(filteredCuts.map((c) => c.clientId)).size;

    return {
      period,
      periodLabel,
      cutsCount,
      production,
      cashCollected,
      creditSales,
      averageTicket,
      uniqueClientsCount,
    };
  }

  constructor() {
    this.logger.info('BarberService', 'Initializing BarberService');
    // Solo sincronizar si el usuario ya está autenticado
    if (this.supabaseService.isConfigured() && this.supabaseService.isAuthenticated) {
      this.syncFromSupabase();
    }
  }

  setRole(role: 'landing' | 'barber' | 'client'): void {
    this.currentRole.set(role);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.ROLE, role);
    }
  }

  setCurrentClientId(id: string): void {
    this.currentClientId.set(id);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.CURRENT_CLIENT_ID, id);
    }
  }

  /**
   * Sincroniza datos desde Supabase con Proyecciones Quirúrgicas y Joins
   */
  async syncFromSupabase(): Promise<void> {
    if (!this.supabaseService.isConfigured() || !this.supabaseService.isAuthenticated) {
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      this.logger.info('BarberService', 'Iniciando sincronización con Supabase');

      // 1. Cargar Configuración de Aplicación (app_settings) y Negocio (business_settings)
      try {
        const { data: appSettingsData, error: appSettingsError } = await this.supabaseService.supabase
          .from('app_settings')
          .select('key, value');

        if (appSettingsError) throw appSettingsError;

        if (appSettingsData && appSettingsData.length > 0) {
          const settingsMap: Record<string, number> = {};
          for (const s of appSettingsData) {
            settingsMap[s.key] = Number(s.value);
          }
          this.appSettings.set(settingsMap);
          this.saveToStorage(STORAGE_KEYS.APP_SETTINGS, settingsMap);
        }

        // Cargar business_settings (nombre, símbolo de moneda, modo de fidelización)
        const { data: bsData, error: bsError } = await this.supabaseService.supabase
          .from('business_settings')
          .select('*')
          .limit(1)
          .maybeSingle();

        if (!bsError && bsData) {
          this.businessSettings.set({
            id: bsData.id,
            businessName: bsData.business_name ?? 'BarberTrack PRO',
            currencySymbol: bsData.currency_symbol ?? 'S/',
            loyaltyMode: (bsData.loyalty_mode as any) || this.businessSettings().loyaltyMode || 'per_service',
          });
          this.saveToStorage(STORAGE_KEYS.BUSINESS_SETTINGS, this.businessSettings());
        }
      } catch (err) {
        this.logger.warn('BarberService', 'Error loading app or business settings from Supabase', err);
      }

      // 2. Cargar Cuentas Financieras
      try {
        const { data: faData } = await this.supabaseService.supabase
          .from('financial_accounts')
          .select('*')
          .eq('is_active', true)
          .order('name');

        if (faData && faData.length > 0) {
          const mappedAccounts: FinancialAccount[] = faData.map((a: any) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            currentBalance: Number(a.current_balance),
            isActive: a.is_active,
            createdAt: a.created_at,
          }));
          this.financialAccounts.set(mappedAccounts);
          this.saveToStorage(STORAGE_KEYS.FINANCIAL_ACCOUNTS, mappedAccounts);
        }
      } catch {
        // Fallback a cuentas locales
      }

      // 3. Cargar Turno de Caja Activo
      try {
        const { data: shiftData } = await this.supabaseService.supabase
          .from('cash_shifts')
          .select('*, barber:profiles(full_name)')
          .eq('status', 'open')
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (shiftData) {
          this.activeCashShift.set({
            id: shiftData.id,
            accountId: shiftData.account_id,
            barberId: shiftData.barber_id,
            openedAt: shiftData.opened_at,
            initialCash: Number(shiftData.initial_cash),
            cashSales: Number(shiftData.cash_sales),
            cashExpenses: Number(shiftData.cash_expenses),
            expectedCash: Number(shiftData.expected_cash),
            status: 'open',
            notes: shiftData.notes,
            barberName: shiftData.barber?.full_name || 'Barbero',
          });
        } else {
          this.activeCashShift.set(null);
        }
      } catch {
        // Ignorar si no existe tabla aún
      }

      // 4. Cargar Movimientos de Cuentas
      try {
        const { data: movsData } = await this.supabaseService.supabase
          .from('account_movements')
          .select('*, account:financial_accounts(name)')
          .order('created_at', { ascending: false })
          .limit(50);

        if (movsData) {
          const mappedMovs: AccountMovement[] = movsData.map((m: any) => ({
            id: m.id,
            accountId: m.account_id,
            movementType: m.movement_type,
            amount: Number(m.amount),
            description: m.description,
            referenceType: m.reference_type,
            referenceId: m.reference_id,
            createdBy: m.created_by,
            createdAt: m.created_at,
            shiftId: m.shift_id,
            accountName: m.account?.name || 'Cuenta',
          }));
          this.accountMovements.set(mappedMovs);
          this.saveToStorage(STORAGE_KEYS.ACCOUNT_MOVEMENTS, mappedMovs);
        }
      } catch {
        // Fallback a movimientos locales
      }

      // 5. Cargar KPIs agregados vía RPC si la función existe
      try {
        const { data: kpisData, error: kpisError } = await this.supabaseService.supabase.rpc('get_barber_dashboard_kpis');
        if (!kpisError && kpisData) {
          this.serverKpis.set({
            cutsToday: kpisData.cuts_today ?? 0,
            cutsThisMonth: kpisData.cuts_this_month ?? 0,
            revenueToday: Number(kpisData.revenue_today ?? 0),
            revenueThisWeek: Number(kpisData.revenue_this_week ?? 0),
            revenueThisMonth: Number(kpisData.revenue_this_month ?? 0),
            totalRevenue: Number(kpisData.total_revenue ?? 0),
            totalCuts: kpisData.total_cuts ?? 0,
            activeClients: kpisData.active_clients ?? 0,
            averageRating: Number(kpisData.average_rating ?? 5.0),
          });
        }
      } catch {
        // RPC no disponible aún, cálculos reactivos locales activos
      }

      // 6. Proyección quirúrgica de Servicios (Activos e Inactivos para Catálogo Admin)
      try {
        const { data: servicesData, error: srvError } = await this.supabaseService.supabase
          .from('services')
          .select('id, name, base_price, duration_minutes, is_active, popular')
          .order('name');

        if (!srvError && servicesData) {
          const mappedServices: ServiceItem[] = servicesData.map((s: any) => ({
            id: s.id,
            name: s.name,
            durationMinutes: s.duration_minutes,
            price: Number(s.base_price),
            isActive: s.is_active ?? true,
            popular: Boolean(s.popular),
          }));
          this.services.set(mappedServices);
          this.saveToStorage(STORAGE_KEYS.SERVICES, mappedServices);
        }
      } catch {
        // Fallback a servicios locales
      }

      // 7. Proyección Atómica Unificada de Usuarios, Barberos y Clientes desde profiles
      // OPTIMIZACIÓN DATA EGRESS: 1 sola consulta HTTP atómica en lugar de 3 consultas secuenciales
      try {
        const { data: allProfilesData, error: profilesErr } = await this.supabaseService.supabase
          .from('profiles')
          .select(`
            id,
            full_name,
            phone,
            role,
            is_active,
            membership_tier,
            avatar_url,
            created_at,
            loyalty_progress (current_stamps, total_historical_cuts),
            customer_credits!customer_credits_profile_id_fkey (current_debt, credit_limit)
          `)
          .order('created_at', { ascending: false });

        if (profilesErr) {
          this.logger.error('BarberService', 'Error al cargar perfiles unificados desde Supabase', profilesErr);
        } else if (allProfilesData) {
          // A. Proyección de Todos los Usuarios del Sistema
          const mappedUsers: SystemUser[] = allProfilesData.map((u: any) => ({
            id: u.id,
            fullName: u.full_name || 'Usuario',
            phone: u.phone || '',
            role: (u.role as UserRole) || 'barber',
            isActive: u.is_active ?? true,
            avatarUrl: u.avatar_url || undefined,
            createdAt: u.created_at,
          }));
          this.systemUsers.set(mappedUsers);

          // B. Proyección de Equipo de Barberos y Staff activo
          const activeStaff = allProfilesData.filter(
            (p: any) => (p.role === 'barber' || p.role === 'admin') && (p.is_active ?? true)
          );
          if (activeStaff.length > 0) {
            const mappedBarbers: Barber[] = activeStaff.map((b: any) => ({
              id: b.id,
              name: b.full_name || 'Barbero',
              specialty: b.role === 'admin' ? 'Master Barber & Administrador' : 'Barbero Profesional',
              avatarUrl: b.avatar_url || undefined,
              rating: 5.0,
              totalCuts: 0,
            }));
            this.barbers.set(mappedBarbers);
          }

          // C. Proyección Soberana de Clientes con Fidelidad y Deuda
          const customerProfiles = allProfilesData.filter(
            (p: any) => p.role === 'customer' && (p.is_active ?? true)
          );
          const mappedClients: Client[] = customerProfiles.map((p: any) => {
            const lp = Array.isArray(p.loyalty_progress) ? p.loyalty_progress[0] : (p.loyalty_progress as any);
            const cc = Array.isArray(p.customer_credits) ? p.customer_credits[0] : (p.customer_credits as any);
            return {
              id: p.id,
              name: p.full_name,
              phone: p.phone || '',
              cutsCount: lp?.total_historical_cuts ?? 0,
              loyaltyStamps: lp?.current_stamps ?? 0,
              membershipLevel: (p.membership_tier as any) || 'Bronze',
              avatarUrl: p.avatar_url || undefined,
              currentDebt: Number(cc?.current_debt ?? 0),
              creditLimit: Number(cc?.credit_limit ?? 0),
            };
          });
          this.clients.set(mappedClients);
          this.saveToStorage(STORAGE_KEYS.CLIENTS, mappedClients);
        }
      } catch (profilesEx) {
        this.logger.error('BarberService', 'Excepción de red al cargar perfiles unificados', profilesEx);
      }

      // 4. Proyección quirúrgica de Órdenes POS y sus Ítems desglosados
      try {
        const { data: ordersData, error: ordersError } = await this.supabaseService.supabase
          .from('orders')
          .select(`
            id,
            order_number,
            final_price,
            payment_method,
            created_at,
            customer_id,
            barber_id,
            notes,
            customer:profiles!orders_customer_id_fkey (id, full_name),
            barber:profiles!orders_barber_id_fkey (id, full_name),
            order_items (id, service_id, item_name, unit_price, quantity, subtotal)
          `)
          .order('created_at', { ascending: false })
          .limit(30);

        if (ordersData && ordersData.length > 0) {
          const currentServices = this.services();
          const currentClients = this.clients();
          const currentBarbers = this.barbers();

          const mappedCuts: CutRecord[] = ordersData.map((s: any) => {
            const cli = currentClients.find((c) => c.id === s.customer_id);
            const brb = currentBarbers.find((b) => b.id === s.barber_id);
            const items = s.order_items || [];

            let serviceName = 'Servicio';
            let serviceId = s.service_id || '';

            if (items.length > 0) {
              serviceName = items.map((i: any) => i.item_name).join(' + ');
              serviceId = items[0]?.service_id || serviceId;
            } else if (s.service_id) {
              const srv = currentServices.find((sv) => sv.id === s.service_id);
              serviceName = srv?.name || 'Servicio';
            }

            return {
              id: s.id,
              orderNumber: s.order_number,
              clientId: s.customer_id || '',
              clientName: s.customer?.full_name || cli?.name || 'Cliente General',
              barberId: s.barber_id || '',
              barberName: s.barber?.full_name || brb?.name || 'Barbero',
              serviceId,
              serviceName,
              price: Number(s.final_price),
              date: s.created_at,
              paymentMethod: (s.payment_method as PaymentMethod) || 'cash',
              notes: s.notes || undefined,
              items: items.map((i: any) => ({
                id: i.id,
                orderId: s.id,
                serviceId: i.service_id,
                itemName: i.item_name,
                unitPrice: Number(i.unit_price),
                quantity: i.quantity || 1,
                subtotal: Number(i.subtotal),
              })),
            };
          });
          this.cuts.set(mappedCuts);
          this.saveToStorage(STORAGE_KEYS.CUTS, mappedCuts);
        } else if (!ordersError && ordersData && ordersData.length === 0) {
          const localUnsynced = this.cuts().filter((c) => c.id.startsWith('cut-'));
          if (localUnsynced.length === 0) {
            this.cuts.set([]);
            this.saveToStorage(STORAGE_KEYS.CUTS, []);
          }
        }
      } catch (err) {
        this.logger.warn('BarberService', 'Aviso sincronizando ventas', err);
      }

      // 5. Proyección de Citas / Agenda desde Supabase con Optimización de Data Egress (Ventana Deslizante)
      try {
        this.isAppointmentsLoading.set(true);
        // Ventana móvil de -30 días hasta +60 días para evitar descargas masivas de todo el historial
        const now = new Date();
        const minIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const maxIso = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

        const { data: aptsData, error: aptsError } = await this.supabaseService.supabase
          .from('appointments')
          .select(`
            id,
            customer_id,
            barber_id,
            service_id,
            scheduled_at,
            status,
            services_details,
            total_duration_minutes,
            customer:profiles!appointments_customer_id_fkey (id, full_name, phone),
            barber:profiles!appointments_barber_id_fkey (id, full_name),
            service:services!appointments_service_id_fkey (id, name, base_price)
          `)
          .gte('scheduled_at', minIso)
          .lte('scheduled_at', maxIso)
          .order('scheduled_at', { ascending: true });

        if (!aptsError && aptsData && aptsData.length > 0) {
          const mappedApts: Appointment[] = aptsData.map((a: any) => {
            const dt = new Date(a.scheduled_at);
            const dateStr = getLocalDateString(dt);
            const timeStr = getLocalTimeString(dt);

            const parsedServices: AppointmentServiceItem[] = Array.isArray(a.services_details) && a.services_details.length > 0
              ? a.services_details
              : (a.service ? [{
                  serviceId: a.service_id,
                  name: a.service.name,
                  price: Number(a.service.base_price || 15),
                  durationMinutes: a.total_duration_minutes || 30,
                }] : []);

            const totalPrice = parsedServices.length > 0
              ? parsedServices.reduce((sum, s) => sum + (Number(s.price) || 0), 0)
              : Number(a.service?.base_price || 15);

            const serviceName = parsedServices.length > 1
              ? parsedServices.map((s) => s.name).join(' + ')
              : (parsedServices[0]?.name || a.service?.name || 'Corte');

            return {
              id: a.id,
              clientId: a.customer_id,
              clientName: a.customer?.full_name || 'Cliente',
              clientPhone: a.customer?.phone || '',
              barberId: a.barber_id,
              barberName: a.barber?.full_name || 'Barbero',
              serviceId: a.service_id,
              serviceName,
              services: parsedServices,
              totalDurationMinutes: a.total_duration_minutes || parsedServices.reduce((sum, s) => sum + (s.durationMinutes || 0), 0),
              date: dateStr,
              time: timeStr,
              price: totalPrice,
              status: fromDbAppointmentStatus(a.status),
            };
          });
          this.appointments.set(mappedApts);
          this.saveToStorage(STORAGE_KEYS.APPOINTMENTS, mappedApts);
        } else if (!aptsError && aptsData && aptsData.length === 0) {
          this.appointments.set([]);
          this.saveToStorage(STORAGE_KEYS.APPOINTMENTS, []);
        }
      } catch (err) {
        this.logger.warn('BarberService', 'Aviso sincronizando citas', err);
      } finally {
        this.isAppointmentsLoading.set(false);
      }

      // 10. Cargar Premios de Fidelización configurables (0..N)
      try {
        const { data: rewardsData, error: rewardsErr } = await this.supabaseService.supabase
          .from('loyalty_rewards')
          .select('id, name, description, reward_type, stamps_required, reward_value, is_active, sort_order, created_at')
          .order('sort_order')
          .order('stamps_required');

        if (rewardsErr) {
          this.logger.error('BarberService', 'Error al cargar loyalty_rewards', rewardsErr);
        } else if (rewardsData) {
          this.loyaltyRewards.set(
            rewardsData.map((r: any) => ({
              id: r.id,
              name: r.name,
              description: r.description ?? undefined,
              rewardType: r.reward_type,
              stampsRequired: r.stamps_required,
              rewardValue: r.reward_value != null ? Number(r.reward_value) : null,
              isActive: r.is_active,
              sortOrder: r.sort_order,
              createdAt: r.created_at,
            }))
          );
        }
      } catch (err) {
        this.logger.warn('BarberService', 'Aviso cargando loyalty_rewards', err);
      }

      // 11. Cargar Premios Pendientes de Canje
      try {
        const { data: claimsData, error: claimsErr } = await this.supabaseService.supabase
          .from('loyalty_reward_claims')
          .select(`
            id, customer_id, reward_id, sale_id, claimed_at, redeemed_at, redeemed_by, notes, stamps_at_claim,
            customer:profiles!loyalty_reward_claims_customer_id_fkey (full_name),
            reward:loyalty_rewards!loyalty_reward_claims_reward_id_fkey (name, reward_type, reward_value)
          `)
          .is('redeemed_at', null)
          .order('claimed_at', { ascending: false })
          .limit(100);

        if (claimsErr) {
          this.logger.error('BarberService', 'Error al cargar loyalty_reward_claims', claimsErr);
        } else if (claimsData) {
          this.pendingRewardClaims.set(
            claimsData.map((c: any) => ({
              id: c.id,
              customerId: c.customer_id,
              customerName: c.customer?.full_name ?? 'Cliente',
              rewardId: c.reward_id,
              rewardName: c.reward?.name ?? 'Premio',
              rewardType: c.reward?.reward_type ?? 'gift',
              rewardValue: c.reward?.reward_value != null ? Number(c.reward.reward_value) : null,
              saleId: c.sale_id ?? null,
              claimedAt: c.claimed_at,
              redeemedAt: c.redeemed_at ?? null,
              redeemedBy: c.redeemed_by ?? null,
              notes: c.notes ?? null,
              stampsAtClaim: c.stamps_at_claim,
            }))
          );
        }
      } catch (err) {
        this.logger.warn('BarberService', 'Aviso cargando loyalty_reward_claims', err);
      }

      this.logger.info('BarberService', 'Sincronización completada con éxito');
    } catch (err: unknown) {
      this.logger.error('BarberService', 'Error durante la sincronización con Supabase', err);
      this.errorMessage.set('No se pudo sincronizar con el servidor. Modo offline activado.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Registro atómico de orden POS (Servicio único o Combo multi-servicio):
   * Soporta arquitectura POS estándar con `orders` y `order_items`.
   * Incluye fallback transparente a `sales_history` si la migración de órdenes aún no se aplicó.
   * Soporta cobro de contado (efectivo, tarjeta, transferencia) o Al Crédito (Fiar).
   */
  async registerCut(params: {
    clientId: string;
    barberId: string;
    serviceId?: string;
    services?: Array<{ serviceId: string; name: string; price: number; quantity?: number }>;
    items?: OrderItem[];
    customPrice?: number;
    paymentMethod: PaymentMethod;
    notes?: string;
    isCredit?: boolean;
    appointmentId?: string;
  }): Promise<CutRecord> {
    const client = this.clients().find((c) => c.id === params.clientId);
    const barber = this.barbers().find((b) => b.id === params.barberId) || this.barbers()[0];
    const availableServices = this.services();

    // 1. Construcción de líneas de detalle (Multi-servicio / Combo)
    let lineItems: OrderItem[] = [];
    if (params.items && params.items.length > 0) {
      lineItems = [...params.items];
    } else if (params.services && params.services.length > 0) {
      lineItems = params.services.map((s) => ({
        serviceId: s.serviceId,
        itemName: s.name,
        unitPrice: s.price,
        quantity: s.quantity || 1,
        subtotal: s.price * (s.quantity || 1),
      }));
    } else {
      const singleService = availableServices.find((s) => s.id === params.serviceId) || availableServices[0];
      lineItems = [
        {
          serviceId: singleService?.id || '',
          itemName: singleService?.name || 'Servicio de Barbería',
          unitPrice: singleService?.price || 15,
          quantity: 1,
          subtotal: singleService?.price || 15,
        },
      ];
    }

    const calculatedSubtotal = lineItems.reduce((acc, it) => acc + (it.subtotal || it.unitPrice * (it.quantity || 1)), 0);
    const finalPrice =
      params.customPrice !== undefined && params.customPrice !== null && !isNaN(params.customPrice)
        ? Number(params.customPrice)
        : calculatedSubtotal;
    const discountAmount = Math.max(0, calculatedSubtotal - finalPrice);

    const actualPaymentMethod: PaymentMethod = params.isCredit ? 'credit' : params.paymentMethod;
    const activeShift = this.activeCashShift();
    let saleId = '';
    let orderNumber: number | undefined = undefined;

    // 2. Persistir en Supabase (Arquitectura POS: orders + order_items)
    if (this.supabaseService.isConfigured()) {
      try {
        const activeProfile = this.supabaseService.userProfile();
        const realBarberId = params.barberId || activeProfile?.id || barber?.id || null;
        const shiftIdReal = activeShift?.id || null;

        const { data: orderData, error: orderErr } = await this.supabaseService.supabase
          .from('orders')
          .insert({
            customer_id: params.clientId || null,
            barber_id: realBarberId,
            appointment_id: params.appointmentId || null,
            shift_id: shiftIdReal,
            subtotal: calculatedSubtotal,
            discount_amount: discountAmount,
            final_price: finalPrice,
            payment_method: actualPaymentMethod,
            amount_paid: params.isCredit ? 0 : finalPrice,
            amount_debt: params.isCredit ? finalPrice : 0,
            notes: params.notes || null,
            status: 'completed',
          })
          .select('id, order_number')
          .single();

        if (orderErr) {
          this.logger.error('BarberService', 'Error al insertar orden POS en Supabase', orderErr);
          throw orderErr;
        } else if (orderData) {
          saleId = orderData.id;
          orderNumber = orderData.order_number;

          // Insertar líneas de detalle en order_items
          const itemsToInsert = lineItems.map((it) => ({
            order_id: saleId,
            service_id: it.serviceId || null,
            item_type: 'service',
            item_name: it.itemName,
            unit_price: it.unitPrice,
            quantity: it.quantity || 1,
            subtotal: it.subtotal || it.unitPrice * (it.quantity || 1),
          }));

          const { error: itemsErr } = await this.supabaseService.supabase
            .from('order_items')
            .insert(itemsToInsert);

          if (itemsErr) {
            this.logger.error('BarberService', 'Aviso al registrar order_items', itemsErr);
          }
        }

        // Si es crédito, registrar en customer_credit_movements (CHARGE)
        if (params.isCredit && params.clientId) {
          try {
            let creditAccId: string | null = null;
            const { data: cData } = await this.supabaseService.supabase
              .from('customer_credits')
              .select('id')
              .eq('profile_id', params.clientId)
              .maybeSingle();

            if (cData) {
              creditAccId = cData.id;
            } else {
              const { data: newC } = await this.supabaseService.supabase
                .from('customer_credits')
                .insert({ profile_id: params.clientId, current_debt: 0, credit_limit: 0 })
                .select('id')
                .single();
              creditAccId = newC?.id || null;
            }

            if (creditAccId) {
              const summaryName = lineItems.map((i) => i.itemName).join(', ');
              await this.supabaseService.supabase.from('customer_credit_movements').insert({
                customer_credit_id: creditAccId,
                order_id: saleId || null,
                movement_type: 'CHARGE',
                amount: finalPrice,
                payment_method: 'credit',
                notes: `Orden fiada: ${summaryName}`,
                shift_id: shiftIdReal,
              });
            }
          } catch (cErr) {
            this.logger.warn('BarberService', 'Aviso al registrar movimiento de crédito', cErr);
          }
        } else if (!params.isCredit) {
          // Si es dinero real, registrar en account_movements hacia la cuenta correspondiente
          const targetType = actualPaymentMethod === 'cash' ? 'cash' : actualPaymentMethod === 'card' ? 'bank' : 'digital_wallet';
          const targetAcc = this.financialAccounts().find((a) => a.type === targetType) || this.financialAccounts()[0];

          if (targetAcc) {
            try {
              const summaryName = lineItems.map((i) => i.itemName).join(' + ');
              await this.supabaseService.supabase.from('account_movements').insert({
                account_id: targetAcc.id,
                movement_type: 'income',
                amount: finalPrice,
                description: `Cobro: ${summaryName} (${client?.name || 'Cliente'})`,
                reference_type: 'order',
                reference_id: saleId || null,
                shift_id: actualPaymentMethod === 'cash' ? shiftIdReal : null,
              });
            } catch (mErr) {
              this.logger.warn('BarberService', 'Aviso al registrar movimiento de cuenta', mErr);
            }
          }

          // Si es efectivo y hay turno de caja abierto, sumar a cashSales
          if (actualPaymentMethod === 'cash' && activeShift) {
            activeShift.cashSales += finalPrice;
            activeShift.expectedCash += finalPrice;
            this.activeCashShift.set({ ...activeShift });
            await this.supabaseService.supabase
              .from('cash_shifts')
              .update({
                cash_sales: activeShift.cashSales,
                expected_cash: activeShift.expectedCash,
              })
              .eq('id', activeShift.id);
          }
        }
      } catch (e) {
        this.logger.error('BarberService', 'Excepción de red en registerCut', e);
        throw e;
      }
    } else {
      saleId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'offline-cut';
    }

    const summaryServiceName = lineItems.map((i) => i.itemName).join(' + ');
    const primaryServiceId = lineItems[0]?.serviceId || '';

    const newCut: CutRecord = {
      id: saleId,
      orderNumber,
      clientId: params.clientId,
      clientName: client ? client.name : 'Cliente General',
      barberId: barber?.id || '',
      barberName: barber?.name || 'Barbero',
      serviceId: primaryServiceId,
      serviceName: summaryServiceName,
      price: finalPrice,
      date: new Date().toISOString(),
      paymentMethod: actualPaymentMethod,
      notes: params.notes,
      items: lineItems,
      isCredit: Boolean(params.isCredit),
      amountDebt: params.isCredit ? finalPrice : 0,
      amountPaid: params.isCredit ? 0 : finalPrice,
      isPaid: !params.isCredit,
    };

    const updatedCuts = [newCut, ...this.cuts()];
    this.cuts.set(updatedCuts);
    this.saveToStorage(STORAGE_KEYS.CUTS, updatedCuts);

    // 3. Sincronizar saldos de cuentas financieras y movimientos en local
    if (!params.isCredit) {
      const targetType = actualPaymentMethod === 'cash' ? 'cash' : actualPaymentMethod === 'card' ? 'bank' : 'digital_wallet';
      const accounts = this.financialAccounts();
      const targetAcc = accounts.find((a) => a.type === targetType && a.isActive) || accounts[0];

      if (targetAcc) {
        const updatedAccounts = accounts.map((a) =>
          a.id === targetAcc.id ? { ...a, currentBalance: (Number(a.currentBalance) || 0) + finalPrice } : a
        );
        this.financialAccounts.set(updatedAccounts);
        this.saveToStorage(STORAGE_KEYS.FINANCIAL_ACCOUNTS, updatedAccounts);

        const newAccountMov: AccountMovement = {
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mov-${Date.now()}`,
          accountId: targetAcc.id,
          movementType: 'income',
          amount: finalPrice,
          description: `Cobro POS: ${summaryServiceName} (${client?.name || 'Cliente'})`,
          referenceType: 'order',
          referenceId: saleId || null,
          createdAt: new Date().toISOString(),
          accountName: targetAcc.name,
          shiftId: actualPaymentMethod === 'cash' && activeShift ? activeShift.id : null,
        };
        this.accountMovements.update((prev) => [newAccountMov, ...prev]);
        this.saveToStorage(STORAGE_KEYS.ACCOUNT_MOVEMENTS, this.accountMovements());
      }
    }

    // 4. Actualizar métricas KPI reactivas inmediatamente
    this.serverKpis.update((kpi) => {
      if (!kpi) return null;
      return {
        ...kpi,
        cutsToday: kpi.cutsToday + 1,
        cutsThisMonth: kpi.cutsThisMonth + 1,
        totalCuts: kpi.totalCuts + 1,
        revenueToday: kpi.revenueToday + (params.isCredit ? 0 : finalPrice),
        totalRevenue: kpi.totalRevenue + finalPrice,
      };
    });

    // 5. Fidelización y Sellos según loyaltyMode
    if (client) {
      const isPaid = !params.isCredit;
      const serviceCount = lineItems.reduce((acc, it) => acc + (it.quantity || 1), 0);
      const mode = this.loyaltyMode();
      // Si el cobro es al contado: en modo 'per_service' suma los servicios, en 'per_visit' suma 1. Si es crédito/fiado, 0 sellos hasta saldar.
      const stampsToAdd = isPaid ? (mode === 'per_service' ? Math.max(1, serviceCount) : 1) : 0;
      const cutsToAdd = mode === 'per_service' ? Math.max(1, serviceCount) : 1;

      const newCutsCount = client.cutsCount + cutsToAdd;
      const newStamps = client.loyaltyStamps + stampsToAdd;

      let newLevel: MembershipTier = client.membershipLevel;
      if (newCutsCount >= 50) newLevel = 'VIP';
      else if (newCutsCount >= 20) newLevel = 'Gold';
      else if (newCutsCount >= 5) newLevel = 'Silver';
      else newLevel = 'Bronze';

      const newDebt = params.isCredit ? (client.currentDebt || 0) + finalPrice : (client.currentDebt || 0);

      const updatedClients = this.clients().map((c) =>
        c.id === client.id
          ? {
            ...c,
            cutsCount: newCutsCount,
            loyaltyStamps: newStamps,
            membershipLevel: newLevel,
            currentDebt: newDebt,
            lastVisitDate: getLocalDateString(),
          }
          : c
      );
      this.clients.set(updatedClients);
      this.saveToStorage(STORAGE_KEYS.CLIENTS, updatedClients);
    }

    return newCut;
  }

  /**
   * Crear nuevo cliente (Solo nombre obligatorio)
   */
  async createClient(name: string, phone: string = '', email?: string, notes?: string): Promise<Client> {
    const cleanName = name.trim();
    const cleanPhone = phone && phone.trim() ? phone.trim() : '';

    let clientId = '';

    // Persistir en Supabase primero para obtener el UUID generado automáticamente por PostgreSQL
    if (this.supabaseService.isConfigured()) {
      try {
        const { data, error } = await this.supabaseService.supabase
          .from('profiles')
          .insert({
            full_name: cleanName,
            phone: cleanPhone || null,
            role: 'customer',
            membership_tier: 'Bronze',
          })
          .select('id')
          .single();

        if (error) {
          this.logger.error('BarberService', 'Error al crear perfil en Supabase', error);
          throw error;
        } else if (data) {
          clientId = data.id;

          // Inicializar cuenta de crédito con el UUID real de la base de datos
          await this.supabaseService.supabase.from('customer_credits').insert({
            profile_id: data.id,
            current_debt: 0,
            credit_limit: 0,
          });
        }
      } catch (e) {
        this.logger.error('BarberService', 'Excepción al crear cliente en Supabase', e);
        throw e;
      }
    } else {
      clientId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'offline-cli';
    }

    const newClient: Client = {
      id: clientId,
      name: cleanName,
      phone: cleanPhone,
      email: email?.trim(),
      cutsCount: 0,
      loyaltyStamps: 0,
      membershipLevel: 'Bronze',
      lastVisitDate: getLocalDateString(),
      notes,
      currentDebt: 0,
      creditLimit: 0,
    };

    const updated = [newClient, ...this.clients()];
    this.clients.set(updated);
    this.saveToStorage(STORAGE_KEYS.CLIENTS, updated);

    return newClient;
  }

  /**
   * Registrar Abono de Deuda de un Cliente
   */
  async registerCreditPayment(params: {
    clientId: string;
    amount: number;
    accountId: string;
    paymentMethod: string;
    notes?: string;
  }): Promise<void> {
    const client = this.clients().find((c) => c.id === params.clientId);
    if (!client) return;

    const amount = Number(params.amount);
    if (amount <= 0) return;

    // Actualizar saldo de deuda del cliente
    client.currentDebt = Math.max(0, (client.currentDebt || 0) - amount);

    // 1. Algoritmo FIFO de Liquidación de Órdenes Fiadas y Liberación Estricta de Sellos
    let remainingAbono = amount;
    let stampsEarned = 0;
    const mode = this.loyaltyMode();

    const allCuts = this.cuts();
    const updatedCuts = allCuts.map((cut) => {
      // Si el corte pertenece a este cliente y es fiado/crédito y aún no está saldado al 100%
      if (cut.clientId === client.id && (cut.isCredit || cut.paymentMethod === 'credit') && !cut.isPaid) {
        if (remainingAbono <= 0) return cut;

        const cutUnpaid = cut.amountDebt !== undefined ? cut.amountDebt : cut.price;
        if (remainingAbono >= cutUnpaid) {
          // Orden completamente liquidada -> Se liberan sus sellos
          remainingAbono -= cutUnpaid;
          const serviceCount = cut.items?.reduce((acc, it) => acc + (it.quantity || 1), 0) || 1;
          const earned = mode === 'per_service' ? Math.max(1, serviceCount) : 1;
          stampsEarned += earned;

          return {
            ...cut,
            amountDebt: 0,
            amountPaid: cut.price,
            isPaid: true,
          };
        } else {
          // Orden parcialmente amortizada -> Se reduce deuda pero NO se liberan sellos aún
          const newDebt = cutUnpaid - remainingAbono;
          const newPaid = (cut.amountPaid || 0) + remainingAbono;
          remainingAbono = 0;

          return {
            ...cut,
            amountDebt: newDebt,
            amountPaid: newPaid,
            isPaid: false,
          };
        }
      }
      return cut;
    });

    // Fallback de fidelización: si la deuda total llegó a 0 y no se habían liberado sellos
    if (stampsEarned === 0 && client.currentDebt === 0 && (client.loyaltyStamps || 0) === 0) {
      stampsEarned = 1;
    }

    if (stampsEarned > 0) {
      client.loyaltyStamps = (client.loyaltyStamps || 0) + stampsEarned;
    }

    this.cuts.set(updatedCuts);
    this.saveToStorage(STORAGE_KEYS.CUTS, updatedCuts);

    this.clients.set([...this.clients()]);
    this.saveToStorage(STORAGE_KEYS.CLIENTS, this.clients());

    const activeShift = this.activeCashShift();
    const acc = this.financialAccounts().find((a) => a.id === params.accountId) || this.financialAccounts()[0];
    if (acc) {
      acc.currentBalance += amount;
      this.financialAccounts.set([...this.financialAccounts()]);
      this.saveToStorage(STORAGE_KEYS.FINANCIAL_ACCOUNTS, this.financialAccounts());

      const paymentMov: AccountMovement = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `mov-${Date.now()}`,
        accountId: acc.id,
        movementType: 'income',
        amount: amount,
        description: `Abono de deuda: ${client.name}`,
        referenceType: 'credit_payment',
        createdAt: new Date().toISOString(),
        accountName: acc.name,
        shiftId: acc.type === 'cash' && activeShift ? activeShift.id : null,
      };
      this.accountMovements.update((prev) => [paymentMov, ...prev]);
      this.saveToStorage(STORAGE_KEYS.ACCOUNT_MOVEMENTS, this.accountMovements());
    }

    // Actualizar métricas KPI reactivas
    this.serverKpis.update((kpi) => {
      if (!kpi) return null;
      return {
        ...kpi,
        revenueToday: kpi.revenueToday + amount,
      };
    });

    if (acc?.type === 'cash' && activeShift) {
      activeShift.cashSales += amount;
      activeShift.expectedCash += amount;
      this.activeCashShift.set({ ...activeShift });
    }

    // Registrar en Supabase
    if (this.supabaseService.isConfigured() && params.clientId) {
      try {
        const { data: cData } = await this.supabaseService.supabase
          .from('customer_credits')
          .select('id')
          .eq('profile_id', params.clientId)
          .maybeSingle();

        const shiftIdReal = activeShift ? activeShift.id : null;

        if (cData) {
          await this.supabaseService.supabase.from('customer_credit_movements').insert({
            customer_credit_id: cData.id,
            movement_type: 'PAYMENT',
            amount: amount,
            payment_method: params.paymentMethod,
            notes: params.notes || `Abono de deuda: ${client.name}`,
            shift_id: shiftIdReal,
          });
        }

        if (acc) {
          await this.supabaseService.supabase.from('account_movements').insert({
            account_id: acc.id,
            movement_type: 'income',
            amount: amount,
            description: `Abono de deuda: ${client.name}`,
            reference_type: 'credit_payment',
            shift_id: acc.type === 'cash' ? shiftIdReal : null,
          });

          // Sincronizar cash_shifts en Supabase ante abono en efectivo
          if (acc.type === 'cash' && activeShift) {
            await this.supabaseService.supabase
              .from('cash_shifts')
              .update({
                cash_sales: activeShift.cashSales,
                expected_cash: activeShift.expectedCash,
              })
              .eq('id', activeShift.id);
          }
        }
      } catch (err) {
        this.logger.error('BarberService', 'Error al registrar abono de crédito', err);
      }
    }
  }

  /**
   * Obtener el fondo inicial sugerido para la apertura de turno de caja.
   * 1. Consulta el arqueo real del último turno cerrado (campo actual_cash).
   * 2. Si no hay turno previo, toma el balance contable de la cuenta de efectivo.
   * 3. Fallback a 0.
   */
  async getSuggestedOpeningCash(): Promise<number> {
    const cashAcc = this.financialAccounts().find((a) => a.type === 'cash') || this.financialAccounts()[0];

    if (this.supabaseService.isConfigured()) {
      try {
        const { data, error } = await this.supabaseService.supabase
          .from('cash_shifts')
          .select('actual_cash, expected_cash')
          .eq('status', 'closed')
          .order('closed_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data && data.actual_cash !== null && data.actual_cash !== undefined) {
          return Number(data.actual_cash);
        }
      } catch (err) {
        this.logger.warn('BarberService', 'Error consultando último turno cerrado', err);
      }
    }

    if (cashAcc && cashAcc.currentBalance !== undefined) {
      return Number(cashAcc.currentBalance);
    }

    return 0;
  }

  /**
   * Apertura de Turno de Caja
   */
  async openCashShift(initialCash: number, notes?: string): Promise<CashShift> {
    if (this.activeCashShift()) {
      throw new Error('Ya existe un turno de caja activo en el sistema.');
    }

    const cashAcc = this.financialAccounts().find((a) => a.type === 'cash') || this.financialAccounts()[0];
    const profile = this.supabaseService.userProfile();
    const barberId = profile?.id || this.barbers()[0]?.id;

    let shiftId = '';

    if (this.supabaseService.isConfigured() && cashAcc?.id && barberId) {
      try {
        // Validación atómica de concurrencia: evitar duplicidad de turno abierto
        const { data: existingOpen } = await this.supabaseService.supabase
          .from('cash_shifts')
          .select('id')
          .eq('account_id', cashAcc.id)
          .eq('status', 'open')
          .limit(1)
          .maybeSingle();

        if (existingOpen) {
          throw new Error('Ya existe un turno abierto en esta gaveta física.');
        }

        const { data, error } = await this.supabaseService.supabase
          .from('cash_shifts')
          .insert({
            account_id: cashAcc.id,
            barber_id: barberId,
            initial_cash: Number(initialCash),
            cash_sales: 0,
            cash_expenses: 0,
            expected_cash: Number(initialCash),
            status: 'open',
            notes: notes || null,
          })
          .select('id')
          .single();

        if (error) {
          this.logger.error('BarberService', 'Error al abrir turno en Supabase', error);
          throw error;
        } else if (data) {
          shiftId = data.id;
        }
      } catch (err) {
        this.logger.error('BarberService', 'Excepción al abrir turno en Supabase', err);
        throw err;
      }
    } else {
      shiftId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'offline-shift';
    }

    const newShift: CashShift = {
      id: shiftId,
      accountId: cashAcc ? cashAcc.id : '',
      barberId: barberId || '',
      openedAt: new Date().toISOString(),
      initialCash: Number(initialCash),
      cashSales: 0,
      cashExpenses: 0,
      expectedCash: Number(initialCash),
      status: 'open',
      notes: notes || null,
      barberName: profile?.full_name || 'Master Barber',
    };

    this.activeCashShift.set(newShift);
    return newShift;
  }

  /**
   * Cierre y Arqueo de Turno de Caja
   */
  async closeCashShift(actualCash: number, notes?: string): Promise<void> {
    const current = this.activeCashShift();
    if (!current) return;

    const actual = Number(actualCash);
    const diff = actual - current.expectedCash;
    const closedAt = new Date().toISOString();

    if (this.supabaseService.isConfigured() && current.id) {
      try {
        await this.supabaseService.supabase
          .from('cash_shifts')
          .update({
            closed_at: closedAt,
            actual_cash: actual,
            difference: diff,
            status: 'closed',
            notes: notes || current.notes,
          })
          .eq('id', current.id);
      } catch (err) {
        this.logger.error('BarberService', 'Error al cerrar turno en Supabase', err);
      }
    }

    this.activeCashShift.set(null);
  }

  /**
   * Crear Movimiento de Cuenta Manual (Ingreso o Egreso)
   */
  async createAccountMovement(params: {
    accountId: string;
    movementType: MovementType;
    amount: number;
    description: string;
    referenceType?: ReferenceType;
  }): Promise<void> {
    const acc = this.financialAccounts().find((a) => a.id === params.accountId) || this.financialAccounts()[0];
    const amount = Number(params.amount);
    const activeShift = this.activeCashShift();

    let movementId = '';

    if (this.supabaseService.isConfigured() && acc?.id) {
      try {
        const { data, error } = await this.supabaseService.supabase
          .from('account_movements')
          .insert({
            account_id: acc.id,
            movement_type: params.movementType,
            amount: amount,
            description: params.description.trim(),
            reference_type: params.referenceType || 'manual',
            shift_id: acc.type === 'cash' && activeShift ? activeShift.id : null,
          })
          .select('id')
          .single();

        if (error) {
          this.logger.error('BarberService', 'Error al crear movimiento en Supabase', error);
          throw error;
        } else if (data) {
          movementId = data.id;
        }

        // Sincronizar cash_shifts en Supabase ante egreso en efectivo
        if (acc.type === 'cash' && params.movementType === 'expense' && activeShift) {
          await this.supabaseService.supabase
            .from('cash_shifts')
            .update({
              cash_expenses: activeShift.cashExpenses + amount,
              expected_cash: activeShift.expectedCash - amount,
            })
            .eq('id', activeShift.id);
        }
      } catch (err) {
        this.logger.error('BarberService', 'Excepción al crear movimiento en Supabase', err);
        throw err;
      }
    } else {
      movementId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'offline-mov';
    }

    const newMov: AccountMovement = {
      id: movementId,
      accountId: acc.id,
      movementType: params.movementType,
      amount: amount,
      description: params.description.trim(),
      referenceType: params.referenceType || 'manual',
      createdAt: new Date().toISOString(),
      accountName: acc.name,
      shiftId: activeShift?.id,
    };

    this.accountMovements.set([newMov, ...this.accountMovements()]);
    this.saveToStorage(STORAGE_KEYS.ACCOUNT_MOVEMENTS, this.accountMovements());

    // Actualizar saldo de cuenta local
    const delta = params.movementType === 'income' || params.movementType === 'transfer_in' ? amount : -amount;
    acc.currentBalance += delta;
    this.financialAccounts.set([...this.financialAccounts()]);
    this.saveToStorage(STORAGE_KEYS.FINANCIAL_ACCOUNTS, this.financialAccounts());

    // Si es egreso en efectivo con turno abierto, registrar en cashExpenses
    if (acc.type === 'cash' && params.movementType === 'expense' && activeShift) {
      activeShift.cashExpenses += amount;
      activeShift.expectedCash -= amount;
      this.activeCashShift.set({ ...activeShift });
    }
  }

  /**
   * Transferencia entre Cuentas
   */
  async transferBetweenAccounts(fromId: string, toId: string, amount: number, description: string): Promise<void> {
    const fromAcc = this.financialAccounts().find((a) => a.id === fromId);
    const toAcc = this.financialAccounts().find((a) => a.id === toId);
    if (!fromAcc || !toAcc) return;

    await this.createAccountMovement({
      accountId: fromId,
      movementType: 'transfer_out',
      amount: amount,
      description: `Transferencia a ${toAcc.name}: ${description}`,
      referenceType: 'transfer',
    });

    await this.createAccountMovement({
      accountId: toId,
      movementType: 'transfer_in',
      amount: amount,
      description: `Transferencia desde ${fromAcc.name}: ${description}`,
      referenceType: 'transfer',
    });
  }

  /**
   * Crear nueva Cuenta Financiera (Caja, Banco, Billetera Digital)
   */
  async createFinancialAccount(params: {
    name: string;
    type: AccountType;
    initialBalance?: number;
  }): Promise<FinancialAccount> {
    const cleanName = params.name.trim();
    const balance = Number(params.initialBalance) || 0;

    let accountId = '';
    let createdAt = new Date().toISOString();

    if (this.supabaseService.isConfigured()) {
      try {
        const { data, error } = await this.supabaseService.supabase
          .from('financial_accounts')
          .insert({
            name: cleanName,
            type: params.type,
            current_balance: balance,
            is_active: true,
          })
          .select('id, name, type, current_balance, is_active, created_at')
          .single();

        if (error) {
          this.logger.error('BarberService', 'Error creando cuenta en Supabase', error);
          throw error;
        } else if (data) {
          accountId = data.id;
          createdAt = data.created_at || createdAt;

          // Si se indicó un saldo inicial mayor a cero, registrar movimiento contable
          if (balance > 0) {
            try {
              await this.supabaseService.supabase.from('account_movements').insert({
                account_id: data.id,
                movement_type: 'income',
                amount: balance,
                description: 'Saldo inicial de apertura de cuenta',
                reference_type: 'manual',
              });
            } catch (movErr) {
              this.logger.warn('BarberService', 'Aviso al registrar movimiento inicial de cuenta', movErr);
            }
          }
        }
      } catch (err) {
        this.logger.error('BarberService', 'Excepción creando cuenta en Supabase', err);
        throw err;
      }
    } else {
      accountId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'offline-acc';
    }

    const newAccount: FinancialAccount = {
      id: accountId,
      name: cleanName,
      type: params.type,
      currentBalance: balance,
      isActive: true,
      createdAt,
    };

    const updatedAccounts = [...this.financialAccounts(), newAccount];
    this.financialAccounts.set(updatedAccounts);
    this.saveToStorage(STORAGE_KEYS.FINANCIAL_ACCOUNTS, updatedAccounts);

    return newAccount;
  }

  /**
   * Actualizar Cuenta Financiera existente
   */
  async updateFinancialAccount(id: string, updates: {
    name?: string;
    isActive?: boolean;
  }): Promise<void> {
    const accounts = this.financialAccounts();
    const target = accounts.find((a) => a.id === id);
    if (!target) return;

    if (updates.name !== undefined) target.name = updates.name.trim();
    if (updates.isActive !== undefined) target.isActive = updates.isActive;

    this.financialAccounts.set([...accounts]);
    this.saveToStorage(STORAGE_KEYS.FINANCIAL_ACCOUNTS, accounts);

    if (this.supabaseService.isConfigured()) {
      try {
        const payload: any = {};
        if (updates.name !== undefined) payload.name = updates.name.trim();
        if (updates.isActive !== undefined) payload.is_active = updates.isActive;

        const { error } = await this.supabaseService.supabase
          .from('financial_accounts')
          .update(payload)
          .eq('id', id);

        if (error) {
          this.logger.error('BarberService', 'Error actualizando cuenta en Supabase', error);
        }
      } catch (err) {
        this.logger.error('BarberService', 'Excepción actualizando cuenta', err);
      }
    }
  }

  /**
   * Crear Servicio en Catálogo
   */
  async createService(name: string, price: number, durationMinutes: number): Promise<ServiceItem> {
    const cleanName = name.trim();
    const cleanPrice = Number(price);
    const cleanDuration = Number(durationMinutes);

    let serviceId = '';

    if (this.supabaseService.isConfigured()) {
      try {
        const { data, error } = await this.supabaseService.supabase
          .from('services')
          .insert({
            name: cleanName,
            base_price: cleanPrice,
            duration_minutes: cleanDuration,
            is_active: true,
          })
          .select('id')
          .single();

        if (error) {
          this.logger.error('BarberService', 'Error al insertar servicio en Supabase', error);
          throw error;
        } else if (data) {
          serviceId = data.id;
        }
      } catch (err) {
        this.logger.error('BarberService', 'Excepción insertando servicio en Supabase', err);
        throw err;
      }
    } else {
      serviceId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'offline-srv';
    }

    const newSrv: ServiceItem = {
      id: serviceId,
      name: cleanName,
      price: cleanPrice,
      durationMinutes: cleanDuration,
      isActive: true,
    };

    const updated = [...this.services(), newSrv];
    this.services.set(updated);
    this.saveToStorage(STORAGE_KEYS.SERVICES, updated);

    return newSrv;
  }

  /**
   * Actualizar Servicio en Catálogo
   */
  async updateService(id: string, name: string, price: number, durationMinutes: number, isActive: boolean): Promise<void> {
    const updated = this.services().map((s) =>
      s.id === id ? { ...s, name: name.trim(), price: Number(price), durationMinutes: Number(durationMinutes), isActive } : s
    );
    this.services.set(updated);
    this.saveToStorage(STORAGE_KEYS.SERVICES, updated);

    if (this.supabaseService.isConfigured()) {
      try {
        await this.supabaseService.supabase
          .from('services')
          .update({
            name: name.trim(),
            base_price: Number(price),
            duration_minutes: Number(durationMinutes),
            is_active: isActive,
          })
          .eq('id', id);
      } catch (err) {
        this.logger.error('BarberService', 'Error al actualizar servicio en Supabase', err);
      }
    }
  }

  /**
   * Alternar estado activo de un Servicio
   */
  async toggleServiceStatus(id: string, isActive: boolean): Promise<void> {
    const srv = this.services().find((s) => s.id === id);
    if (!srv) return;
    await this.updateService(id, srv.name, srv.price, srv.durationMinutes, isActive);
  }

  /**
   * Agendar cita / turno
   */
  /**
   * Agendar cita / turno (soporta multi-servicio, combos y citas abiertas)
   */
  async bookAppointment(params: {
    clientId: string;
    barberId: string;
    serviceId?: string;
    services?: AppointmentServiceItem[];
    date: string;
    time: string;
    notes?: string;
  }): Promise<Appointment> {
    if (isPastDateTime(params.date, params.time)) {
      throw new Error('No es posible agendar una cita en una fecha u horario que ya ha transcurrido.');
    }

    const client = this.clients().find((c) => c.id === params.clientId) || this.currentClient();
    const barber = this.barbers().find((b) => b.id === params.barberId) || this.barbers()[0];

    // Resolver lista de servicios (multi-servicio / combos / o por definir)
    let servicesList: AppointmentServiceItem[] = [];
    let primaryServiceId = '';
    let serviceNames = '';
    let totalPrice = 0;
    let totalDuration = 30;

    if (params.services && params.services.length > 0) {
      servicesList = params.services;
      const validFirst = servicesList.find((s) => s.serviceId !== 'to_define');
      primaryServiceId = validFirst ? validFirst.serviceId : (this.services()[0]?.id || '');
      serviceNames = servicesList.map((s) => s.name).join(' + ');
      totalPrice = servicesList.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
      totalDuration = servicesList.reduce((sum, s) => sum + (Number(s.durationMinutes) || 0), 0);
    } else if (params.serviceId === 'to_define') {
      servicesList = [{ serviceId: 'to_define', name: 'Por definir / Asesoría en sillón', price: 0, durationMinutes: 30 }];
      primaryServiceId = this.services()[0]?.id || '';
      serviceNames = 'Por definir / Asesoría en sillón';
      totalPrice = 0;
      totalDuration = 30;
    } else {
      const s = this.services().find((srv) => srv.id === params.serviceId) || this.services()[0];
      if (s) {
        servicesList = [{ serviceId: s.id, name: s.name, price: s.price, durationMinutes: s.durationMinutes }];
        primaryServiceId = s.id;
        serviceNames = s.name;
        totalPrice = s.price;
        totalDuration = s.durationMinutes;
      }
    }

    let appointmentId = '';

    if (this.supabaseService.isConfigured()) {
      try {
        const scheduledAt = new Date(`${params.date}T${params.time}:00`).toISOString();
        const { data, error } = await this.supabaseService.supabase
          .from('appointments')
          .insert({
            customer_id: client.id,
            barber_id: barber.id,
            service_id: primaryServiceId || this.services()[0]?.id,
            scheduled_at: scheduledAt,
            status: 'confirmed',
            services_details: servicesList,
            total_duration_minutes: totalDuration,
          })
          .select('id')
          .single();

        if (error) {
          this.logger.error('BarberService', 'Error al agendar cita en Supabase', error);
          throw error;
        } else if (data) {
          appointmentId = data.id;
        }
      } catch (e) {
        this.logger.error('BarberService', 'Excepción al agendar cita en Supabase', e);
        throw e;
      }
    } else {
      appointmentId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'offline-apt';
    }

    const newApt: Appointment = {
      id: appointmentId,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      barberId: barber.id,
      barberName: barber.name,
      serviceId: primaryServiceId,
      serviceName: serviceNames,
      services: servicesList,
      totalDurationMinutes: totalDuration,
      date: params.date,
      time: params.time,
      price: totalPrice,
      status: 'confirmed',
      notes: params.notes,
    };

    const updated = [newApt, ...this.appointments()];
    this.appointments.set(updated);
    this.saveToStorage(STORAGE_KEYS.APPOINTMENTS, updated);

    return newApt;
  }

  /**
   * Actualizar / Editar cita existente (modificar servicios, barbero, horario o notas)
   */
  async updateAppointment(id: string, params: {
    clientId?: string;
    barberId?: string;
    serviceId?: string;
    services?: AppointmentServiceItem[];
    date?: string;
    time?: string;
    notes?: string;
    status?: AppointmentStatus;
  }): Promise<Appointment> {
    const existing = this.appointments().find((a) => a.id === id);
    if (!existing) throw new Error('Cita no encontrada');

    let servicesList = params.services || existing.services || [];
    let primaryServiceId = existing.serviceId;
    let serviceNames = existing.serviceName;
    let totalPrice = existing.price;
    let totalDuration = existing.totalDurationMinutes || 30;

    if (params.services && params.services.length > 0) {
      servicesList = params.services;
      const validFirst = servicesList.find((s) => s.serviceId !== 'to_define');
      primaryServiceId = validFirst ? validFirst.serviceId : (this.services()[0]?.id || '');
      serviceNames = servicesList.map((s) => s.name).join(' + ');
      totalPrice = servicesList.reduce((acc, s) => acc + (Number(s.price) || 0), 0);
      totalDuration = servicesList.reduce((acc, s) => acc + (Number(s.durationMinutes) || 0), 0);
    } else if (params.serviceId) {
      if (params.serviceId === 'to_define') {
        servicesList = [{ serviceId: 'to_define', name: 'Por definir / Asesoría en sillón', price: 0, durationMinutes: 30 }];
        serviceNames = 'Por definir / Asesoría en sillón';
        totalPrice = 0;
        totalDuration = 30;
      } else {
        const s = this.services().find((srv) => srv.id === params.serviceId);
        if (s) {
          servicesList = [{ serviceId: s.id, name: s.name, price: s.price, durationMinutes: s.durationMinutes }];
          primaryServiceId = s.id;
          serviceNames = s.name;
          totalPrice = s.price;
          totalDuration = s.durationMinutes;
        }
      }
    }

    const client = params.clientId ? (this.clients().find((c) => c.id === params.clientId) || this.currentClient()) : { id: existing.clientId, name: existing.clientName, phone: existing.clientPhone };
    const barber = params.barberId ? (this.barbers().find((b) => b.id === params.barberId) || this.barbers()[0]) : { id: existing.barberId, name: existing.barberName };

    const updatedApt: Appointment = {
      ...existing,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      barberId: barber.id,
      barberName: barber.name,
      serviceId: primaryServiceId,
      serviceName: serviceNames,
      services: servicesList,
      totalDurationMinutes: totalDuration,
      price: totalPrice,
      date: params.date || existing.date,
      time: params.time || existing.time,
      notes: params.notes !== undefined ? params.notes : existing.notes,
      status: params.status || existing.status,
    };

    const updated = this.appointments().map((a) => (a.id === id ? updatedApt : a));
    this.appointments.set(updated);
    this.saveToStorage(STORAGE_KEYS.APPOINTMENTS, updated);

    if (this.supabaseService.isConfigured()) {
      try {
        const scheduledAt = new Date(`${updatedApt.date}T${updatedApt.time}:00`).toISOString();
        const dbStatus = toDbAppointmentStatus(updatedApt.status);
        const { error } = await this.supabaseService.supabase
          .from('appointments')
          .update({
            customer_id: updatedApt.clientId,
            barber_id: updatedApt.barberId,
            service_id: updatedApt.serviceId,
            scheduled_at: scheduledAt,
            status: dbStatus,
            services_details: updatedApt.services || [],
            total_duration_minutes: updatedApt.totalDurationMinutes || 30,
          })
          .eq('id', id);

        if (error) {
          this.logger.error('BarberService', 'Error al actualizar cita en Supabase', error);
        }
      } catch (e) {
        this.logger.error('BarberService', 'Excepción al actualizar cita en Supabase', e);
      }
    }

    return updatedApt;
  }

  async updateAppointmentStatus(id: string, status: Appointment['status']): Promise<void> {
    const target = this.appointments().find((a) => a.id === id);
    if (!target) return;

    const previousAppointments = this.appointments();
    const updated = previousAppointments.map((a) => (a.id === id ? { ...a, status } : a));
    this.appointments.set(updated);
    this.saveToStorage(STORAGE_KEYS.APPOINTMENTS, updated);

    if (this.supabaseService.isConfigured()) {
      try {
        const dbStatus = toDbAppointmentStatus(status);
        const { error } = await this.supabaseService.supabase
          .from('appointments')
          .update({ status: dbStatus })
          .eq('id', id);

        if (error) {
          this.logger.error('BarberService', 'Error al actualizar estado de cita en Supabase. Revirtiendo...', error);
          this.appointments.set(previousAppointments);
          this.saveToStorage(STORAGE_KEYS.APPOINTMENTS, previousAppointments);
          throw error;
        }
      } catch (err) {
        this.appointments.set(previousAppointments);
        this.saveToStorage(STORAGE_KEYS.APPOINTMENTS, previousAppointments);
        throw err;
      }
    }
  }

  addReview(rating: number, comment: string): void {
    const newRev: Review = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '',
      clientName: this.currentClient().name,
      barberName: 'Carlos "Fade" Mendez',
      rating,
      comment,
      date: 'Hoy',
    };
    const updated = [newRev, ...this.reviews()];
    this.reviews.set(updated);
    this.saveToStorage(STORAGE_KEYS.REVIEWS, updated);
  }

  /**
   * Crear Usuario de Sistema (Admin, Barbero o Cliente)
   * Invoca la Edge Function create-staff-user si se proporcionan credenciales de acceso,
   * con fallback seguro a perfiles directos en entornos locales u offline.
   */
  async createSystemUser(params: {
    fullName: string;
    email?: string;
    password?: string;
    phone?: string;
    role: UserRole;
    isActive?: boolean;
  }): Promise<SystemUser> {
    const cleanName = params.fullName.trim();
    const cleanEmail = params.email?.trim().toLowerCase() || '';
    const cleanPhone = params.phone?.trim() || '';
    const role = params.role;
    const isActive = params.isActive ?? true;

    let userId = '';
    let createdAt = new Date().toISOString();

    if (this.supabaseService.isConfigured()) {
      // 1. Si se proporciona email y password, intentar vía Edge Function create-staff-user
      if (cleanEmail && params.password) {
        try {
          const { data, error } = await this.supabaseService.supabase.functions.invoke('create-staff-user', {
            body: {
              fullName: cleanName,
              email: cleanEmail,
              password: params.password,
              phone: cleanPhone,
              role: role,
              isActive: isActive,
            },
          });

          if (!error && data?.success && data?.user) {
            this.logger.info('BarberService', `Colaborador creado exitosamente con Edge Function: ${cleanEmail}`);
            const newUser: SystemUser = {
              id: data.user.id,
              fullName: data.user.fullName,
              email: data.user.email,
              phone: data.user.phone,
              role: data.user.role,
              isActive: data.user.isActive,
              createdAt: data.user.createdAt,
            };
            this.systemUsers.set([newUser, ...this.systemUsers()]);
            return newUser;
          } else if (error) {
            this.logger.warn('BarberService', 'Edge function create-staff-user no respondió o no está desplegada, usando fallback directo', error);
          }
        } catch (efErr) {
          this.logger.warn('BarberService', 'Aviso al invocar Edge Function, usando fallback de perfiles', efErr);
        }
      }

      // 2. Fallback directo en tabla profiles (cuando no hay Edge Function desplegada)
      try {
        const { data, error } = await this.supabaseService.supabase
          .from('profiles')
          .insert({
            full_name: cleanName,
            phone: cleanPhone || null,
            role: role,
            is_active: isActive,
          })
          .select('id, created_at')
          .single();

        if (error) {
          this.logger.error('BarberService', 'Error creando perfil de usuario en Supabase', error);
          throw error;
        } else if (data) {
          userId = data.id;
          createdAt = data.created_at || createdAt;
        }
      } catch (err) {
        this.logger.error('BarberService', 'Excepción creando usuario de sistema', err);
        throw err;
      }
    } else {
      userId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'offline-usr';
    }

    const newUser: SystemUser = {
      id: userId,
      fullName: cleanName,
      email: cleanEmail || undefined,
      phone: cleanPhone,
      role: role,
      isActive: isActive,
      createdAt,
    };

    this.systemUsers.set([newUser, ...this.systemUsers()]);

    return newUser;
  }

  /**
   * Actualizar Usuario de Sistema
   */
  async updateSystemUser(
    id: string,
    params: { fullName: string; phone?: string; role: UserRole; isActive?: boolean }
  ): Promise<void> {
    const updated = this.systemUsers().map((u) =>
      u.id === id
        ? {
          ...u,
          fullName: params.fullName.trim(),
          phone: params.phone?.trim() || '',
          role: params.role,
          isActive: params.isActive ?? u.isActive,
        }
        : u
    );
    this.systemUsers.set(updated);

    if (this.supabaseService.isConfigured()) {
      try {
        await this.supabaseService.supabase
          .from('profiles')
          .update({
            full_name: params.fullName.trim(),
            phone: params.phone?.trim() || null,
            role: params.role,
            is_active: params.isActive,
          })
          .eq('id', id);
      } catch (err) {
        this.logger.error('BarberService', 'Error actualizando usuario en Supabase', err);
      }
    }
  }


  /**
   * Alternar estado activo/inactivo de Usuario de Sistema
   */
  async toggleSystemUserStatus(id: string, isActive: boolean): Promise<void> {
    const target = this.systemUsers().find((u) => u.id === id);
    if (!target) return;
    await this.updateSystemUser(id, {
      fullName: target.fullName,
      phone: target.phone,
      role: target.role,
      isActive,
    });
  }

  // ===========================================================================
  // LOYALTY REWARDS CRUD
  // ===========================================================================

  /**
   * Create or update a loyalty reward rule.
   */
  async saveLoyaltyReward(params: {
    id?: string;
    name: string;
    description?: string;
    rewardType: string;
    stampsRequired: number;
    rewardValue?: number | null;
    isActive: boolean;
    sortOrder?: number;
  }): Promise<void> {
    const payload = {
      name: params.name.trim(),
      description: params.description?.trim() || null,
      reward_type: params.rewardType,
      stamps_required: params.stampsRequired,
      reward_value: params.rewardValue ?? null,
      is_active: params.isActive,
      sort_order: params.sortOrder ?? 0,
    };

    try {
      if (params.id) {
        const { error } = await this.supabaseService.supabase
          .from('loyalty_rewards')
          .update(payload)
          .eq('id', params.id);
        if (error) throw error;
      } else {
        const { error } = await this.supabaseService.supabase
          .from('loyalty_rewards')
          .insert(payload);
        if (error) throw error;
      }
      await this.syncFromSupabase();
    } catch (err) {
      this.logger.error('BarberService', 'Error al guardar loyalty_reward', err);
      throw err;
    }
  }

  /**
   * Toggle active/inactive state of a loyalty reward.
   */
  async toggleLoyaltyReward(id: string, isActive: boolean): Promise<void> {
    try {
      const { error } = await this.supabaseService.supabase
        .from('loyalty_rewards')
        .update({ is_active: isActive })
        .eq('id', id);
      if (error) throw error;
      this.loyaltyRewards.update((list) =>
        list.map((r) => (r.id === id ? { ...r, isActive } : r))
      );
    } catch (err) {
      this.logger.error('BarberService', 'Error al cambiar estado de loyalty_reward', err);
      throw err;
    }
  }

  /**
   * Delete or soft-delete a loyalty reward.
   * If historic claims reference it, soft-deletes (is_active = false) to preserve referential integrity.
   */
  async deleteLoyaltyReward(id: string): Promise<void> {
    try {
      if (this.supabaseService.isConfigured()) {
        const { error } = await this.supabaseService.supabase
          .from('loyalty_rewards')
          .delete()
          .eq('id', id);

        if (error) {
          this.logger.warn('BarberService', 'Premio con canjes asociados; aplicando soft-delete (is_active = false)', error);
          const { error: softErr } = await this.supabaseService.supabase
            .from('loyalty_rewards')
            .update({ is_active: false })
            .eq('id', id);
          if (softErr) throw softErr;
        }
      }
      this.loyaltyRewards.update((list) => list.filter((r) => r.id !== id));
    } catch (err) {
      this.logger.error('BarberService', 'Error al eliminar/desactivar loyalty_reward', err);
      throw err;
    }
  }

  /**
   * Mark a pending reward claim as redeemed via the Supabase RPC.
   */
  async redeemRewardClaim(claimId: string, notes?: string): Promise<void> {
    try {
      const { error } = await this.supabaseService.supabase
        .rpc('redeem_loyalty_claim', { p_claim_id: claimId, p_notes: notes ?? null });
      if (error) throw error;
      // Remove from pending list locally (optimistic)
      this.pendingRewardClaims.update((list) => list.filter((c) => c.id !== claimId));
    } catch (err) {
      this.logger.error('BarberService', 'Error al canjear loyalty_reward_claim', err);
      throw err;
    }
  }

  private loadRole(): 'landing' | 'barber' | 'client' {
    if (typeof localStorage === 'undefined') return 'landing';
    const val = localStorage.getItem(STORAGE_KEYS.ROLE);
    if (val === 'barber' || val === 'client' || val === 'landing') return val;
    return 'landing';
  }

  /**
   * Actualizar configuración de negocio (nombre, moneda, modo de fidelización)
   */
  async updateBusinessSettings(updates: Partial<BusinessSettings>): Promise<void> {
    const current = this.businessSettings();
    const updated = { ...current, ...updates };
    this.businessSettings.set(updated);
    this.saveToStorage(STORAGE_KEYS.BUSINESS_SETTINGS, updated);

    if (this.supabaseService.isConfigured() && current.id && current.id !== 'default') {
      try {
        const payload: any = { updated_at: new Date().toISOString() };
        if (updates.businessName !== undefined) payload.business_name = updates.businessName;
        if (updates.currencySymbol !== undefined) payload.currency_symbol = updates.currencySymbol;
        if (updates.loyaltyMode !== undefined) payload.loyalty_mode = updates.loyaltyMode;

        const { error } = await this.supabaseService.supabase
          .from('business_settings')
          .update(payload)
          .eq('id', current.id);

        if (error) {
          this.logger.warn('BarberService', 'Aviso al actualizar business_settings en Supabase', error);
        }
      } catch (err) {
        this.logger.warn('BarberService', 'Excepción al guardar business_settings', err);
      }
    }
  }

  private loadFromStorage<T>(key: string, fallback: T): T {
    if (typeof localStorage === 'undefined') return fallback;
    try {
      const data = localStorage.getItem(key);
      if (!data) return fallback;
      const parsed = JSON.parse(data);
      // Purgar datos mock heredados si se detectan en el almacenamiento local
      if (Array.isArray(parsed) && parsed.length > 0) {
        const hasLegacyMock = parsed.some(
          (item: any) =>
            item?.id === 'cli-1' ||
            item?.id === 'srv-1' ||
            item?.id === 'cut-1' ||
            item?.id === 'apt-1' ||
            item?.id === 'barber-1'
        );
        if (hasLegacyMock) {
          localStorage.removeItem(key);
          return fallback;
        }
      }
      return parsed;
    } catch {
      return fallback;
    }
  }

  private saveToStorage(key: string, data: unknown): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // Ignorar errores de cuota de almacenamiento
    }
  }
}
