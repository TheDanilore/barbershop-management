


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


CREATE OR REPLACE FUNCTION "public"."fn_on_sale_loyalty_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."fn_on_sale_loyalty_update"() OWNER TO "postgres";


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

SET default_tablespace = '';

SET default_table_access_method = "heap";


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


CREATE TABLE IF NOT EXISTS "public"."loyalty_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "current_stamps" integer DEFAULT 0 NOT NULL,
    "total_historical_cuts" integer DEFAULT 0 NOT NULL,
    "rewards_claimed" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."loyalty_progress" OWNER TO "postgres";


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
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sales_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "base_price" numeric(10,2) NOT NULL,
    "duration_minutes" integer DEFAULT 30 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."services" OWNER TO "postgres";


ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loyalty_progress"
    ADD CONSTRAINT "loyalty_progress_customer_id_key" UNIQUE ("customer_id");



ALTER TABLE ONLY "public"."loyalty_progress"
    ADD CONSTRAINT "loyalty_progress_pkey" PRIMARY KEY ("id");



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



CREATE INDEX "idx_appointments_scheduled_status" ON "public"."appointments" USING "btree" ("scheduled_at", "status");



CREATE INDEX "idx_loyalty_customer" ON "public"."loyalty_progress" USING "btree" ("customer_id");



CREATE INDEX "idx_sales_created_barber" ON "public"."sales_history" USING "btree" ("created_at" DESC, "barber_id");



CREATE INDEX "idx_sales_customer" ON "public"."sales_history" USING "btree" ("customer_id");



CREATE OR REPLACE TRIGGER "trg_sale_loyalty_update" AFTER INSERT ON "public"."sales_history" FOR EACH ROW EXECUTE FUNCTION "public"."fn_on_sale_loyalty_update"();



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_barber_id_fkey" FOREIGN KEY ("barber_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id");



ALTER TABLE ONLY "public"."loyalty_progress"
    ADD CONSTRAINT "loyalty_progress_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



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



CREATE POLICY "Barberos y admins gestionan fidelidad" ON "public"."loyalty_progress" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"public"."user_role", 'barber'::"public"."user_role"]))))));



CREATE POLICY "Clientes ven su propio progreso" ON "public"."loyalty_progress" FOR SELECT USING (("auth"."uid"() = "customer_id"));



CREATE POLICY "Clientes ven sus propios recibos" ON "public"."sales_history" FOR SELECT USING (("auth"."uid"() = "customer_id"));



CREATE POLICY "Gestión completa de ventas para personal" ON "public"."sales_history" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"public"."user_role", 'barber'::"public"."user_role"]))))));



ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."loyalty_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."fn_on_sale_loyalty_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."fn_on_sale_loyalty_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_on_sale_loyalty_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_barber_dashboard_kpis"("p_barber_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_barber_dashboard_kpis"("p_barber_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_barber_dashboard_kpis"("p_barber_id" "uuid") TO "service_role";


















GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON TABLE "public"."loyalty_progress" TO "anon";
GRANT ALL ON TABLE "public"."loyalty_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."loyalty_progress" TO "service_role";



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































