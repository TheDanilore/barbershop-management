


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."appointment_status" AS ENUM (
    'confirmed',
    'in_progress',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."appointment_status" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'admin',
    'barber',
    'customer'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_on_account_movement"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF NEW.movement_type IN ('income', 'transfer_in') THEN
        UPDATE public.financial_accounts
        SET current_balance = current_balance + NEW.amount
        WHERE id = NEW.account_id;
    ELSIF NEW.movement_type IN ('expense', 'transfer_out') THEN
        UPDATE public.financial_accounts
        SET current_balance = current_balance - NEW.amount
        WHERE id = NEW.account_id;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_on_account_movement"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_on_credit_movement"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    IF NEW.movement_type = 'CHARGE' THEN
        UPDATE public.customer_credits
        SET current_debt = current_debt + NEW.amount,
            updated_at = now()
        WHERE id = NEW.customer_credit_id;
    ELSIF NEW.movement_type = 'PAYMENT' THEN
        UPDATE public.customer_credits
        SET current_debt = GREATEST(0, current_debt - NEW.amount),
            updated_at = now()
        WHERE id = NEW.customer_credit_id;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_on_credit_movement"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_on_sale_deleted"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_stamps_threshold integer := 10;
    v_real_cuts        integer := 0;
    v_new_tier         text;
BEGIN
    IF OLD.customer_id IS NOT NULL THEN
        -- Contar las ventas reales que quedan en sales_history para este cliente
        SELECT COUNT(*) INTO v_real_cuts
        FROM public.sales_history
        WHERE customer_id = OLD.customer_id;

        -- Leer el threshold de sellos dinámico desde app_settings
        SELECT COALESCE(value::integer, 10) INTO v_stamps_threshold
        FROM public.app_settings
        WHERE key = 'stamps_required'
        LIMIT 1;

        IF v_stamps_threshold IS NULL OR v_stamps_threshold < 2 THEN
            v_stamps_threshold := 10;
        END IF;

        -- Recalcular loyalty_progress basado en el conteo real de ventas
        INSERT INTO public.loyalty_progress (
            customer_id,
            current_stamps,
            total_historical_cuts,
            rewards_claimed,
            updated_at
        )
        VALUES (
            OLD.customer_id,
            (v_real_cuts % v_stamps_threshold),
            v_real_cuts,
            (v_real_cuts / v_stamps_threshold),
            now()
        )
        ON CONFLICT (customer_id) DO UPDATE SET
            current_stamps       = EXCLUDED.current_stamps,
            total_historical_cuts = EXCLUDED.total_historical_cuts,
            rewards_claimed      = EXCLUDED.rewards_claimed,
            updated_at           = now();

        -- Recalcular membership tier del perfil
        v_new_tier := CASE
            WHEN v_real_cuts >= 50 THEN 'Diamond'
            WHEN v_real_cuts >= 20 THEN 'Gold'
            WHEN v_real_cuts >= 5  THEN 'Silver'
            ELSE 'Bronze'
        END;

        UPDATE public.profiles
        SET membership_tier = v_new_tier
        WHERE id = OLD.customer_id;
    END IF;

    RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."fn_on_sale_deleted"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_on_sale_loyalty_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_total_cuts    integer;
    v_new_stamps    integer;
    v_new_tier      text;
    v_reward        RECORD;
BEGIN
    IF NEW.customer_id IS NOT NULL THEN
        -- Upsert de progreso: incrementar sellos y cortes acumulados
        INSERT INTO public.loyalty_progress (
            customer_id,
            current_stamps,
            total_historical_cuts,
            rewards_claimed,
            updated_at
        )
        VALUES (NEW.customer_id, 1, 1, 0, now())
        ON CONFLICT (customer_id) DO UPDATE SET
            current_stamps        = public.loyalty_progress.current_stamps + 1,
            total_historical_cuts = public.loyalty_progress.total_historical_cuts + 1,
            updated_at            = now()
        RETURNING current_stamps, total_historical_cuts
        INTO v_new_stamps, v_total_cuts;

        -- Detectar si algún premio activo fue alcanzado en este sello exacto
        -- (Funciona con 0 premios configurados: el FOR simplemente no itera)
        FOR v_reward IN
            SELECT id, stamps_required, name
            FROM public.loyalty_rewards
            WHERE is_active = true
              AND stamps_required = v_new_stamps
        LOOP
            INSERT INTO public.loyalty_reward_claims
                (customer_id, reward_id, sale_id, stamps_at_claim)
            VALUES
                (NEW.customer_id, v_reward.id, NEW.id, v_new_stamps);
        END LOOP;

        -- Si el cliente completó el ciclo (llegó al máximo de sellos de cualquier premio),
        -- y no existe configuración de reset, mantener el sello acumulado.
        -- El reset ahora es manual o puede hacerse con el canje del premio (decidir en app).

        -- Recalcular membership tier
        v_new_tier := CASE
            WHEN v_total_cuts >= 50 THEN 'Diamond'
            WHEN v_total_cuts >= 20 THEN 'Gold'
            WHEN v_total_cuts >= 5  THEN 'Silver'
            ELSE 'Bronze'
        END;

        UPDATE public.profiles
        SET membership_tier = v_new_tier
        WHERE id = NEW.customer_id;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."fn_on_sale_loyalty_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_on_sales_truncated"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Cuando se trunca sales_history, resetear loyalty_progress y tiers a valores de inicio
    UPDATE public.loyalty_progress
    SET current_stamps        = 0,
        total_historical_cuts = 0,
        rewards_claimed       = 0,
        updated_at            = now();

    UPDATE public.profiles
    SET membership_tier = 'Bronze'
    WHERE role = 'customer';

    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."fn_on_sales_truncated"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_barber_dashboard_kpis"("p_barber_id" "uuid" DEFAULT NULL::"uuid") RETURNS json
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
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


ALTER FUNCTION "public"."get_barber_dashboard_kpis"("p_barber_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE (auth_user_id = auth.uid() OR id = auth.uid()) 
    AND role = 'admin'::public.user_role
    AND is_active = true
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_staff"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE (auth_user_id = auth.uid() OR id = auth.uid()) 
    AND role IN ('admin'::public.user_role, 'barber'::public.user_role)
    AND is_active = true
  );
$$;


ALTER FUNCTION "public"."is_staff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redeem_loyalty_claim"("p_claim_id" "uuid", "p_notes" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.loyalty_reward_claims
    SET redeemed_at = now(),
        redeemed_by = auth.uid(),
        notes       = COALESCE(p_notes, notes)
    WHERE id = p_claim_id
      AND redeemed_at IS NULL;  -- Idempotente: solo canjea si está pendiente

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Premio no encontrado o ya canjeado (id: %)', p_claim_id;
    END IF;
END;
$$;


ALTER FUNCTION "public"."redeem_loyalty_claim"("p_claim_id" "uuid", "p_notes" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."account_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "movement_type" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "description" "text" NOT NULL,
    "reference_type" "text",
    "reference_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "shift_id" "uuid",
    CONSTRAINT "account_movements_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "account_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['income'::"text", 'expense'::"text", 'transfer_in'::"text", 'transfer_out'::"text"]))),
    CONSTRAINT "account_movements_reference_type_check" CHECK (("reference_type" = ANY (ARRAY['sale'::"text", 'credit_payment'::"text", 'manual'::"text", 'expense'::"text", 'transfer'::"text", 'shift_adjustment'::"text"])))
);


