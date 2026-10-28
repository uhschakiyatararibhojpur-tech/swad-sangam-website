import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const jsonError = (message: string, status = 400) => reply({ error: message }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonError("Method not allowed", 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return jsonError("Server configuration is incomplete.", 500);
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const body = await req.json();
    const name = String(body.customer_name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    const address = String(body.address ?? "").trim();
    const fulfillment = body.fulfillment === "pickup" ? "pickup" : "delivery";
    const notes = String(body.notes ?? "").trim().slice(0, 500);
    const payment = body.payment_method === "online" ? "online" : body.payment_method === "cod" ? "cod" : null;
    const rawItems = body.items;
    if (!name || name.length > 100) return jsonError("Enter a valid customer name.");
    if (!/^[0-9+ ()-]{8,20}$/.test(phone)) return jsonError("Enter a valid phone number.");
    if (fulfillment === "delivery" && (address.length < 5 || address.length > 500)) return jsonError("Enter a complete delivery address.");
    if (!payment) return jsonError("Choose a payment method.");
    if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 40) return jsonError("Your cart is empty or contains too many items.");
    const quantities = new Map<string, number>();
    for (const entry of rawItems) {
      const id = String(entry?.menu_item_id ?? "");
      const quantity = Number(entry?.quantity);
      if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) return jsonError("One or more cart items are invalid.");
      quantities.set(id, (quantities.get(id) ?? 0) + quantity);
    }
    if ([...quantities.values()].some(q => q > 50)) return jsonError("Maximum quantity per item is 50.");
    const ids = [...quantities.keys()];
    const { data: menu, error: menuError } = await db.from("menu_items").select("id,name,price,is_available").in("id", ids);
    if (menuError) throw new Error("Could not validate menu prices.");
    if (!menu || menu.length !== ids.length || menu.some(i => !i.is_available)) return jsonError("One or more items are no longer available. Refresh the menu.");
    const { data: settings, error: settingsError } = await db.from("restaurant_settings").select("*").eq("id", 1).single();
    if (settingsError || !settings) throw new Error("Restaurant settings are not configured.");
    if (!settings.accepting_orders) return jsonError("The restaurant is not accepting orders right now.", 409);
    const lines = menu.map(i => ({ menu_item_id: i.id, item_name: i.name, unit_price: Number(i.price), quantity: quantities.get(i.id)!, line_total: Math.round(Number(i.price) * quantities.get(i.id)! * 100) / 100 }));
    const subtotal = Math.round(lines.reduce((sum, i) => sum + i.line_total, 0) * 100) / 100;
    if (subtotal < Number(settings.minimum_order || 0)) return jsonError(`Minimum order is ₹${Number(settings.minimum_order).toFixed(2)}.`);
    const deliveryFee = fulfillment === "delivery" ? Number(settings.delivery_fee || 0) : 0;
    const total = Math.round((subtotal + deliveryFee) * 100) / 100;
    const orderNumber = `SS${new Date().toISOString().slice(2,10).replaceAll("-","")}${crypto.randomUUID().slice(0,6).toUpperCase()}`;
    const { data: order, error: insertError } = await db.from("orders").insert({
      order_number: orderNumber, customer_name: name, phone, address, fulfillment, notes,
      payment_method: payment, payment_status: "pending", status: "placed",
      subtotal, delivery_fee: deliveryFee, total_amount: total
    }).select("*").single();
    if (insertError || !order) throw new Error("Could not save your order. Please try again.");
    const { error: lineError } = await db.from("order_items").insert(lines.map(l => ({ ...l, order_id: order.id })));
    if (lineError) {
      await db.from("orders").delete().eq("id", order.id);
      throw new Error("Could not save the order items. Please try again.");
    }

    if (payment === "cod") {
      return reply({ order: { ...order, items: lines }, order_number: orderNumber });
    }

    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    if (!keyId || !keySecret) {
      await db.from("orders").update({ payment_status: "failed", status: "cancelled" }).eq("id", order.id);
      return jsonError("Online payments are not configured. Choose cash payment or contact the restaurant.", 503);
    }
    const auth = btoa(`${keyId}:${keySecret}`);
    const rpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Math.round(total * 100), currency: "INR", receipt: orderNumber, notes: { swad_order_id: order.id } })
    });
    const rp = await rpRes.json();
    if (!rpRes.ok) {
      await db.from("orders").update({ payment_status: "failed", status: "cancelled" }).eq("id", order.id);
      return jsonError("Could not start online payment. Please try again or choose cash payment.", 502);
    }
    const { error: updateError } = await db.from("orders").update({ razorpay_order_id: rp.id }).eq("id", order.id);
    if (updateError) throw new Error("Could not attach payment details to the order.");
    return reply({ order_id: order.id, order_number: orderNumber, amount: rp.amount, currency: rp.currency, razorpay_order_id: rp.id });
  } catch (e) {
    console.error("create-order error", e);
    return jsonError(e instanceof Error ? e.message : "Unexpected server error.", 500);
  }
});