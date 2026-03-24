import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action } = await req.json();

    if (action !== "seed") {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get the Arion Test Trust ID
    const { data: trust } = await supabase
      .from("trusts")
      .select("id")
      .eq("slug", "arion-test")
      .single();

    if (!trust) {
      return new Response(JSON.stringify({ error: "Arion Test Trust not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const users = [
      { email: "arran@arion.industries", role: "admin" },
      { email: "command@arion.industries", role: "command" },
    ];

    const results = [];

    for (const u of users) {
      // Check if user exists
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existing = existingUsers?.users?.find((eu: any) => eu.email === u.email);

      let userId: string;

      if (existing) {
        userId = existing.id;
        // Update password
        await supabase.auth.admin.updateUserById(userId, {
          password: "Herald2026!",
        });
      } else {
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: u.email,
          password: "Herald2026!",
          email_confirm: true,
        });

        if (createError || !newUser.user) {
          results.push({ email: u.email, error: createError?.message || "Failed to create" });
          continue;
        }
        userId = newUser.user.id;
      }

      // Upsert profile with trust_id
      await supabase.from("profiles").upsert({
        id: userId,
        email: u.email,
        trust_id: trust.id,
      }, { onConflict: "id" });

      // Upsert role
      const { error: roleError } = await supabase.from("user_roles").upsert({
        user_id: userId,
        role: u.role,
      }, { onConflict: "user_id,role" });

      results.push({ email: u.email, role: u.role, userId, roleError: roleError?.message || null });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