ALTER TABLE "public"."account_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" numeric NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "barber_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "status" "public"."appointment_status" DEFAULT 'confirmed'::"public"."appointment_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "business_name" "text" DEFAULT 'BarberTrack PRO'::"text" NOT NULL,
    "currency_symbol" "text" DEFAULT '$'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."business_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_shifts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "account_id" "uuid" NOT NULL,
    "barber_id" "uuid" NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "initial_cash" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "cash_sales" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "cash_expenses" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "expected_cash" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "actual_cash" numeric(10,2),
    "difference" numeric(10,2),
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "cash_shifts_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."cash_shifts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_credit_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_credit_id" "uuid" NOT NULL,
    "sale_id" "uuid",
    "movement_type" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "payment_method" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "shift_id" "uuid",
    CONSTRAINT "customer_credit_movements_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "customer_credit_movements_movement_type_check" CHECK (("movement_type" = ANY (ARRAY['CHARGE'::"text", 'PAYMENT'::"text"])))
);


ALTER TABLE "public"."customer_credit_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_credits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "credit_limit" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "current_debt" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    CONSTRAINT "customer_credits_current_debt_check" CHECK (("current_debt" >= (0)::numeric))
);


ALTER TABLE "public"."customer_credits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "current_balance" numeric(10,2) DEFAULT 0.00 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "financial_accounts_type_check" CHECK (("type" = ANY (ARRAY['cash'::"text", 'bank'::"text", 'digital_wallet'::"text"])))
);


