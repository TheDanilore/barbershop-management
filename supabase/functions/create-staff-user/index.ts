import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  // Manejo de Preflight CORS para navegadores
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Configuración incompleta: faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Validar identidad del solicitante (debe ser un Administrador con sesión válida)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Falta cabecera Authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: callerUser },
      error: callerError,
    } = await callerClient.auth.getUser();

    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ error: 'Sesión no autorizada o expirada' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Comprobar rol de administrador en public.profiles o metadata
    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .or(`auth_user_id.eq.${callerUser.id},id.eq.${callerUser.id}`)
      .maybeSingle();

    const isAdmin =
      callerProfile?.role === 'admin' ||
      callerUser.app_metadata?.role === 'admin' ||
      callerUser.user_metadata?.role === 'admin';

    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: 'Permisos insuficientes: solo un Administrador puede crear colaboradores' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Extraer y validar el payload
    const body = await req.json();
    const { email, password, fullName, phone, role, isActive } = body;

    if (!email || !password || !fullName) {
      return new Response(
        JSON.stringify({ error: 'Email, contraseña y nombre completo son obligatorios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = String(fullName).trim();
    const cleanPhone = phone ? String(phone).trim() : null;
    const assignedRole = role === 'admin' ? 'admin' : 'barber';
    const isUserActive = isActive !== undefined ? Boolean(isActive) : true;

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'La contraseña debe tener un mínimo de 6 caracteres' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Cliente Admin con permisos de Service Role (Deno / Servidor Supabase)
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 4. Crear cuenta en auth.users con correo pre-confirmado
    const { data: authResult, error: createError } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password: String(password),
      email_confirm: true, // Auto-confirmar para acceso inmediato sin esperar enlace
      user_metadata: {
        full_name: cleanName,
        role: assignedRole,
        phone: cleanPhone,
      },
      app_metadata: {
        role: assignedRole,
      },
    });

    if (createError || !authResult?.user) {
      return new Response(
        JSON.stringify({ error: createError?.message || 'Error al crear la cuenta en Supabase Auth' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const newUserId = authResult.user.id;

    // 5. Crear o actualizar la fila correspondiente en public.profiles
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .upsert(
        {
          id: newUserId,
          auth_user_id: newUserId,
          full_name: cleanName,
          role: assignedRole,
          phone: cleanPhone,
          membership_tier: 'Bronze',
          is_active: isUserActive,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select('id, auth_user_id, full_name, role, phone, is_active, created_at')
      .single();

    if (profileError) {
      return new Response(
        JSON.stringify({ error: `Usuario creado en Auth pero error en perfiles: ${profileError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: profile.id,
          fullName: profile.full_name,
          email: cleanEmail,
          phone: profile.phone || '',
          role: profile.role,
          isActive: profile.is_active,
          createdAt: profile.created_at,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error inesperado en create-staff-user';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
