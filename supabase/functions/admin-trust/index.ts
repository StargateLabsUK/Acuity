import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + "herald-salt-2026");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "$sha256$" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

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
      return new Response(JSON.stringify({ error: "Unauthorized: " + (userError?.message || "no user"), hasToken: !!token, tokenLen: token.length }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isOwner = roles?.some((r: any) => r.role === "owner");
    const isAdmin = roles?.some((r: any) => r.role === "admin");
    if (!isOwner && !isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();

    if (body.action === "create") {
      if (!isOwner) {
        return new Response(JSON.stringify({ error: "Only the Herald owner can create trusts" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

      const hash = await hashPin(pin);
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

    if (body.action === "reset_pin") {
      const { trust_id, pin } = body;
      // Trust admins can only reset their own trust's PIN
      if (isAdmin && !isOwner) {
        const { data: profile } = await supabase
          .from("profiles").select("trust_id").eq("id", user.id).maybeSingle();
        if (profile?.trust_id !== trust_id) {
          return new Response(JSON.stringify({ error: "You can only reset your own trust's PIN" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      if (!trust_id || !pin) {
        return new Response(JSON.stringify({ error: "Missing trust_id or pin" }), {
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

      const hash = await hashPin(pin);
      const { error: updateError } = await supabase
        .from("trusts")
        .update({ trust_pin_hash: hash })
        .eq("id", trust_id);

      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        user_email: user.email,
        action: "trust_pin_reset",
        trust_id,
        details: { trust_id },
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
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

      // Password policy: min 8 chars, at least one letter and one number
      if (typeof password !== 'string' || password.length < 8) {
        return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        return new Response(JSON.stringify({ error: "Password must contain at least one letter and one number" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Trust admins can only create command users for their own trust
      if (isAdmin && !isOwner) {
        if (role !== "command") {
          return new Response(JSON.stringify({ error: "Trust admins can only create command users" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { data: profile } = await supabase
          .from("profiles").select("trust_id").eq("id", user.id).maybeSingle();
        if (profile?.trust_id !== trust_id) {
          return new Response(JSON.stringify({ error: "You can only create users for your own trust" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Owner can create admin or command; trust admin can only create command
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

    if (body.action === "list_stations") {
      const { trust_id } = body;
      if (!trust_id || typeof trust_id !== "string") {
        return new Response(JSON.stringify({ error: "trust_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Trust admins can only access their own trust.
      if (isAdmin && !isOwner) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("trust_id")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.trust_id !== trust_id) {
          return new Response(JSON.stringify({ error: "You can only view stations for your own trust" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const { data, error } = await supabase
        .from("stations")
        .select("id, trust_id, name, active, created_at")
        .eq("trust_id", trust_id)
        .order("name", { ascending: true });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, stations: data ?? [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "create_station") {
      const { trust_id, name } = body;
      const stationName = typeof name === "string" ? name.trim() : "";
      if (!trust_id || typeof trust_id !== "string" || !stationName) {
        return new Response(JSON.stringify({ error: "trust_id and station name are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (stationName.length < 2 || stationName.length > 80) {
        return new Response(JSON.stringify({ error: "Station name must be 2-80 characters" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (isAdmin && !isOwner) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("trust_id")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.trust_id !== trust_id) {
          return new Response(JSON.stringify({ error: "You can only add stations to your own trust" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const { data, error } = await supabase
        .from("stations")
        .insert({ trust_id, name: stationName, active: true })
        .select("id, trust_id, name, active, created_at")
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        user_email: user.email,
        action: "station_created",
        trust_id,
        details: { station_id: data.id, station_name: data.name },
      });

      return new Response(JSON.stringify({ ok: true, station: data }), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "toggle_station") {
      const { station_id, active } = body;
      if (!station_id || typeof station_id !== "string" || typeof active !== "boolean") {
        return new Response(JSON.stringify({ error: "station_id and active are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: station, error: lookupError } = await supabase
        .from("stations")
        .select("id, trust_id, name")
        .eq("id", station_id)
        .maybeSingle();

      if (lookupError || !station) {
        return new Response(JSON.stringify({ error: "Station not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (isAdmin && !isOwner) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("trust_id")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.trust_id !== station.trust_id) {
          return new Response(JSON.stringify({ error: "You can only manage stations in your own trust" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const { error } = await supabase
        .from("stations")
        .update({ active, updated_at: new Date().toISOString() })
        .eq("id", station_id);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        user_email: user.email,
        action: active ? "station_activated" : "station_deactivated",
        trust_id: station.trust_id,
        details: { station_id: station.id, station_name: station.name },
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Server error: " + (e?.message || String(e)) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

