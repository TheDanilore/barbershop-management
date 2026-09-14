# BarberTrack PRO 💈✨
### Sistema de Gestión Integral ERP, CRM & Portal de Clientes VIP para Barberías Modernas

![Angular](https://img.shields.io/badge/Angular-22%2B-DD0031?style=for-the-badge&logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)
![WCAG](https://img.shields.io/badge/WCAG-AAA%20Contrast-gold?style=for-the-badge)

**BarberTrack PRO** es una solución web empresarial y PWA (Progressive Web App) diseñada para transformar la operativa diaria de barberías y salones masculinos de alta gama. Combina un potente **ERP / CRM administrativo para barberos y administradores** con un **Portal VIP de autoservicio para clientes**, respaldado por una arquitectura de datos en tiempo real sobre **Supabase (PostgreSQL)** y un sistema de diseño de lujo (*Gold & Obsidian Luxury Theme*).

---

## 🌟 Características Principales

### 1. 🛡️ Módulo Administrativo & Barbero (`/barber/*`)
Diseñado con filosofía **Power User / ERP Pro Tool** para alta densidad de información, navegación por atajos de teclado y rapidez operativa:

- **Panel General (`/barber/overview`)**: Métricas operativas del día, turnos en curso, ingresos acumulados y acceso directo a registro de corte.
- **Agenda & Turnos (`/barber/appointments`)**: Calendario interactivo con vista diaria y semanal, asignación de barberos y estados en vivo (*pendiente*, *confirmada*, *en atención*, *completada*, *cancelada*).
- **Directorio de Clientes (`/barber/clients`)**: Expediente individual con historial de visitas, notas técnicas de estilo, línea de crédito, deuda actual y nivel de membresía.
- **Catálogo de Servicios (`/barber/services`)**: Mantenimiento de precios, duraciones en minutos y servicios destacados.
- **Fidelización & Sellos (`/barber/loyalty`)**: Configuración del club de puntos, catálogo de recompensas (*corte gratis*, *descuentos*, *productos*) y validación de cupones ganados en sillón.
- **Caja & Cuentas Financieras (`/barber/cash`)**: Apertura y cierre de turnos con arqueo de caja atómico en PostgreSQL, registro de gastos, ingresos y movimientos entre cuentas.
- **Finanzas & Analítica (`/barber/stats`)**: Reportes de producción por barbero, ticket promedio, ventas al crédito y métodos de pago.
- **Gestión de Personal (`/barber/users`)**: Administración de roles de acceso (*admin*, *barber*, *customer*).
- **Perfil del Barbero (`/barber/profile`)**: Ajustes de cuenta y preferencias operativas.

---

### 2. 👤 Portal VIP de Clientes (`/customer/*`)
Experiencia de usuario de nivel internacional con **adaptabilidad camaleónica** (Mobile-First Apple HIG en smartphones que muta a un Command Center multi-columna en computadoras de escritorio):

- **Mi Portal (`/customer/home`)**:
  - Saludo personalizado en tiempo real.
  - 4 Widgets KPI del cliente (*Tarjeta de Fidelidad*, *Servicios Realizados*, *Nivel de Membresía*, *Estado de Cuenta*).
  - Tarjeta interactiva de **Próximo Turno** con cuenta regresiva, barbero asignado y acciones rápidas.
  - Catálogo de servicios populares y resumen de beneficios exclusivos (*bebida de cortesía*, *descuentos en ceras*, *reserva prioritaria*).
- **Mis Citas (`/customer/appointments`)**:
  - Pestañas segmentadas: *Próximas & Activas* vs *Historial / Pasadas*.
  - Reprogramación y cancelación en 1 clic con confirmación visual.
  - Botón directo para sincronizar la cita con **Google Calendar**.
- **Tarjeta & Sellos VIP (`/customer/loyalty`)**:
  - **Tarjeta Virtual de Lujo "Black Card"**: Diseño con proporciones áureas de tarjeta física (85.6mm x 53.98mm ratio), acabado metálico con brillo foil y sellos compactos interactivos.
  - **Premios Listos para Canjear**: Visualización de cupones y vouchers ganados con código de validación para presentar al barbero en el salón.
  - **Catálogo de Hitos**: Barra de progreso y listado de hitos desbloqueables según visitas acumuladas.
- **Historial de Cortes (`/customer/history`)**:
  - Listado de servicios completados con fecha, barbero atendido, método de pago y monto.
  - **Boleta Digital Interactiva**: Modal de comprobante con desglose de ítems, listo para imprimir o guardar como PDF.
  - **Calificación In-Situ**: Selector de estrellas (1 a 5) y comentarios guardados directamente en la base de datos vinculados al servicio completado.
- **Mi Perfil (`/customer/profile`)**:
  - Edición de nombre y teléfono de contacto con sincronización inmediata a Supabase.
  - Registro de notas de estilo preferido (ej. *Degradado medio, navaja al ras, tijera superior*) visibles por el barbero antes de cada corte.
  - Consulta de línea de crédito y saldo pendiente.
- **Modales Adaptativos (Sheet-to-Dialog)**:
  - En móviles emergen como **iOS Bottom Sheets** con tirador de arrastre (drag handle) optimizados para el pulgar.
  - En pantallas medianas y grandes mutan a **diálogos centrados flotantes** con efecto *Glassmorphism*, fondo oscurecido y atajos de teclado (`Esc`, `Alt+B`).

---

## 🏛️ Arquitectura del Proyecto

El código está estructurado siguiendo los principios de **Clean Architecture** y modularidad de componentes independientes:

```
src/app/
├── core/                               # Núcleo singleton del sistema
│   ├── guards/                         # Guardias de autenticación y roles (auth.guard.ts)
│   ├── models/                         # Interfaces de dominio y tipos de PostgreSQL (barber.models.ts)
│   ├── services/                       # Servicios reactivos (barber.service.ts, supabase.service.ts, haptics.service.ts)
│   └── utils/                          # Utilidades de fechas, moneda y formato
├── features/                           # Módulos funcionales desacoplados
│   ├── auth/                           # Pantalla de Login, registro y recuperación
│   ├── barber/                         # Portal de Administración y Barbero
│   │   ├── barber-layout/              # Shell maestro con Sidebar y Header Desktop
│   │   ├── components/                 # Modales de caja, cortes, clientes, command palette
│   │   └── pages/                      # Páginas independientes (/overview, /appointments, /cash, etc.)
│   └── customer/                       # Portal VIP del Cliente
│       ├── customer-layout/            # Shell maestro con Topbar Desktop, Topbar Móvil y Bottom Nav
│       ├── components/                 # Subcomponentes (booking-modal, review-modal, ticket-modal, loyalty-card)
│       └── pages/                      # Páginas independientes
│           ├── customer-home/          # Dashboard principal (/customer/home)
│           ├── customer-appointments/  # Agenda y citas (/customer/appointments)
│           ├── customer-loyalty/       # Tarjeta de sellos y cupones (/customer/loyalty)
│           ├── customer-history/       # Historial y boletas (/customer/history)
│           └── customer-profile/       # Perfil y estado de cuenta (/customer/profile)
├── shared/                             # Directivas, pipes y utilidades compartidas
├── app.routes.ts                       # Enrutador principal con lazy-loading y rutas hijas
└── styles.css                          # Sistema de diseño global (Tokens, Dark Theme, Luxury Gold Palette)
```

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología | Descripción |
| :--- | :--- | :--- |
| **Framework** | Angular 19+ / 22+ | Standalone Components, Signals Reactivos, ChangeDetectionStrategy.OnPush |
| **Lenguaje** | TypeScript 5.x | Tipado estricto sin `any` para modelos y APIs |
| **Estilos** | Vanilla CSS & Design Tokens | Variables CSS, Glassmorphism, Micro-animaciones aceleradas por GPU, Soporte PWA Safe-Areas |
| **Backend & BD** | Supabase (PostgreSQL 15+) | Autenticación, Row Level Security (RLS), Triggers atómicos, Realtime |
| **Pruebas** | Vitest | Suite de pruebas unitarias ultrarrápida |
| **Móvil / PWA** | Web APIs & Haptics | Vibración háptica nativa, Service Workers y capacidades PWA |

---

## 🚀 Instalación y Puesta en Marcha

### Prerrequisitos
- **Node.js**: v18.0.0 o superior (recomendado v20+)
- **Gestor de paquetes**: `npm` o `pnpm`

### 1. Clonar el repositorio e instalar dependencias
```bash
git clone https://github.com/TheDanilore/barbershop-management
cd barbershop-management
npm install
```

### 2. Configurar Variables de Entorno (Supabase)
Crea un archivo `.env` en la raíz del proyecto basándote en tus credenciales de Supabase:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu-anon-publishable-key-aqui
```

Luego ejecuta el script de inyección segura:
```bash
npm run config:env
```
> Esto generará automáticamente `src/environments/environment.ts` y `environment.prod.ts` sin exponer tus credenciales en el repositorio Git.

### 3. Base de Datos (PostgreSQL en Supabase)
El proyecto cuenta con el script SQL completo de la estructura en la raíz:
- [`respaldo_completo.sql`](respaldo_completo.sql)

Este script contiene:
- Tablas: `profiles`, `services`, `appointments`, `orders`, `order_items`, `loyalty_rewards`, `loyalty_reward_claims`, `loyalty_progress`, `reviews`, `cash_shifts`, `financial_accounts`, `customer_credits`, `customer_credit_movements`.
- Funciones atómicas de arqueo de caja (`close_cash_shift_atomic`).
- Triggers para acumulación automática de sellos de fidelización y recálculo de nivel de membresía (*Bronze*, *Silver*, *Gold*, *VIP*).
- Políticas de seguridad por fila (**Row Level Security - RLS**) para aislar la información de cada cliente.

### 4. Iniciar el Servidor de Desarrollo
```bash
npm start
# O alternativamente:
ng serve -o
```
Abre tu navegador en `http://localhost:4200/`.

---

## 🧪 Comandos Útiles

```bash
# Ejecutar pruebas unitarias con Vitest
npm test

# Compilar para producción (optimizado en dist/)
npm run build

# Compilar en modo vigilancia continua
npm run watch
```

---

## 🎨 Principios de Diseño & Accesibilidad

- **Contraste WCAG AAA**: Texto claro sobre superficies carbón con ratio superior a 14:1.
- **Ergonomía Táctil**: Todos los botones y selectores en dispositivos móviles cumplen con el estándar de área de toque mínima de **48px x 48px**.
- **Consistencia de Tokens**: Cero valores hexadecimales fijos en componentes; uso riguroso de `var(--gold-primary)`, `var(--bg-card)`, `var(--border-subtle)`.
- **Estados de Interfaz**: Manejo explícito de estados de carga con *Skeletons Shimmer*, estados vacíos contextuales con llamados a la acción claros y alertas de error no bloqueantes.

---

## 📄 Licencia

Este proyecto es privado y de uso exclusivo para BarberTrack. Todos los derechos reservados.
