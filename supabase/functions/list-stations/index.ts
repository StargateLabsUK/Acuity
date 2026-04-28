import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";

serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  try {
    const { trust_id } = await req.json();
    if (!trust_id || typeof trust_id !== "string") {
      return new Response(
        JSON.stringify({ error: "trust_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: trust } = await supabase
      .from("trusts")
      .select("id")
      .eq("id", trust_id)
      .eq("active", true)
      .maybeSingle();

    if (!trust) {
      return new Response(
        JSON.stringify({ error: "Invalid trust" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data, error } = await supabase
      .from("stations")
      .select("id, trust_id, name, active, created_at")
      .eq("trust_id", trust_id)
      .eq("active", true)
      .order("name", { ascending: true });

    if (error) {
      return new Response(
        JSON.stringify({ error: "Failed to list stations" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ stations: data ?? [] }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Server error", details: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
