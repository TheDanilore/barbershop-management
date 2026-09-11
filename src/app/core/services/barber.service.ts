import { Injectable, computed, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { SupabaseService } from './supabase.service';
import {
  AccountMovement,
  AccountType,
  Appointment,
  AppointmentRow,
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
      currencySymbol: '$',
    })
  );

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

  // Métricas consolidadas — El servidor (RPC) tiene soberanía sobre el caché local para evitar estado residual
  readonly cutsToday = computed(() => {
    // Dar prioridad al RPC del servidor para evitar que datos locales desactualizados
    // muestren cortes que ya no existen en Supabase
    if (this.serverKpis()) return this.serverKpis()!.cutsToday;
    const todayStr = new Date().toISOString().slice(0, 10);
    return this.cuts().filter((c) => c.date.startsWith(todayStr)).length;
  });

  readonly cutsThisMonth = computed(() => {
    if (this.serverKpis()) return this.serverKpis()!.cutsThisMonth;
    const currentYearMonth = new Date().toISOString().slice(0, 7);
    return this.cuts().filter((c) => c.date.startsWith(currentYearMonth)).length;
  });

  readonly revenueToday = computed(() => {
    if (this.serverKpis()) return this.serverKpis()!.revenueToday;
    const todayStr = new Date().toISOString().slice(0, 10);
    return this.cuts().filter((c) => c.date.startsWith(todayStr)).reduce((sum, c) => sum + c.price, 0);
  });

  readonly revenueThisWeek = computed(() => {
    const localWeek = this.cuts().slice(0, 15).reduce((sum, c) => sum + c.price, 0);
    if (localWeek > 0) return localWeek;
    if (this.serverKpis()) return this.serverKpis()!.revenueThisWeek;
    return 0;
  });

  readonly revenueThisMonth = computed(() => {
    const currentYearMonth = new Date().toISOString().slice(0, 7);
    const localMonthRevenue = this.cuts().filter((c) => c.date.startsWith(currentYearMonth)).reduce((sum, c) => sum + c.price, 0);
    if (localMonthRevenue > 0) return localMonthRevenue;
    if (this.serverKpis()) return this.serverKpis()!.revenueThisMonth;
    return 0;
  });

  readonly totalRevenue = computed(() => {
    const localTotal = this.cuts().reduce((sum, c) => sum + c.price, 0);
    if (this.serverKpis() && this.serverKpis()!.totalRevenue > localTotal) {
      return this.serverKpis()!.totalRevenue;
    }
    return localTotal;
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

  // Servicios más solicitados computados reactivamente desde el historial de cortes
  readonly topRequestedServices = computed(() => {
    const cutsList = this.cuts();
    const allServices = this.services();

    const countsMap = new Map<string, { id: string; name: string; price: number; count: number; revenue: number }>();

    for (const s of allServices) {
      countsMap.set(s.id, { id: s.id, name: s.name, price: s.price, count: 0, revenue: 0 });
    }

    for (const cut of cutsList) {
      const existing = countsMap.get(cut.serviceId);
      if (existing) {
        existing.count += 1;
        existing.revenue += cut.price;
      } else {
        countsMap.set(cut.serviceId, {
          id: cut.serviceId,
          name: cut.serviceName,
          price: cut.price,
          count: 1,
          revenue: cut.price,
        });
      }
    }

    const list = Array.from(countsMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.revenue - a.revenue;
    });

    const maxCount = Math.max(...list.map((l) => l.count), 1);

    return list.slice(0, 5).map((item) => ({
      ...item,
      percentage: item.count > 0 ? Math.round((item.count / maxCount) * 100) : 0,
    }));
  });

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
    const todayStr = new Date().toISOString().slice(0, 10);
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

        // Cargar business_settings (nombre, símbolo de moneda)
        const { data: bsData, error: bsError } = await this.supabaseService.supabase
          .from('business_settings')
          .select('id, business_name, currency_symbol')
          .limit(1)
          .maybeSingle();

        if (!bsError && bsData) {
          this.businessSettings.set({
            id: bsData.id,
            businessName: bsData.business_name ?? 'BarberTrack PRO',
            currencySymbol: bsData.currency_symbol ?? '$',
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

      // 4. Proyección quirúrgica de Ventas recientes con Join relacional seguro
      try {
        let salesData: any = null;
        let salesError: any = null;

        const res = await this.supabaseService.supabase
          .from('sales_history')
          .select(`
            id,
            final_price,
            payment_method,
            created_at,
            customer_id,
            barber_id,
            service_id,
            customer:profiles!sales_history_customer_id_fkey (id, full_name),
            barber:profiles!sales_history_barber_id_fkey (id, full_name)
          `)
          .order('created_at', { ascending: false })
          .limit(20);

        salesData = res.data;
        salesError = res.error;

        // Fallback a select plano si las restricciones foráneas están en actualización
        if (salesError) {
          const fallbackRes = await this.supabaseService.supabase
            .from('sales_history')
            .select('id, final_price, payment_method, created_at, customer_id, barber_id, service_id')
            .order('created_at', { ascending: false })
            .limit(20);
          salesData = fallbackRes.data;
          salesError = fallbackRes.error;
        }

        if (!salesError && salesData && salesData.length > 0) {
          const currentServices = this.services();
          const currentClients = this.clients();
          const currentBarbers = this.barbers();

          const mappedCuts: CutRecord[] = salesData.map((s: any) => {
            const cli = currentClients.find((c) => c.id === s.customer_id);
            const brb = currentBarbers.find((b) => b.id === s.barber_id);
            const srv = currentServices.find((sv) => sv.id === s.service_id);

            return {
              id: s.id,
              clientId: s.customer_id || '',
              clientName: s.customer?.full_name || cli?.name || 'Cliente General',
              barberId: s.barber_id || '',
              barberName: s.barber?.full_name || brb?.name || 'Barbero',
              serviceId: s.service_id || '',
              serviceName: srv?.name || 'Corte',
              price: Number(s.final_price),
              date: s.created_at,
              paymentMethod: (s.payment_method as PaymentMethod) || 'cash',
            };
          });
          this.cuts.set(mappedCuts);
          this.saveToStorage(STORAGE_KEYS.CUTS, mappedCuts);
        } else if (!salesError && salesData && salesData.length === 0) {
          const localUnsynced = this.cuts().filter((c) => c.id.startsWith('cut-'));
          if (localUnsynced.length === 0) {
            this.cuts.set([]);
            this.saveToStorage(STORAGE_KEYS.CUTS, []);
          }
        }
      } catch (err) {
        this.logger.warn('BarberService', 'Aviso sincronizando ventas', err);
      }

      // 5. Proyección de Citas / Agenda desde Supabase
      try {
        const { data: aptsData, error: aptsError } = await this.supabaseService.supabase
          .from('appointments')
          .select(`
            id,
            customer_id,
            barber_id,
            service_id,
            scheduled_at,
            status,
            customer:profiles!appointments_customer_id_fkey (id, full_name, phone),
            barber:profiles!appointments_barber_id_fkey (id, full_name),
            service:services!appointments_service_id_fkey (id, name, base_price)
          `)
          .order('scheduled_at', { ascending: true });

        if (!aptsError && aptsData && aptsData.length > 0) {
          const mappedApts: Appointment[] = aptsData.map((a: any) => {
            const dt = new Date(a.scheduled_at);
            const dateStr = dt.toISOString().slice(0, 10);
            const timeStr = dt.toTimeString().slice(0, 5);
            return {
              id: a.id,
              clientId: a.customer_id,
              clientName: a.customer?.full_name || 'Cliente',
              clientPhone: a.customer?.phone || '',
              barberId: a.barber_id,
              barberName: a.barber?.full_name || 'Barbero',
              serviceId: a.service_id,
              serviceName: a.service?.name || 'Corte',
              date: dateStr,
              time: timeStr,
              price: Number(a.service?.base_price || 15),
              status: a.status as any,
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
   * Registro atómico de corte:
   * En Supabase: inserta en `sales_history` y el Trigger de PostgreSQL actualiza fidelidad atómicamente.
   * Soporta cobro de contado (efectivo, tarjeta, transferencia) o Al Crédito (Fiar).
   */
  async registerCut(params: {
    clientId: string;
    barberId: string;
    serviceId: string;
    customPrice?: number;
    paymentMethod: PaymentMethod;
    notes?: string;
    isCredit?: boolean;
  }): Promise<CutRecord> {
    const client = this.clients().find((c) => c.id === params.clientId);
    const barber = this.barbers().find((b) => b.id === params.barberId) || this.barbers()[0];
    const service = this.services().find((s) => s.id === params.serviceId) || this.services()[0];

    const finalPrice =
      params.customPrice !== undefined && params.customPrice !== null && !isNaN(params.customPrice)
        ? Number(params.customPrice)
        : service.price;

    const actualPaymentMethod: PaymentMethod = params.isCredit ? 'credit' : params.paymentMethod;

    const newCut: CutRecord = {
      id: 'cut-' + Date.now(),
      clientId: params.clientId,
      clientName: client ? client.name : 'Cliente General',
      barberId: barber.id,
      barberName: barber.name,
      serviceId: service.id,
      serviceName: service.name,
      price: finalPrice,
      date: new Date().toISOString(),
      paymentMethod: actualPaymentMethod,
      notes: params.notes,
    };

    // Actualización local inmediata (Optimistic UI)
    const updatedCuts = [newCut, ...this.cuts()];
    this.cuts.set(updatedCuts);
    this.saveToStorage(STORAGE_KEYS.CUTS, updatedCuts);

    if (client) {
      const newCutsCount = client.cutsCount + 1;
      const newStamps = client.loyaltyStamps + 1;
      let newLevel: MembershipTier = client.membershipLevel;

      if (newCutsCount >= 15) newLevel = 'VIP';
      else if (newCutsCount >= 8) newLevel = 'Gold';
      else if (newCutsCount >= 3) newLevel = 'Silver';
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
            lastVisitDate: new Date().toISOString().slice(0, 10),
          }
          : c
      );
      this.clients.set(updatedClients);
      this.saveToStorage(STORAGE_KEYS.CLIENTS, updatedClients);
    }

    const activeShift = this.activeCashShift();

    // Persistir en Supabase
    if (this.supabaseService.isConfigured()) {
      try {
        const isClientReal = !params.clientId.startsWith('cli-');
        const activeProfile = this.supabaseService.userProfile();
        const availableBarbers = this.barbers();
        const availableServices = this.services();

        const realBarberId = (!params.barberId.startsWith('barber-') && params.barberId)
          ? params.barberId
          : (activeProfile?.id || availableBarbers[0]?.id || null);

        const realServiceId = (!params.serviceId.startsWith('srv-') && params.serviceId)
          ? params.serviceId
          : (availableServices[0]?.id || null);

        const shiftIdReal = activeShift && !activeShift.id.startsWith('shift-') ? activeShift.id : null;

        const { data: saleData, error } = await this.supabaseService.supabase
          .from('sales_history')
          .insert({
            customer_id: isClientReal ? params.clientId : null,
            barber_id: realBarberId,
            service_id: realServiceId,
            final_price: finalPrice,
            payment_method: actualPaymentMethod,
            amount_paid: params.isCredit ? 0 : finalPrice,
            amount_debt: params.isCredit ? finalPrice : 0,
            shift_id: shiftIdReal,
          })
          .select('id')
          .single();

        const saleId = saleData?.id;

        if (saleId) {
          newCut.id = saleId;
          const currentCuts = this.cuts().map((c) => (c.id === newCut.id ? newCut : c));
          this.cuts.set(currentCuts);
          this.saveToStorage(STORAGE_KEYS.CUTS, currentCuts);
        }

        if (error) {
          this.logger.error('BarberService', 'Error al insertar venta en Supabase', error);
        } else {
          this.logger.info('BarberService', 'Venta persistida con éxito en Supabase');
        }

        // Si es crédito, registrar en customer_credit_movements (CHARGE)
        if (params.isCredit && isClientReal) {
          try {
            // Asegurar cuenta de crédito
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
              await this.supabaseService.supabase.from('customer_credit_movements').insert({
                customer_credit_id: creditAccId,
                sale_id: saleId || null,
                movement_type: 'CHARGE',
                amount: finalPrice,
                payment_method: 'credit',
                notes: `Corte fiado: ${service.name}`,
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

          if (targetAcc && !targetAcc.id.startsWith('acc-')) {
            try {
              await this.supabaseService.supabase.from('account_movements').insert({
                account_id: targetAcc.id,
                movement_type: 'income',
                amount: finalPrice,
                description: `Cobro: ${service.name} (${client?.name || 'Cliente'})`,
                reference_type: 'sale',
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
            if (!activeShift.id.startsWith('shift-')) {
              await this.supabaseService.supabase
                .from('cash_shifts')
                .update({
                  cash_sales: activeShift.cashSales,
                  expected_cash: activeShift.expectedCash,
                })
                .eq('id', activeShift.id);
            }
          }
        }
      } catch (e) {
        this.logger.error('BarberService', 'Excepción de red en registerCut', e);
      }
    }

    return newCut;
  }

  /**
   * Crear nuevo cliente (Solo nombre obligatorio)
   */
  async createClient(name: string, phone: string = '', email?: string, notes?: string): Promise<Client> {
    const cleanName = name.trim();
    const cleanPhone = phone && phone.trim() ? phone.trim() : '';

    const newClient: Client = {
      id: 'cli-' + Date.now(),
      name: cleanName,
      phone: cleanPhone,
      email: email?.trim(),
      cutsCount: 0,
      loyaltyStamps: 0,
      membershipLevel: 'Bronze',
      lastVisitDate: new Date().toISOString().slice(0, 10),
      notes,
      currentDebt: 0,
      creditLimit: 0,
    };

    const updated = [newClient, ...this.clients()];
    this.clients.set(updated);
    this.saveToStorage(STORAGE_KEYS.CLIENTS, updated);

    // Persistir en Supabase
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
        } else if (data) {
          newClient.id = data.id;
          this.clients.set([newClient, ...this.clients().filter((c) => c.id !== newClient.id)]);
          this.saveToStorage(STORAGE_KEYS.CLIENTS, this.clients());

          // Inicializar cuenta de crédito
          await this.supabaseService.supabase.from('customer_credits').insert({
            profile_id: data.id,
            current_debt: 0,
            credit_limit: 0,
          });
        }
      } catch (e) {
        this.logger.error('BarberService', 'Excepción al crear cliente en Supabase', e);
      }
    }

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
    client.currentDebt = Math.max(0, (client.currentDebt || 0) - amount);
    this.clients.set([...this.clients()]);
    this.saveToStorage(STORAGE_KEYS.CLIENTS, this.clients());

    const acc = this.financialAccounts().find((a) => a.id === params.accountId) || this.financialAccounts()[0];
    if (acc) {
      acc.currentBalance += amount;
      this.financialAccounts.set([...this.financialAccounts()]);
    }

    const activeShift = this.activeCashShift();
    if (acc?.type === 'cash' && activeShift) {
      activeShift.cashSales += amount;
      activeShift.expectedCash += amount;
      this.activeCashShift.set({ ...activeShift });
    }

    // Registrar en Supabase
    if (this.supabaseService.isConfigured() && !params.clientId.startsWith('cli-')) {
      try {
        const { data: cData } = await this.supabaseService.supabase
          .from('customer_credits')
          .select('id')
          .eq('profile_id', params.clientId)
          .maybeSingle();

        const shiftIdReal = activeShift && !activeShift.id.startsWith('shift-') ? activeShift.id : null;

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

        if (acc && !acc.id.startsWith('acc-')) {
          await this.supabaseService.supabase.from('account_movements').insert({
            account_id: acc.id,
            movement_type: 'income',
            amount: amount,
            description: `Abono de deuda: ${client.name}`,
            reference_type: 'credit_payment',
            shift_id: acc.type === 'cash' ? shiftIdReal : null,
          });

          // Sincronizar cash_shifts en Supabase ante abono en efectivo
          if (acc.type === 'cash' && activeShift && !activeShift.id.startsWith('shift-')) {
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
   * Apertura de Turno de Caja
   */
  async openCashShift(initialCash: number, notes?: string): Promise<CashShift> {
    const cashAcc = this.financialAccounts().find((a) => a.type === 'cash') || this.financialAccounts()[0];
    const profile = this.supabaseService.userProfile();
    const barberId = profile?.id || this.barbers()[0].id;

    const newShift: CashShift = {
      id: 'shift-' + Date.now(),
      accountId: cashAcc.id,
      barberId: barberId,
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

    if (this.supabaseService.isConfigured() && !cashAcc.id.startsWith('acc-') && !barberId.startsWith('barber-')) {
      try {
        const { data } = await this.supabaseService.supabase
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

        if (data) {
          newShift.id = data.id;
          this.activeCashShift.set(newShift);
        }
      } catch (err) {
        this.logger.error('BarberService', 'Error al abrir turno en Supabase', err);
      }
    }

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

    if (this.supabaseService.isConfigured() && !current.id.startsWith('shift-')) {
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

    const newMov: AccountMovement = {
      id: 'mov-' + Date.now(),
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

    if (this.supabaseService.isConfigured() && !acc.id.startsWith('acc-')) {
      try {
        const shiftIdReal = activeShift && !activeShift.id.startsWith('shift-') ? activeShift.id : null;
        await this.supabaseService.supabase.from('account_movements').insert({
          account_id: acc.id,
          movement_type: params.movementType,
          amount: amount,
          description: params.description.trim(),
          reference_type: params.referenceType || 'manual',
          shift_id: acc.type === 'cash' ? shiftIdReal : null,
        });

        // Sincronizar cash_shifts en Supabase ante egreso en efectivo
        if (acc.type === 'cash' && params.movementType === 'expense' && activeShift && !activeShift.id.startsWith('shift-')) {
          await this.supabaseService.supabase
            .from('cash_shifts')
            .update({
              cash_expenses: activeShift.cashExpenses,
              expected_cash: activeShift.expectedCash,
            })
            .eq('id', activeShift.id);
        }
      } catch (err) {
        this.logger.error('BarberService', 'Error al crear movimiento en Supabase', err);
      }
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

    const newAccount: FinancialAccount = {
      id: 'acc-' + Date.now(),
      name: cleanName,
      type: params.type,
      currentBalance: balance,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    // Actualización local inmediata
    const updatedAccounts = [...this.financialAccounts(), newAccount];
    this.financialAccounts.set(updatedAccounts);
    this.saveToStorage(STORAGE_KEYS.FINANCIAL_ACCOUNTS, updatedAccounts);

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
        } else if (data) {
          newAccount.id = data.id;
          newAccount.currentBalance = Number(data.current_balance);
          const finalAccounts = this.financialAccounts().map((a) => (a.id === newAccount.id ? newAccount : a));
          this.financialAccounts.set(finalAccounts);
          this.saveToStorage(STORAGE_KEYS.FINANCIAL_ACCOUNTS, finalAccounts);

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
        this.logger.error('BarberService', 'Excepción creando cuenta', err);
      }
    }

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

    if (this.supabaseService.isConfigured() && !id.startsWith('acc-')) {
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
    const newSrv: ServiceItem = {
      id: 'srv-' + Date.now(),
      name: name.trim(),
      price: Number(price),
      durationMinutes: Number(durationMinutes),
      isActive: true,
    };

    const updated = [...this.services(), newSrv];
    this.services.set(updated);
    this.saveToStorage(STORAGE_KEYS.SERVICES, updated);

    if (this.supabaseService.isConfigured()) {
      try {
        const { data, error } = await this.supabaseService.supabase
          .from('services')
          .insert({
            name: newSrv.name,
            base_price: newSrv.price,
            duration_minutes: newSrv.durationMinutes,
            is_active: true,
          })
          .select('id')
          .single();

        if (data) {
          newSrv.id = data.id;
          this.services.set([...this.services().filter((s) => s.id !== newSrv.id), newSrv]);
          this.saveToStorage(STORAGE_KEYS.SERVICES, this.services());
        }
      } catch (err) {
        this.logger.error('BarberService', 'Error al insertar servicio en Supabase', err);
      }
    }

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

    if (this.supabaseService.isConfigured() && !id.startsWith('srv-')) {
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
  async bookAppointment(params: {
    clientId: string;
    barberId: string;
    serviceId: string;
    date: string;
    time: string;
    notes?: string;
  }): Promise<Appointment> {
    const client = this.clients().find((c) => c.id === params.clientId) || this.currentClient();
    const barber = this.barbers().find((b) => b.id === params.barberId) || this.barbers()[0];
    const service = this.services().find((s) => s.id === params.serviceId) || this.services()[0];

    const newApt: Appointment = {
      id: 'apt-' + Date.now(),
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      barberId: barber.id,
      barberName: barber.name,
      serviceId: service.id,
      serviceName: service.name,
      date: params.date,
      time: params.time,
      price: service.price,
      status: 'confirmed',
      notes: params.notes,
    };

    const updated = [newApt, ...this.appointments()];
    this.appointments.set(updated);
    this.saveToStorage(STORAGE_KEYS.APPOINTMENTS, updated);

    if (this.supabaseService.isConfigured()) {
      try {
        const scheduledAt = new Date(`${params.date}T${params.time}:00`).toISOString();
        const { error } = await this.supabaseService.supabase.from('appointments').insert({
          customer_id: client.id.startsWith('cli-') ? null : client.id,
          barber_id: barber.id.startsWith('barber-') ? null : barber.id,
          service_id: service.id.startsWith('srv-') ? null : service.id,
          scheduled_at: scheduledAt,
          status: 'confirmed',
        });
        if (error) this.logger.error('BarberService', 'Error al agendar cita en Supabase', error);
      } catch (e) {
        this.logger.error('BarberService', 'Excepción al agendar cita en Supabase', e);
      }
    }

    return newApt;
  }

  updateAppointmentStatus(id: string, status: Appointment['status']): void {
    const target = this.appointments().find((a) => a.id === id);
    if (!target) return;

    const updated = this.appointments().map((a) => (a.id === id ? { ...a, status } : a));
    this.appointments.set(updated);
    this.saveToStorage(STORAGE_KEYS.APPOINTMENTS, updated);

    if (status === 'completed') {
      this.registerCut({
        clientId: target.clientId,
        barberId: target.barberId,
        serviceId: target.serviceId,
        paymentMethod: 'cash',
        notes: `Cita completada (${target.time})`,
      });
    }

    if (this.supabaseService.isConfigured() && !id.startsWith('apt-')) {
      this.supabaseService.supabase
        .from('appointments')
        .update({ status })
        .eq('id', id)
        .then(({ error }) => {
          if (error) this.logger.error('BarberService', 'Error al actualizar estado de cita', error);
        });
    }
  }

  addReview(rating: number, comment: string): void {
    const newRev: Review = {
      id: 'rev-' + Date.now(),
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
   */
  async createSystemUser(params: {
    fullName: string;
    phone?: string;
    role: UserRole;
    isActive?: boolean;
  }): Promise<SystemUser> {
    const newUser: SystemUser = {
      id: 'usr-' + Date.now(),
      fullName: params.fullName.trim(),
      phone: params.phone?.trim() || '',
      role: params.role,
      isActive: params.isActive ?? true,
      createdAt: new Date().toISOString(),
    };

    this.systemUsers.set([newUser, ...this.systemUsers()]);

    if (this.supabaseService.isConfigured()) {
      try {
        const { data, error } = await this.supabaseService.supabase
          .from('profiles')
          .insert({
            full_name: newUser.fullName,
            phone: newUser.phone || null,
            role: newUser.role,
            is_active: newUser.isActive,
          })
          .select('id')
          .single();

        if (data) {
          newUser.id = data.id;
          this.systemUsers.set([newUser, ...this.systemUsers().filter((u) => u.id !== newUser.id)]);
        }
        if (error) {
          this.logger.error('BarberService', 'Error creando perfil de usuario en Supabase', error);
        }
      } catch (err) {
        this.logger.error('BarberService', 'Excepción creando usuario de sistema', err);
      }
    }

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

    if (this.supabaseService.isConfigured() && !id.startsWith('usr-')) {
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
      if (this.supabaseService.isConfigured() && !id.startsWith('rwd-')) {
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
