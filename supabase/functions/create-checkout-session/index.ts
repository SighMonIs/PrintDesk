// Creates a Stripe Checkout Session for the customer's cart.
//
// Prices are never trusted from the client — every line is re-priced here
// from the `categories` table. Stripe's hosted page collects the shipping
// address and delivery method itself (see shippingOptions below), so the
// shop doesn't need its own checkout form.
//
// The cart is too large to reliably fit in Stripe's per-key metadata limit,
// so it's stashed in `shop_checkout_sessions` keyed by the session id and
// picked back up by stripe-webhook once payment completes.
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { cart } = await req.json();
    if (!Array.isArray(cart) || !cart.length) {
      return new Response(JSON.stringify({ error: "Cart is empty" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Identify the signed-in customer (if any) from their JWT, rather than
    // trusting a client-supplied customer id.
    let customer: { id: string; email: string; name: string } | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace(/^Bearer /, "");
      const { data: userData } = await supabase.auth.getUser(token);
      if (userData?.user) {
        const { data: rows } = await supabase
          .from("customers")
          .select("id,email,name")
          .eq("auth_user_id", userData.user.id)
          .limit(1);
        if (rows?.[0]) customer = rows[0];
      }
    }

    const catIds = [...new Set(cart.map((i: any) => String(i.cat_id)))];
    const { data: cats, error: catErr } = await supabase
      .from("categories")
      .select("id,name,price")
      .in("id", catIds)
      .eq("archived", false);
    if (catErr) throw catErr;

    const priced = cart.map((item: any) => {
      const cat = cats?.find((c) => String(c.id) === String(item.cat_id));
      if (!cat) throw new Error(`Unknown or unavailable category: ${item.cat_id}`);
      const qty = Math.max(1, Number(item.qty) || 1);
      return { cat_id: cat.id, name: cat.name, price: cat.price, qty, options: String(item.options || "") };
    });

    const { data: deliveryOptions, error: delErr } = await supabase
      .from("delivery_options")
      .select("name,price")
      .eq("archived", false)
      .order("sort_order");
    if (delErr) throw delErr;

    const shippingOptions = (deliveryOptions ?? []).map((d) => ({
      shipping_rate_data: {
        type: "fixed_amount" as const,
        fixed_amount: { amount: Math.round(d.price * 100), currency: "aud" },
        display_name: d.name,
      },
    }));

    const shopUrl = Deno.env.get("SHOP_URL")!;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: priced.map((p) => ({
        price_data: {
          currency: "aud",
          product_data: { name: p.name },
          unit_amount: Math.round(p.price * 100),
        },
        quantity: p.qty,
      })),
      shipping_address_collection: { allowed_countries: ["AU"] },
      shipping_options: shippingOptions.length ? shippingOptions : undefined,
      customer_email: customer?.email,
      success_url: `${shopUrl}?checkout=success`,
      cancel_url: `${shopUrl}?checkout=cancelled`,
    });

    const { error: insErr } = await supabase.from("shop_checkout_sessions").insert({
      session_id: session.id,
      cart: priced,
      customer_id: customer?.id ?? null,
    });
    if (insErr) throw insErr;

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
