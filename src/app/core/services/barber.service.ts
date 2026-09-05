import { Injectable, computed, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { SupabaseService } from './supabase.service';
import {
  Appointment,
  AppointmentRow,
  Barber,
  Client,
  CutRecord,
  DashboardKpis,
  PaymentMethod,
  Review,
  SaleHistoryRow,
  ServiceItem,
} from '../models/barber.models';

const STORAGE_KEYS = {
  CLIENTS: 'barbertrack_clients',
  CUTS: 'barbertrack_cuts',
  APPOINTMENTS: 'barbertrack_appointments',
  SERVICES: 'barbertrack_services',
  REVIEWS: 'barbertrack_reviews',
  ROLE: 'barbertrack_role',
  CURRENT_CLIENT_ID: 'barbertrack_current_client_id',
};

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

const INITIAL_SERVICES: ServiceItem[] = [
  {
    id: 'srv-1',
    name: 'Corte + Barba Premium',
    durationMinutes: 45,
    price: 15.0,
    description: 'Degradado a elección, perfilado con navaja, toalla caliente y bálsamo.',
    popular: true,
  },
  {
    id: 'srv-2',
    name: 'Corte Clásico / Fade',
    durationMinutes: 30,
    price: 10.0,
    description: 'Corte moderno o clásico, peinado con cera mate y acabado limpio.',
    popular: true,
  },
  {
    id: 'srv-3',
    name: 'Perfilado de Barba Ritual',
    durationMinutes: 25,
    price: 8.0,
    description: 'Afeitado al vapor, toalla caliente, aceites esenciales y navaja.',
  },
  {
    id: 'srv-4',
    name: 'Corte Niño (Hasta 12 años)',
    durationMinutes: 25,
    price: 8.0,
    description: 'Paciencia, estilo moderno y producto de fijación suave.',
  },
  {
    id: 'srv-5',
    name: 'Diseño Freestyle / Líneas',
    durationMinutes: 15,
    price: 5.0,
    description: 'Líneas personalizadas, tribales o detalles artísticos con navaja.',
  },
  {
    id: 'srv-6',
    name: 'Corte + Lavado y Exfoliación',
    durationMinutes: 40,
    price: 14.0,
    description: 'Lavado revitalizante, masaje capilar y exfoliación facial.',
  },
];

const INITIAL_BARBERS: Barber[] = [
  {
    id: 'barber-1',
    name: 'Carlos "Fade" Mendez',
    specialty: 'Master Barber & Skin Fade',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    rating: 4.9,
    totalCuts: 1420,
  },
  {
    id: 'barber-2',
    name: 'Alejandro Rivera',
    specialty: 'Especialista en Barbas y Navaja',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    rating: 4.8,
    totalCuts: 980,
  },
  {
    id: 'barber-3',
    name: 'Mateo Silva',
    specialty: 'Estilos Clásicos & Tijera',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    rating: 4.9,
    totalCuts: 1150,
  },
];

const INITIAL_CLIENTS: Client[] = [
  {
    id: 'cli-1',
    name: 'Danilo Ramos',
    phone: '+51 987 654 321',
    email: 'danilo@ejemplo.com',
    cutsCount: 8,
    loyaltyStamps: 7,
    membershipLevel: 'Gold',
    lastVisitDate: '2026-09-01',
    notes: 'Prefiere fade medio comprimido con textura arriba.',
  },
  {
    id: 'cli-2',
    name: 'Sebastián Morales',
    phone: '+51 912 345 678',
    email: 'sebas.m@ejemplo.com',
    cutsCount: 14,
    loyaltyStamps: 9,
    membershipLevel: 'VIP',
    lastVisitDate: '2026-08-28',
    notes: 'Corte clásico tijera, barba perfilada natural.',
  },
  {
    id: 'cli-3',
    name: 'Rodrigo Cáceres',
    phone: '+51 998 776 554',
    cutsCount: 4,
    loyaltyStamps: 4,
    membershipLevel: 'Silver',
    lastVisitDate: '2026-08-22',
  },
  {
    id: 'cli-4',
    name: 'Gabriel Torres',
    phone: '+51 933 221 100',
    cutsCount: 2,
    loyaltyStamps: 2,
    membershipLevel: 'Bronze',
    lastVisitDate: '2026-08-15',
  },
  {
    id: 'cli-5',
    name: 'Lucas Villena',
    phone: '+51 944 556 677',
    cutsCount: 19,
    loyaltyStamps: 3,
    membershipLevel: 'VIP',
    lastVisitDate: '2026-09-02',
  },
];

const INITIAL_CUTS: CutRecord[] = [
  {
    id: 'cut-1',
    clientId: 'cli-1',
    clientName: 'Danilo Ramos',
    barberId: 'barber-1',
    barberName: 'Carlos "Fade" Mendez',
    serviceId: 'srv-1',
    serviceName: 'Corte + Barba Premium',
    price: 15.0,
    date: '2026-09-04T18:30:00',
    paymentMethod: 'transfer',
  },
  {
    id: 'cut-2',
    clientId: 'cli-2',
    clientName: 'Sebastián Morales',
    barberId: 'barber-1',
    barberName: 'Carlos "Fade" Mendez',
    serviceId: 'srv-2',
    serviceName: 'Corte Clásico / Fade',
    price: 10.0,
    date: '2026-09-04T16:00:00',
    paymentMethod: 'cash',
  },
  {
    id: 'cut-3',
    clientId: 'cli-5',
    clientName: 'Lucas Villena',
    barberId: 'barber-2',
    barberName: 'Alejandro Rivera',
    serviceId: 'srv-3',
    serviceName: 'Perfilado de Barba Ritual',
    price: 8.0,
    date: '2026-09-04T14:15:00',
    paymentMethod: 'card',
  },
  {
    id: 'cut-4',
    clientId: 'cli-3',
    clientName: 'Rodrigo Cáceres',
    barberId: 'barber-1',
    barberName: 'Carlos "Fade" Mendez',
    serviceId: 'srv-2',
    serviceName: 'Corte Clásico / Fade',
    price: 10.0,
    date: '2026-09-03T19:00:00',
    paymentMethod: 'transfer',
  },
];

const INITIAL_APPOINTMENTS: Appointment[] = [
  {
    id: 'apt-1',
    clientId: 'cli-1',
    clientName: 'Danilo Ramos',
    clientPhone: '+51 987 654 321',
    barberId: 'barber-1',
    barberName: 'Carlos "Fade" Mendez',
    serviceId: 'srv-1',
    serviceName: 'Corte + Barba Premium',
    date: '2026-09-05',
    time: '10:00',
    price: 15.0,
    status: 'confirmed',
    notes: 'Puntual, toalla caliente extra.',
  },
  {
    id: 'apt-2',
    clientId: 'cli-2',
    clientName: 'Sebastián Morales',
    clientPhone: '+51 912 345 678',
    barberId: 'barber-1',
    barberName: 'Carlos "Fade" Mendez',
    serviceId: 'srv-2',
    serviceName: 'Corte Clásico / Fade',
    date: '2026-09-05',
    time: '11:15',
    price: 10.0,
    status: 'in-progress',
  },
  {
    id: 'apt-3',
    clientId: 'cli-3',
    clientName: 'Rodrigo Cáceres',
    clientPhone: '+51 998 776 554',
    barberId: 'barber-2',
    barberName: 'Alejandro Rivera',
    serviceId: 'srv-3',
    serviceName: 'Perfilado de Barba Ritual',
    date: '2026-09-05',
    time: '14:30',
    price: 8.0,
    status: 'confirmed',
  },
];

const INITIAL_REVIEWS: Review[] = [
  {
    id: 'rev-1',
    clientName: 'Danilo Ramos',
    barberName: 'Carlos "Fade" Mendez',
    rating: 5,
    comment: 'La mejor atención y el fade más pulido de la ciudad. El ritual de toalla caliente es de otro nivel.',
    date: 'Hace 2 días',
  },
  {
    id: 'rev-2',
    clientName: 'Sebastián Morales',
    barberName: 'Carlos "Fade" Mendez',
    rating: 5,
    comment: 'Excelente ambiente, puntualidad y precisión impecable en la barba.',
    date: 'Hace 4 días',
  },
];

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

  readonly currentClientId = signal<string>(this.loadFromStorage(STORAGE_KEYS.CURRENT_CLIENT_ID, 'cli-1'));

  // Cliente activo computado
  readonly currentClient = computed<Client>(() => {
    const found = this.clients().find((c) => c.id === this.currentClientId());
    return found || this.clients()[0] || INITIAL_CLIENTS[0];
  });

  // Métricas consolidadas (Prefiere KPIs de la RPC de Supabase si existen, o calcula reactivamente)
  readonly cutsToday = computed(() => {
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
    if (this.serverKpis()) return this.serverKpis()!.revenueThisWeek;
    return this.cuts().slice(0, 15).reduce((sum, c) => sum + c.price, 0);
  });

  readonly revenueThisMonth = computed(() => {
    if (this.serverKpis()) return this.serverKpis()!.revenueThisMonth;
    const currentYearMonth = new Date().toISOString().slice(0, 7);
    return this.cuts().filter((c) => c.date.startsWith(currentYearMonth)).reduce((sum, c) => sum + c.price, 0);
  });

  readonly totalRevenue = computed(() => {
    if (this.serverKpis()) return this.serverKpis()!.totalRevenue;
    return this.cuts().reduce((sum, c) => sum + c.price, 0);
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
      .filter((a) => a.date === todayStr || a.date === '2026-09-05')
      .sort((a, b) => a.time.localeCompare(b.time));
  });

  readonly clientAppointments = computed(() => {
    const cliId = this.currentClient().id;
    return this.appointments().filter((a) => a.clientId === cliId);
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
    this.logger.info('BarberService', 'Inicializando BarberService');
    // Solo sincronizar si el usuario ya está autenticado
    if (this.supabaseService.isConfigured() && this.supabaseService.estaAutenticado) {
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
    if (!this.supabaseService.isConfigured() || !this.supabaseService.estaAutenticado) {
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      this.logger.info('BarberService', 'Iniciando sincronización con Supabase');

      // 1. Cargar KPIs agregados vía RPC si la función existe en la base de datos
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

      // 2. Proyección quirúrgica de Servicios
      try {
        const { data: servicesData, error: srvError } = await this.supabaseService.supabase
          .from('services')
          .select('id, name, base_price, duration_minutes, is_active')
          .eq('is_active', true)
          .order('name');

        if (!srvError && servicesData && servicesData.length > 0) {
          const mappedServices: ServiceItem[] = servicesData.map((s) => ({
            id: s.id,
            name: s.name,
            durationMinutes: s.duration_minutes,
            price: Number(s.base_price),
          }));
          this.services.set(mappedServices);
          this.saveToStorage(STORAGE_KEYS.SERVICES, mappedServices);
        }
      } catch {
        // Usar servicios predeterminados
      }

      // 3. Proyección quirúrgica de Clientes con su progreso de fidelidad
      try {
        const { data: profilesData, error: profError } = await this.supabaseService.supabase
          .from('profiles')
          .select(`
            id,
            full_name,
            phone,
            membership_tier,
            avatar_url,
            loyalty_progress (current_stamps, total_historical_cuts)
          `)
          .eq('role', 'customer')
          .eq('is_active', true);

        if (!profError && profilesData && profilesData.length > 0) {
          const mappedClients: Client[] = profilesData.map((p) => {
            const lp = Array.isArray(p.loyalty_progress) ? p.loyalty_progress[0] : (p.loyalty_progress as any);
            return {
              id: p.id,
              name: p.full_name,
              phone: p.phone || '',
              cutsCount: lp?.total_historical_cuts ?? 0,
              loyaltyStamps: lp?.current_stamps ?? 0,
              membershipLevel: (p.membership_tier as any) || 'Bronze',
              avatarUrl: p.avatar_url || undefined,
            };
          });
          this.clients.set(mappedClients);
          this.saveToStorage(STORAGE_KEYS.CLIENTS, mappedClients);
        }
      } catch {
        // Usar clientes locales
      }

      // 4. Proyección quirúrgica de Ventas recientes con Join relacional
      try {
        const { data: salesData, error: salesError } = await this.supabaseService.supabase
          .from('sales_history')
          .select(`
            id,
            final_price,
            payment_method,
            created_at,
            customer:customer_id (id, full_name),
            barber:barber_id (id, full_name),
            service:service_id (id, name)
          `)
          .order('created_at', { ascending: false })
          .limit(20);

        if (!salesError && salesData && salesData.length > 0) {
          const mappedCuts: CutRecord[] = (salesData as unknown as SaleHistoryRow[]).map((s) => ({
            id: s.id,
            clientId: s.customer?.id || '',
            clientName: s.customer?.full_name || 'Cliente General',
            barberId: s.barber?.id || '',
            barberName: s.barber?.full_name || 'Barbero',
            serviceId: s.service?.id || '',
            serviceName: s.service?.name || 'Corte',
            price: Number(s.final_price),
            date: s.created_at,
            paymentMethod: (s.payment_method as PaymentMethod) || 'cash',
          }));
          this.cuts.set(mappedCuts);
          this.saveToStorage(STORAGE_KEYS.CUTS, mappedCuts);
        }
      } catch {
        // Usar historial local
      }

      this.logger.info('BarberService', 'Sincronización completada');
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
   * En Angular: actualiza el estado reactivo con Signals al instante.
   */
  async registerCut(params: {
    clientId: string;
    barberId: string;
    serviceId: string;
    customPrice?: number;
    paymentMethod: PaymentMethod;
    notes?: string;
  }): Promise<CutRecord> {
    const client = this.clients().find((c) => c.id === params.clientId);
    const barber = this.barbers().find((b) => b.id === params.barberId) || this.barbers()[0];
    const service = this.services().find((s) => s.id === params.serviceId) || this.services()[0];

    const finalPrice =
      params.customPrice !== undefined && params.customPrice !== null && !isNaN(params.customPrice)
        ? Number(params.customPrice)
        : service.price;

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
      paymentMethod: params.paymentMethod,
      notes: params.notes,
    };

    // Actualización local inmediata (Optimistic UI)
    const updatedCuts = [newCut, ...this.cuts()];
    this.cuts.set(updatedCuts);
    this.saveToStorage(STORAGE_KEYS.CUTS, updatedCuts);

    if (client) {
      const newCutsCount = client.cutsCount + 1;
      let newStamps = client.loyaltyStamps + 1;
      let newLevel = client.membershipLevel;

      if (newStamps >= 10) newStamps = 0;
      if (newCutsCount >= 15) newLevel = 'VIP';
      else if (newCutsCount >= 8) newLevel = 'Gold';
      else if (newCutsCount >= 3) newLevel = 'Silver';

      const updatedClients = this.clients().map((c) =>
        c.id === client.id
          ? {
              ...c,
              cutsCount: newCutsCount,
              loyaltyStamps: newStamps,
              membershipLevel: newLevel,
              lastVisitDate: new Date().toISOString().slice(0, 10),
            }
          : c
      );
      this.clients.set(updatedClients);
      this.saveToStorage(STORAGE_KEYS.CLIENTS, updatedClients);
    }

    // Persistir atómicamente en Supabase si está activo
    if (this.supabaseService.isConfigured()) {
      try {
        const { error } = await this.supabaseService.supabase.from('sales_history').insert({
          customer_id: params.clientId.startsWith('cli-') ? null : params.clientId,
          barber_id: params.barberId.startsWith('barber-') ? null : params.barberId,
          service_id: params.serviceId.startsWith('srv-') ? null : params.serviceId,
          final_price: finalPrice,
          payment_method: params.paymentMethod,
        });

        if (error) {
          this.logger.error('BarberService', 'Error al insertar venta en Supabase', error);
        } else {
          this.logger.info('BarberService', 'Venta persistida en Supabase con Trigger de fidelidad');
        }
      } catch (e) {
        this.logger.error('BarberService', 'Excepción de red en registerCut', e);
      }
    }

    return newCut;
  }

  /**
   * Crear nuevo cliente
   */
  async createClient(name: string, phone: string, email?: string, notes?: string): Promise<Client> {
    const newClient: Client = {
      id: 'cli-' + Date.now(),
      name,
      phone,
      email,
      cutsCount: 0,
      loyaltyStamps: 0,
      membershipLevel: 'Bronze',
      lastVisitDate: new Date().toISOString().slice(0, 10),
      notes,
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
            full_name: name,
            phone,
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
        }
      } catch (e) {
        this.logger.error('BarberService', 'Excepción al crear cliente en Supabase', e);
      }
    }

    return newClient;
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
      return data ? JSON.parse(data) : fallback;
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