ALTER TABLE "public"."financial_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "current_stamps" integer DEFAULT 0 NOT NULL,
    "total_historical_cuts" integer DEFAULT 0 NOT NULL,
    "rewards_claimed" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_reward_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "reward_id" "uuid" NOT NULL,
    "sale_id" "uuid",
    "claimed_at" timestamp with time zone DEFAULT "now"(),
    "redeemed_at" timestamp with time zone,
    "redeemed_by" "uuid",
    "notes" "text",
    "stamps_at_claim" integer NOT NULL
);


ALTER TABLE "public"."loyalty_reward_claims" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loyalty_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "reward_type" "text" NOT NULL,
    "stamps_required" integer NOT NULL,
    "reward_value" numeric(10,2),
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "loyalty_rewards_reward_type_check" CHECK (("reward_type" = ANY (ARRAY['free_cut'::"text", 'discount_pct'::"text", 'discount_fixed'::"text", 'gift'::"text"]))),
    CONSTRAINT "loyalty_rewards_stamps_required_check" CHECK (("stamps_required" >= 1))
);


ALTER TABLE "public"."loyalty_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid",
    "full_name" "text" NOT NULL,
    "avatar_url" "text",
    "role" "public"."user_role" DEFAULT 'customer'::"public"."user_role" NOT NULL,
    "phone" "text",
    "membership_tier" "text" DEFAULT 'Bronze'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "rating" integer NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid",
    "barber_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "final_price" numeric(10,2) NOT NULL,
    "payment_method" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "amount_paid" numeric(10,2) DEFAULT NULL::numeric,
    "amount_debt" numeric(10,2) DEFAULT 0.00,
    "shift_id" "uuid"
);


ALTER TABLE "public"."sales_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "base_price" numeric(10,2) NOT NULL,
    "duration_minutes" integer DEFAULT 30 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "popular" boolean DEFAULT false
);


ALTER TABLE "public"."services" OWNER TO "postgres";


ALTER TABLE ONLY "public"."account_movements"
    ADD CONSTRAINT "account_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_settings"
    ADD CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_shifts"
    ADD CONSTRAINT "cash_shifts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_credit_movements"
    ADD CONSTRAINT "credit_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_credits"
    ADD CONSTRAINT "customer_credits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_credits"
    ADD CONSTRAINT "customer_credits_profile_id_key" UNIQUE ("profile_id");



ALTER TABLE ONLY "public"."financial_accounts"
    ADD CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_progress"
    ADD CONSTRAINT "loyalty_progress_customer_id_key" UNIQUE ("customer_id");



ALTER TABLE ONLY "public"."loyalty_progress"
    ADD CONSTRAINT "loyalty_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_reward_claims"
    ADD CONSTRAINT "loyalty_reward_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_rewards"
    ADD CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_sale_id_key" UNIQUE ("sale_id");



ALTER TABLE ONLY "public"."sales_history"
    ADD CONSTRAINT "sales_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



CREATE INDEX "account_movements_account_id_idx" ON "public"."account_movements" USING "btree" ("account_id");



CREATE INDEX "account_movements_created_by_idx" ON "public"."account_movements" USING "btree" ("created_by");



CREATE INDEX "account_movements_shift_id_idx" ON "public"."account_movements" USING "btree" ("shift_id");



CREATE INDEX "customer_credits_created_by_idx" ON "public"."customer_credits" USING "btree" ("created_by");



CREATE INDEX "customer_credits_profile_id_idx" ON "public"."customer_credits" USING "btree" ("profile_id");



CREATE INDEX "idx_appointments_scheduled_status" ON "public"."appointments" USING "btree" ("scheduled_at", "status");



