import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const timestamp = new Date().toISOString();
  const components: Record<string, { status: string; latency_ms?: number }> = {};

  // 1. Database check
  const dbStart = performance.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { error } = await supabase
      .from("herald_reports")
      .select("id")
      .limit(1);

    if (error) throw error;
    components.database = { status: "up", latency_ms: Math.round(performance.now() - dbStart) };
  } catch (e) {
    console.error("Health: DB check failed", e);
    components.database = { status: "down", latency_ms: Math.round(performance.now() - dbStart) };
  }

  // 2. AI provider check
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    components.ai_provider = { status: "down" };
  } else {
    try {
      const aiStart = performance.now();
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      // Any 2xx or 4xx with valid JSON means the API is reachable
      components.ai_provider = {
        status: res.ok || res.status < 500 ? "up" : "down",
        latency_ms: Math.round(performance.now() - aiStart),
      };
      await res.text(); // consume body
    } catch (e) {
      console.error("Health: AI check failed", e);
      components.ai_provider = { status: "down" };
    }
  }

  // 3. Determine overall status
  const dbUp = components.database.status === "up";
  const aiUp = components.ai_provider.status === "up";
  const status = dbUp && aiUp ? "healthy" : dbUp ? "degraded" : "down";

  const body = JSON.stringify({ status, timestamp, components, version: "1.0.0" });
  const httpStatus = status === "down" ? 503 : 200;

  return new Response(body, {
    status: httpStatus,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
