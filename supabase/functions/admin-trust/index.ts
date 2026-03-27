import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify user is admin
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    if (!roles?.some((r: any) => r.role === "admin")) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    if (body.action === "create") {
      const { name, slug, pin } = body;
      if (!name || !slug || !pin) {
        return new Response(JSON.stringify({ error: "Missing fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (typeof pin !== 'string' || pin.length < 4 || pin.length > 20) {
        return new Response(JSON.stringify({ error: "PIN must be 4-20 characters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const hash = await bcrypt.hash(pin);
      const { data, error } = await supabase
        .from("trusts")
        .insert({ name, slug, trust_pin_hash: hash, active: true })
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Audit log
      await supabase.from("audit_log").insert({
        user_id: user.id,
        user_email: user.email,
        action: "trust_created",
        details: { trust_id: data.id, trust_name: name },
      });

      // Don't return trust_pin_hash
      const { trust_pin_hash, ...safeData } = data;
      return new Response(JSON.stringify({ ok: true, trust: safeData }), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "invite_user") {
      const { email, password, role, trust_id, full_name } = body;
      if (!email || !password || !role || !trust_id) {
        return new Response(JSON.stringify({ error: "Missing fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!["admin", "command"].includes(role)) {
        return new Response(JSON.stringify({ error: "Role must be admin or command" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create user via admin API
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || "" },
      });

      if (createError || !newUser.user) {
        return new Response(JSON.stringify({ error: createError?.message || "Failed to create user" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Set trust_id and full_name on profile
      await supabase
        .from("profiles")
        .update({ trust_id, full_name: full_name || null })
        .eq("id", newUser.user.id);

      // Assign role
      await supabase
        .from("user_roles")
        .insert({ user_id: newUser.user.id, role });

      // Audit log
      await supabase.from("audit_log").insert({
        user_id: user.id,
        user_email: user.email,
        action: "user_invited",
        trust_id,
        details: { invited_email: email, role, trust_id },
      });

      return new Response(JSON.stringify({ ok: true, user_id: newUser.user.id }), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