CREATE INDEX "idx_cash_shifts_barber" ON "public"."cash_shifts" USING "btree" ("barber_id", "status");



CREATE INDEX "idx_customer_credit_movements_created_by" ON "public"."customer_credit_movements" USING "btree" ("created_by");



CREATE INDEX "idx_customer_credit_movements_customer_credit_id" ON "public"."customer_credit_movements" USING "btree" ("customer_credit_id");



CREATE INDEX "idx_customer_credit_movements_sale_id" ON "public"."customer_credit_movements" USING "btree" ("sale_id");



CREATE INDEX "idx_loyalty_claims_customer" ON "public"."loyalty_reward_claims" USING "btree" ("customer_id");



CREATE INDEX "idx_loyalty_claims_pending" ON "public"."loyalty_reward_claims" USING "btree" ("customer_id", "redeemed_at") WHERE ("redeemed_at" IS NULL);



CREATE INDEX "idx_loyalty_claims_reward" ON "public"."loyalty_reward_claims" USING "btree" ("reward_id");



CREATE INDEX "idx_loyalty_customer" ON "public"."loyalty_progress" USING "btree" ("customer_id");



CREATE INDEX "idx_loyalty_rewards_sort" ON "public"."loyalty_rewards" USING "btree" ("sort_order", "stamps_required");



CREATE INDEX "idx_sales_created_barber" ON "public"."sales_history" USING "btree" ("created_at" DESC, "barber_id");



CREATE INDEX "idx_sales_customer" ON "public"."sales_history" USING "btree" ("customer_id");



CREATE INDEX "idx_sales_history_barber_date" ON "public"."sales_history" USING "btree" ("barber_id", "created_at");



CREATE INDEX "idx_sales_history_customer" ON "public"."sales_history" USING "btree" ("customer_id");



CREATE OR REPLACE TRIGGER "trg_account_movement_balance" AFTER INSERT ON "public"."account_movements" FOR EACH ROW EXECUTE FUNCTION "public"."fn_on_account_movement"();



CREATE OR REPLACE TRIGGER "trg_customer_credit_balance" AFTER INSERT ON "public"."customer_credit_movements" FOR EACH ROW EXECUTE FUNCTION "public"."fn_on_credit_movement"();



CREATE OR REPLACE TRIGGER "trg_sale_deleted" AFTER DELETE ON "public"."sales_history" FOR EACH ROW EXECUTE FUNCTION "public"."fn_on_sale_deleted"();



CREATE OR REPLACE TRIGGER "trg_sale_loyalty_update" AFTER INSERT ON "public"."sales_history" FOR EACH ROW EXECUTE FUNCTION "public"."fn_on_sale_loyalty_update"();



CREATE OR REPLACE TRIGGER "trg_sales_truncated" AFTER TRUNCATE ON "public"."sales_history" FOR EACH STATEMENT EXECUTE FUNCTION "public"."fn_on_sales_truncated"();



ALTER TABLE ONLY "public"."account_movements"
    ADD CONSTRAINT "account_movements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id");



ALTER TABLE ONLY "public"."account_movements"
    ADD CONSTRAINT "account_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."account_movements"
    ADD CONSTRAINT "account_movements_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."cash_shifts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."cash_shifts"
    ADD CONSTRAINT "cash_shifts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id");



ALTER TABLE ONLY "public"."cash_shifts"
    ADD CONSTRAINT "cash_shifts_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."customer_credit_movements"
    ADD CONSTRAINT "customer_credit_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_credit_movements"
    ADD CONSTRAINT "customer_credit_movements_customer_credit_id_fkey" FOREIGN KEY ("customer_credit_id") REFERENCES "public"."customer_credits"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_credit_movements"
    ADD CONSTRAINT "customer_credit_movements_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales_history"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_credit_movements"
    ADD CONSTRAINT "customer_credit_movements_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."cash_shifts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_credits"
    ADD CONSTRAINT "customer_credits_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customer_credits"
    ADD CONSTRAINT "customer_credits_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_progress"
    ADD CONSTRAINT "loyalty_progress_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_reward_claims"
    ADD CONSTRAINT "loyalty_reward_claims_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."loyalty_reward_claims"
    ADD CONSTRAINT "loyalty_reward_claims_redeemed_by_fkey" FOREIGN KEY ("redeemed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."loyalty_reward_claims"
    ADD CONSTRAINT "loyalty_reward_claims_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "public"."loyalty_rewards"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."loyalty_reward_claims"
    ADD CONSTRAINT "loyalty_reward_claims_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales_history"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales_history"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_history"
    ADD CONSTRAINT "sales_history_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id");



