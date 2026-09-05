-- ==============================================================================
-- BARBERTRACK - SCRIPT SQL DE OPTIMIZACIÓN Y ATOMICIDAD PARA SUPABASE
-- Ejecutar este script en el "SQL Editor" de tu Dashboard de Supabase
-- ==============================================================================

-- 1. TRIGGER ATÓMICO: ACTUALIZACIÓN AUTOMÁTICA DE FIDELIDAD Y MEMBRESÍA
-- Cada vez que se registra una venta en sales_history, este trigger actualiza
-- de forma 100% atómica loyalty_progress y membership_tier en PostgreSQL.
-- ¡Evita condiciones de carrera y previene la pérdida de sellos en la PWA!

CREATE OR REPLACE FUNCTION public.fn_on_sale_loyalty_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_stamps integer;
  v_new_rewards integer;
  v_total_cuts integer;
  v_new_tier text;
BEGIN
  -- Solo procesar si la venta está asociada a un cliente (customer_id no es nulo)
  IF NEW.customer_id IS NOT NULL THEN
    
    -- Insertar o actualizar atómicamente el registro en loyalty_progress
    INSERT INTO public.loyalty_progress (
      customer_id,
      current_stamps,
      total_historical_cuts,
      rewards_claimed,
      updated_at
    )
    VALUES (
      NEW.customer_id,
      1,
      1,
      0,
      now()
    )
    ON CONFLICT (customer_id) DO UPDATE SET
      total_historical_cuts = loyalty_progress.total_historical_cuts + 1,
      current_stamps = CASE 
        WHEN loyalty_progress.current_stamps >= 9 THEN 0 
        ELSE loyalty_progress.current_stamps + 1 
      END,
      rewards_claimed = CASE 
        WHEN loyalty_progress.current_stamps >= 9 THEN loyalty_progress.rewards_claimed + 1 
        ELSE loyalty_progress.rewards_claimed 
      END,
      updated_at = now()
    RETURNING total_historical_cuts INTO v_total_cuts;

    -- Determinar el nivel de membresía basado en el historial consolidado
    IF v_total_cuts >= 15 THEN
      v_new_tier := 'VIP';
    ELSIF v_total_cuts >= 8 THEN
      v_new_tier := 'Gold';
    ELSIF v_total_cuts >= 3 THEN
      v_new_tier := 'Silver';
    ELSE
      v_new_tier := 'Bronze';
    END IF;

    -- Actualizar el tier en profiles
    UPDATE public.profiles
    SET membership_tier = v_new_tier
    WHERE id = NEW.customer_id;

  END IF;

  RETURN NEW;
END;
$$;

-- Crear el Trigger en sales_history
DROP TRIGGER IF EXISTS trg_sale_loyalty_update ON public.sales_history;
CREATE TRIGGER trg_sale_loyalty_update
AFTER INSERT ON public.sales_history
FOR EACH ROW
EXECUTE FUNCTION public.fn_on_sale_loyalty_update();


-- ==============================================================================
-- 2. RPC AGREGADA: CÁLCULO DE KPIS CON CERO DATA EGRESS
-- En lugar de descargar miles de filas a Angular para hacer .reduce(),
-- esta función calcula los KPIs en el motor de base de datos y retorna un JSON <200B.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_barber_dashboard_kpis(p_barber_id uuid DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'cuts_today', count(*) FILTER (WHERE created_at >= CURRENT_DATE),
    'cuts_this_month', count(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)),
    'revenue_today', COALESCE(sum(final_price) FILTER (WHERE created_at >= CURRENT_DATE), 0)::numeric(10,2),
    'revenue_this_week', COALESCE(sum(final_price) FILTER (WHERE created_at >= (CURRENT_DATE - interval '7 days')), 0)::numeric(10,2),
    'revenue_this_month', COALESCE(sum(final_price) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)), 0)::numeric(10,2),
    'total_revenue', COALESCE(sum(final_price), 0)::numeric(10,2),
    'total_cuts', count(*),
    'active_clients', (
      SELECT count(*) FROM public.profiles 
      WHERE role = 'customer' AND is_active = true
    ),
    'average_rating', COALESCE(
      (SELECT round(avg(rating)::numeric, 1) FROM public.reviews), 
      5.0
    )
  )
  INTO v_result
  FROM public.sales_history
  WHERE (p_barber_id IS NULL OR barber_id = p_barber_id);

  RETURN v_result;
END;
$$;


-- ==============================================================================
-- 3. ÍNDICES DE ALTO RENDIMIENTO PARA CONSULTAS MÓVILES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_status 
ON public.appointments (scheduled_at, status);

CREATE INDEX IF NOT EXISTS idx_sales_created_barber 
ON public.sales_history (created_at DESC, barber_id);

CREATE INDEX IF NOT EXISTS idx_sales_customer 
ON public.sales_history (customer_id);

CREATE INDEX IF NOT EXISTS idx_loyalty_customer 
ON public.loyalty_progress (customer_id);
