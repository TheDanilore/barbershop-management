-- ==============================================================================
-- MIGRACIÓN: CREACIÓN DE TABLA DINÁMICA DE MEMBRESÍAS Y BENEFICIOS
-- Tabla: public.membership_tiers
-- Actualización de Triggers: fn_on_order_loyalty_update y fn_on_order_deleted
-- ==============================================================================

-- 1. CREACIÓN DE LA TABLA membership_tiers
CREATE TABLE IF NOT EXISTS public.membership_tiers (
    id text PRIMARY KEY,
    name text NOT NULL,
    min_cuts_required integer NOT NULL DEFAULT 0,
    discount_percentage numeric(5,2) NOT NULL DEFAULT 0.00,
    badge_label text NOT NULL DEFAULT '',
    color_class text NOT NULL DEFAULT 'bronze',
    tagline text NOT NULL DEFAULT '',
    perks text[] NOT NULL DEFAULT '{}'::text[],
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT membership_tiers_min_cuts_check CHECK (min_cuts_required >= 0),
    CONSTRAINT membership_tiers_discount_check CHECK (discount_percentage >= 0 AND discount_percentage <= 100)
);

ALTER TABLE public.membership_tiers OWNER TO postgres;

-- 2. SEED DE LOS 4 NIVELES ESTÁNDAR
-- Bronce: Nivel inicial base sin descuentos ni cortesías adicionales.
-- Plata: 5 cortes, cortesía de café.
-- Oro: 20 cortes, toalla caliente y bebida premium.
-- VIP: 50 cortes, 15% de descuento en productos de cuidado personal y reservas prioritarias.
INSERT INTO public.membership_tiers (
    id, name, min_cuts_required, discount_percentage, badge_label, color_class, tagline, perks, is_active, sort_order
)
VALUES
(
    'Bronze',
    'Bronze Member',
    0,
    0.00,
    'Nivel Inicial',
    'bronze',
    'Tu entrada al club para acumular sellos de fidelidad.',
    ARRAY[
        'Acumulación de sellos en tu tarjeta digital con cada visita o servicio',
        'Canje de servicio 100% gratis al llegar a tus sellos meta',
        'Gestión y agendamiento de turnos online 24/7',
        'Recordatorios de citas en web y WhatsApp'
    ],
    true,
    1
),
(
    'Silver',
    'Silver Member',
    5,
    0.00,
    'Socio Frecuente',
    'silver',
    'Desbloquea atenciones de cortesía en cada atención.',
    ARRAY[
        'Café espresso artesanal o agua purificada de cortesía',
        'Acumulación continua de sellos hacia servicios gratis',
        'Notificaciones de ofertas especiales anticipadas',
        'Atención prioritaria en recepción'
    ],
    true,
    2
),
(
    'Gold',
    'Gold Member',
    20,
    0.00,
    'Socio Distinguido',
    'gold',
    'Experiencia premium y tratamientos relajantes.',
    ARRAY[
        'Bebida Premium de cortesía (café especialidad o infusión fría)',
        'Tratamiento de toalla caliente aromatizada en servicio de barba',
        'Prioridad en lista de espera ante citas liberadas',
        'Acumulación de sellos para canjes sin límite'
    ],
    true,
    3
),
(
    'VIP',
    'VIP Élite Member',
    50,
    15.00,
    'Máximo Prestigio',
    'vip',
    'El círculo más exclusivo con descuentos y atención total.',
    ARRAY[
        '15% de Descuento en todas las ceras, pomadas y aceites de barba',
        'Reserva prioritaria garantizada en fines de semana y festivos',
        'Bebidas premium ilimitadas durante toda tu visita',
        'Preferencia absoluta de horario con Master Barber',
        'Detalle y atención personalizada en tu cumpleaños'
    ],
    true,
    4
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    min_cuts_required = EXCLUDED.min_cuts_required,
    discount_percentage = EXCLUDED.discount_percentage,
    badge_label = EXCLUDED.badge_label,
    color_class = EXCLUDED.color_class,
    tagline = EXCLUDED.tagline,
    perks = EXCLUDED.perks,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

-- 3. FUNCIÓN PARA RECALCULAR MASIVAMENTE LOS NIVELES DE CLIENTES
CREATE OR REPLACE FUNCTION public.recalculate_all_membership_tiers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated_count integer := 0;
BEGIN
    UPDATE public.profiles p
    SET membership_tier = COALESCE(
        (
            SELECT mt.id
            FROM public.membership_tiers mt
            WHERE mt.is_active = true 
              AND mt.min_cuts_required <= COALESCE(lp.total_historical_cuts, 0)
            ORDER BY mt.min_cuts_required DESC
            LIMIT 1
        ),
        'Bronze'
    )
    FROM public.loyalty_progress lp
    WHERE p.id = lp.customer_id
      AND p.role = 'customer';

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    RETURN jsonb_build_object('success', true, 'updated_count', v_updated_count);
END;
$$;

ALTER FUNCTION public.recalculate_all_membership_tiers() OWNER TO postgres;

-- 4. ACTUALIZAR TRIGGER: fn_on_order_loyalty_update
-- Ahora consulta dinámicamente public.membership_tiers en lugar de hardcodear 50/20/5
CREATE OR REPLACE FUNCTION public.fn_on_order_loyalty_update() 
RETURNS trigger
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
    v_total_cuts     integer;
    v_new_stamps     integer;
    v_new_tier       text;
    v_reward         RECORD;
    v_loyalty_mode   text;
    v_stamps_to_add  integer := 1;
BEGIN
    -- Solo procesar si la orden está completada, tiene un cliente asociado,
    -- y NO es una venta al crédito/fiada sin pagar (payment_method != 'credit').
    IF NEW.customer_id IS NOT NULL 
       AND NEW.status = 'completed' 
       AND (NEW.payment_method IS DISTINCT FROM 'credit')
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN

        -- 1. Consultar el modo de fidelización activo configurado por el Administrador
        SELECT COALESCE(loyalty_mode, 'per_service') 
        INTO v_loyalty_mode 
        FROM public.business_settings 
        LIMIT 1;

        -- Modo 'per_service': contar items de servicio en la orden
        IF v_loyalty_mode = 'per_service' THEN
            SELECT COALESCE(SUM(quantity), 1)
            INTO v_stamps_to_add
            FROM public.order_items
            WHERE order_id = NEW.id AND (item_type = 'service' OR item_type IS NULL);

            IF v_stamps_to_add IS NULL OR v_stamps_to_add < 1 THEN
                v_stamps_to_add := 1;
            END IF;
        ELSE
            -- Modo 'per_visit': cada orden completada suma 1 sello
            v_stamps_to_add := 1;
        END IF;

        -- 2. Upsert de progreso en loyalty_progress
        INSERT INTO public.loyalty_progress (
            customer_id, current_stamps, total_historical_cuts, rewards_claimed, updated_at
        )
        VALUES (NEW.customer_id, v_stamps_to_add, v_stamps_to_add, 0, now())
        ON CONFLICT (customer_id) DO UPDATE SET
            current_stamps        = public.loyalty_progress.current_stamps + v_stamps_to_add,
            total_historical_cuts = public.loyalty_progress.total_historical_cuts + v_stamps_to_add,
            updated_at            = now()
        RETURNING current_stamps, total_historical_cuts
        INTO v_new_stamps, v_total_cuts;

        -- 3. Detección de premios alcanzados
        FOR v_reward IN
            SELECT id, stamps_required, name
            FROM public.loyalty_rewards
            WHERE is_active = true AND stamps_required <= v_new_stamps
              AND id NOT IN (
                  SELECT reward_id 
                  FROM public.loyalty_reward_claims 
                  WHERE customer_id = NEW.customer_id AND redeemed_at IS NULL
              )
        LOOP
            INSERT INTO public.loyalty_reward_claims
                (customer_id, reward_id, sale_id, order_id, stamps_at_claim)
            VALUES
                (NEW.customer_id, v_reward.id, NEW.id, NEW.id, v_new_stamps);
        END LOOP;

        -- 4. Sincronizar nivel de membresía DINÁMICAMENTE desde public.membership_tiers
        SELECT id INTO v_new_tier
        FROM public.membership_tiers
        WHERE is_active = true AND min_cuts_required <= v_total_cuts
        ORDER BY min_cuts_required DESC
        LIMIT 1;

        IF v_new_tier IS NULL THEN
            v_new_tier := 'Bronze';
        END IF;

        UPDATE public.profiles
        SET membership_tier = v_new_tier
        WHERE id = NEW.customer_id;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.fn_on_order_loyalty_update() OWNER TO postgres;

-- 5. ACTUALIZAR TRIGGER: fn_on_order_deleted
-- Recalcula el nivel dinámicamente desde public.membership_tiers al anular una venta
CREATE OR REPLACE FUNCTION public.fn_on_order_deleted() 
RETURNS trigger
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
    v_real_cuts integer := 0;
    v_new_tier  text;
    v_loyalty_mode text;
BEGIN
    IF OLD.customer_id IS NOT NULL THEN
        -- 1. Consultar el modo de fidelización activo
        SELECT COALESCE(loyalty_mode, 'per_service') 
        INTO v_loyalty_mode 
        FROM public.business_settings 
        LIMIT 1;

        -- 2. Calcular cortes/servicios reales vigentes según la regla dinámica
        IF v_loyalty_mode = 'per_service' THEN
            SELECT COALESCE(SUM(oi.quantity), 0) INTO v_real_cuts
            FROM public.orders o
            JOIN public.order_items oi ON oi.order_id = o.id
            WHERE o.customer_id = OLD.customer_id 
              AND o.status = 'completed'
              AND o.id != OLD.id
              AND (oi.item_type = 'service' OR oi.item_type IS NULL);
        ELSE
            SELECT COUNT(*) INTO v_real_cuts
            FROM public.orders
            WHERE customer_id = OLD.customer_id 
              AND status = 'completed'
              AND id != OLD.id;
        END IF;

        -- 3. Actualizar progreso en loyalty_progress
        INSERT INTO public.loyalty_progress (
            customer_id, current_stamps, total_historical_cuts, rewards_claimed, updated_at
        )
        VALUES (OLD.customer_id, v_real_cuts, v_real_cuts, 0, now())
        ON CONFLICT (customer_id) DO UPDATE SET
            current_stamps        = EXCLUDED.current_stamps,
            total_historical_cuts = EXCLUDED.total_historical_cuts,
            updated_at            = now();

        -- 4. Recalcular nivel de membresía DINÁMICAMENTE desde public.membership_tiers
        SELECT id INTO v_new_tier
        FROM public.membership_tiers
        WHERE is_active = true AND min_cuts_required <= v_real_cuts
        ORDER BY min_cuts_required DESC
        LIMIT 1;

        IF v_new_tier IS NULL THEN
            v_new_tier := 'Bronze';
        END IF;

        UPDATE public.profiles
        SET membership_tier = v_new_tier
        WHERE id = OLD.customer_id;
    END IF;

    RETURN OLD;
END;
$$;

ALTER FUNCTION public.fn_on_order_deleted() OWNER TO postgres;

-- 6. POLÍTICAS RLS (Row Level Security)
ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "membership_tiers_select" ON public.membership_tiers;
CREATE POLICY "membership_tiers_select" ON public.membership_tiers
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "membership_tiers_staff_manage" ON public.membership_tiers;
CREATE POLICY "membership_tiers_staff_manage" ON public.membership_tiers
    TO authenticated
    USING (public.is_staff() = true)
    WITH CHECK (public.is_staff() = true);

-- 7. HABILITAR SUPABASE REALTIME
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'membership_tiers'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.membership_tiers;
    END IF;
END;
$$;

-- 8. PERMISOS
GRANT ALL ON TABLE public.membership_tiers TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.recalculate_all_membership_tiers() TO anon, authenticated, service_role;