ALTER TABLE ONLY "public"."sales_history"
    ADD CONSTRAINT "sales_history_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales_history"
    ADD CONSTRAINT "sales_history_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_history"
    ADD CONSTRAINT "sales_history_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_history"
    ADD CONSTRAINT "sales_history_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."cash_shifts"("id") ON DELETE SET NULL;



CREATE POLICY "Acceso a citas" ON "public"."appointments" USING ((("customer_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE (("profiles"."auth_user_id" = "auth"."uid"()) OR ("profiles"."id" = "auth"."uid"())))) OR ("public"."is_staff"() = true)));



CREATE POLICY "Acceso a fidelidad" ON "public"."loyalty_progress" USING ((("customer_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE (("profiles"."auth_user_id" = "auth"."uid"()) OR ("profiles"."id" = "auth"."uid"())))) OR ("public"."is_staff"() = true)));



CREATE POLICY "Acceso a ventas" ON "public"."sales_history" USING ((("customer_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE (("profiles"."auth_user_id" = "auth"."uid"()) OR ("profiles"."id" = "auth"."uid"())))) OR ("public"."is_staff"() = true)));



CREATE POLICY "Clientes leen su propio credito" ON "public"."customer_credits" FOR SELECT TO "authenticated" USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "Gestión completa de ventas para personal" ON "public"."sales_history" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"public"."user_role", 'barber'::"public"."user_role"]))))));



CREATE POLICY "Lectura de perfiles autorizados" ON "public"."profiles" FOR SELECT USING ((("auth_user_id" = "auth"."uid"()) OR ("id" = "auth"."uid"()) OR ("public"."is_staff"() = true)));



CREATE POLICY "Lectura publica de configuracion" ON "public"."business_settings" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Lectura publica de servicios activos" ON "public"."services" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Permitir insercion inicial de perfiles" ON "public"."profiles" FOR INSERT WITH CHECK ((("auth_user_id" = "auth"."uid"()) OR ("auth"."uid"() IS NOT NULL)));



CREATE POLICY "Staff gestiona catalogo de servicios" ON "public"."services" TO "authenticated" USING (("public"."is_staff"() = true)) WITH CHECK (("public"."is_staff"() = true));



CREATE POLICY "Staff gestiona configuracion" ON "public"."business_settings" TO "authenticated" USING (("public"."is_staff"() = true)) WITH CHECK (("public"."is_staff"() = true));



CREATE POLICY "Staff gestiona creditos de clientes" ON "public"."customer_credits" TO "authenticated" USING (("public"."is_staff"() = true)) WITH CHECK (("public"."is_staff"() = true));



CREATE POLICY "Staff gestiona cuentas financieras" ON "public"."financial_accounts" TO "authenticated" USING (("public"."is_staff"() = true)) WITH CHECK (("public"."is_staff"() = true));



CREATE POLICY "Staff gestiona movimientos de credito" ON "public"."customer_credit_movements" TO "authenticated" USING (("public"."is_staff"() = true)) WITH CHECK (("public"."is_staff"() = true));



CREATE POLICY "Staff gestiona movimientos de cuenta" ON "public"."account_movements" TO "authenticated" USING (("public"."is_staff"() = true)) WITH CHECK (("public"."is_staff"() = true));



CREATE POLICY "Staff gestiona turnos de caja" ON "public"."cash_shifts" TO "authenticated" USING (("public"."is_staff"() = true)) WITH CHECK (("public"."is_staff"() = true));



CREATE POLICY "Usuarios actualizan su propio perfil" ON "public"."profiles" FOR UPDATE USING ((("auth_user_id" = "auth"."uid"()) OR ("id" = "auth"."uid"()) OR ("public"."is_staff"() = true)));



ALTER TABLE "public"."account_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "account_movements_staff" ON "public"."account_movements" TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());



ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_settings_select" ON "public"."app_settings" FOR SELECT USING (true);



CREATE POLICY "app_settings_staff" ON "public"."app_settings" TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());



ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_shifts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cash_shifts_staff" ON "public"."cash_shifts" TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());



ALTER TABLE "public"."customer_credit_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_credit_movements_owner_select" ON "public"."customer_credit_movements" FOR SELECT TO "authenticated" USING (("customer_credit_id" IN ( SELECT "customer_credits"."id"
   FROM "public"."customer_credits"
  WHERE ("customer_credits"."profile_id" = "auth"."uid"()))));



CREATE POLICY "customer_credit_movements_staff" ON "public"."customer_credit_movements" TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());



