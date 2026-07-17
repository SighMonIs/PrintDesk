// Handles Stripe's checkout.session.completed event: turns a paid Checkout
// Session into real rows in `orders`, the same shape the admin order form
// writes (see saveOrder() in ui.js) so paid shop orders show up in the
// existing admin inbox unmodified.
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

function padN(n: number, l: number) {
  return String(n).padStart(l, "0");
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (e) {
    return new Response(`Webhook signature verification failed: ${e.message}`, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return new Response("ok");
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // The shop_checkout_sessions row doubles as the idempotency guard —
  // Stripe can redeliver the same event, and by the second delivery this
  // row is already gone.
  const { data: pending } = await supabase
    .from("shop_checkout_sessions")
    .select("cart, customer_id")
    .eq("session_id", session.id)
    .maybeSingle();
  if (!pending) return new Response("ok");

  const email = session.customer_details?.email ?? "";
  const name = session.customer_details?.name || email || "Shop customer";
  // Newer Checkout Session API versions moved shipping_details under
  // collected_information — check both shapes rather than pin an older
  // API version just for this one field.
  const sessionAny = session as unknown as {
    shipping_details?: Stripe.Checkout.Session.ShippingDetails | null;
    collected_information?: { shipping_details?: Stripe.Checkout.Session.ShippingDetails | null };
  };
  const addr = (sessionAny.collected_information?.shipping_details ?? sessionAny.shipping_details)?.address;
  const address = addr
    ? [addr.line1, addr.line2, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ")
    : "";

  let deliveryName = "Post";
  const shippingRateId = session.shipping_cost?.shipping_rate;
  if (shippingRateId) {
    const rate = await stripe.shippingRates.retrieve(String(shippingRateId));
    deliveryName = rate.display_name ?? deliveryName;
  }

  // Resolve the customer: prefer the signed-in customer captured when the
  // checkout session was created, otherwise match/create by email so guest
  // checkouts still land against a real customers row.
  let customerId = pending.customer_id as string | null;
  if (!customerId && email) {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("email", email)
      .limit(1)
      .maybeSingle();
    if (existing) {
      customerId = existing.id;
    } else {
      const { data: created } = await supabase
        .from("customers")
        .insert({ id: crypto.randomUUID(), name, email, address })
        .select("id")
        .single();
      customerId = created?.id ?? null;
    }
  }

  // order_id follows the same O0000000001 sequence nextOrderId() uses in
  // the admin app (api.js) — max existing numeric id + 1, no DB sequence.
  const { data: existingOrders } = await supabase.from("orders").select("order_id");
  const nums = (existingOrders ?? [])
    .map((o) => String(o.order_id))
    .filter((id) => /^O\d+$/.test(id))
    .map((id) => parseInt(id.slice(1), 10));
  const orderId = "O" + padN((nums.length ? Math.max(...nums) : 0) + 1, 10);
  const shortOrder = orderId.replace(/^O0*/, "O");
  const today = new Date().toISOString().slice(0, 10);

  const cart = pending.cart as { cat_id: string; price: number; qty: number; options: string }[];
  const rows = cart.map((item, i) => ({
    id: `${shortOrder}-${i + 1}`,
    order_id: orderId,
    customer: name,
    customer_id: customerId,
    address,
    delivery: deliveryName,
    payment: "Card",
    cat_id: item.cat_id,
    qty: item.qty,
    price: item.price,
    total: parseFloat((item.price * item.qty).toFixed(2)),
    status: "Pending",
    date: today,
    options: item.options,
    printed: false,
    paid: true,
    inv_consumed: false,
    deleted: false,
  }));

  const { error: insErr } = await supabase.from("orders").insert(rows);
  if (insErr) {
    console.error("Failed to insert paid shop order", insErr);
    return new Response("insert failed", { status: 500 });
  }

  await supabase.from("shop_checkout_sessions").delete().eq("session_id", session.id);

  return new Response("ok");
});
