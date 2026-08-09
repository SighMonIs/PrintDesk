// Thin authenticated proxy to Supabase's GoTrue admin API (list/invite/
// update/delete users), so the service-role key lives here as a server-side
// secret instead of in an admin's browser localStorage.
//
// Authorization model: PrintDesk's root app is an internal, staff-only tool
// with no separate "admin" role today — anyone who can sign in to it is
// already trusted to do everything else it does. So the bar here is simply
// "presents a valid access token for a real signed-in user of this project",
// matching that existing trust level. If a tighter tier (e.g. only specific
// staff can manage users) is ever wanted, add that check where marked below.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ msg: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer /, "");
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) return json({ msg: "Not authenticated" }, 401);

    // If a staff/admin tier is ever added, check it here, e.g.:
    //   if (!userData.user.user_metadata?.is_admin) return json({ msg: "Not authorized" }, 403);

    const { method, path, body } = await req.json();
    if (typeof method !== "string" || typeof path !== "string") {
      return json({ msg: "Bad request" }, 400);
    }

    // Only these exact GoTrue admin shapes may be proxied — this function is
    // scoped to user management, not an open passthrough to the auth admin API.
    const allowed =
      (method === "GET" && path === "users") ||
      (method === "POST" && path === "invite") ||
      (method === "PUT" && /^users\/[0-9a-f-]{36}$/i.test(path)) ||
      (method === "DELETE" && /^users\/[0-9a-f-]{36}$/i.test(path));
    if (!allowed) return json({ msg: "Not allowed" }, 403);

    const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return json({ msg: e.message }, 400);
  }
});