ALTER TABLE "public"."customer_credits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_credits_owner_select" ON "public"."customer_credits" FOR SELECT TO "authenticated" USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "customer_credits_staff" ON "public"."customer_credits" TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());



ALTER TABLE "public"."financial_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "financial_accounts_modify" ON "public"."financial_accounts" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "financial_accounts_select" ON "public"."financial_accounts" FOR SELECT TO "authenticated" USING ("public"."is_staff"());



CREATE POLICY "loyalty_claims_select" ON "public"."loyalty_reward_claims" FOR SELECT USING ((("customer_id" IN ( SELECT "profiles"."id"
   FROM "public"."profiles"
  WHERE (("profiles"."auth_user_id" = "auth"."uid"()) OR ("profiles"."id" = "auth"."uid"())))) OR ("public"."is_staff"() = true)));



CREATE POLICY "loyalty_claims_staff_modify" ON "public"."loyalty_reward_claims" TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());



ALTER TABLE "public"."loyalty_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_reward_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_rewards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "loyalty_rewards_select" ON "public"."loyalty_rewards" FOR SELECT USING (true);



CREATE POLICY "loyalty_rewards_staff_modify" ON "public"."loyalty_rewards" TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services_select_all" ON "public"."services" FOR SELECT USING (true);



CREATE POLICY "services_staff_modify" ON "public"."services" TO "authenticated" USING ("public"."is_staff"()) WITH CHECK ("public"."is_staff"());





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."fn_on_account_movement"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_on_account_movement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_on_account_movement"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_on_credit_movement"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_on_credit_movement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_on_credit_movement"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_on_sale_deleted"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_on_sale_deleted"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_on_sale_deleted"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_on_sale_loyalty_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_on_sale_loyalty_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_on_sale_loyalty_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_on_sales_truncated"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_on_sales_truncated"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_on_sales_truncated"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_barber_dashboard_kpis"("p_barber_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_barber_dashboard_kpis"("p_barber_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_barber_dashboard_kpis"("p_barber_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_staff"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_staff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_staff"() TO "service_role";



GRANT ALL ON FUNCTION "public"."redeem_loyalty_claim"("p_claim_id" "uuid", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."redeem_loyalty_claim"("p_claim_id" "uuid", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."redeem_loyalty_claim"("p_claim_id" "uuid", "p_notes" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."account_movements" TO "anon";
GRANT ALL ON TABLE "public"."account_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."account_movements" TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON TABLE "public"."business_settings" TO "anon";
GRANT ALL ON TABLE "public"."business_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."business_settings" TO "service_role";



GRANT ALL ON TABLE "public"."cash_shifts" TO "anon";
GRANT ALL ON TABLE "public"."cash_shifts" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_shifts" TO "service_role";



GRANT ALL ON TABLE "public"."customer_credit_movements" TO "anon";
GRANT ALL ON TABLE "public"."customer_credit_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_credit_movements" TO "service_role";



GRANT ALL ON TABLE "public"."customer_credits" TO "anon";
GRANT ALL ON TABLE "public"."customer_credits" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_credits" TO "service_role";



GRANT ALL ON TABLE "public"."financial_accounts" TO "anon";
GRANT ALL ON TABLE "public"."financial_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_progress" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_progress" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_reward_claims" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_reward_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_reward_claims" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_rewards" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."sales_history" TO "anon";
GRANT ALL ON TABLE "public"."sales_history" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_history" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































