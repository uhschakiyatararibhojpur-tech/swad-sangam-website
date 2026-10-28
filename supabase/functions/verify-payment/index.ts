import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
Deno.serve(async req => {
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return reply({error:"Method not allowed"},405);
  try {
    const body=await req.json();
    const orderId=String(body.order_id||"");
    const rpOrderId=String(body.razorpay_order_id||"");
    const rpPaymentId=String(body.razorpay_payment_id||"");
    const signature=String(body.razorpay_signature||"");
    if(!orderId||!rpOrderId||!rpPaymentId||!/^[a-f0-9]{128}$/i.test(signature)) return reply({error:"Payment verification details are invalid."},400);
    const secret=Deno.env.get("RAZORPAY_KEY_SECRET");
    const url=Deno.env.get("SUPABASE_URL");
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!secret||!url||!service) return reply({error:"Payment verification is not configured."},500);
    const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const expected=hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${rpOrderId}|${rpPaymentId}`)));
    if(expected.length!==signature.length || ![...expected].every((c,i)=>c===signature[i].toLowerCase())) return reply({error:"Payment signature could not be verified."},400);
    const db=createClient(url,service,{auth:{persistSession:false}});
    const {data:order,error}=await db.from("orders").select("*").eq("id",orderId).eq("razorpay_order_id",rpOrderId).single();
    if(error||!order) return reply({error:"Order not found for this payment."},404);
    if(order.payment_status==="paid") {
      const {data:items}=await db.from("order_items").select("item_name as name,quantity").eq("order_id",order.id);
      return reply({order:{...order,items:items||[]}});
    }
    // Verify with Razorpay API too; don't rely on a browser callback alone.
    const keyId=Deno.env.get("RAZORPAY_KEY_ID");
    if(!keyId) return reply({error:"Payment gateway is not configured."},500);
    const auth=btoa(`${keyId}:${secret}`);
    const paymentRes=await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(rpPaymentId)}`,{headers:{Authorization:`Basic ${auth}`}});
    const payment=await paymentRes.json();
    if(!paymentRes.ok || payment.order_id!==rpOrderId || payment.status!=="captured" || Number(payment.amount)!==Math.round(Number(order.total_amount)*100) || payment.currency!=="INR") {
      return reply({error:"Payment is not captured or the amount does not match. If money was deducted, contact the restaurant."},400);
    }
    const {error:updateError}=await db.from("orders").update({payment_status:"paid",status:"accepted",razorpay_payment_id:rpPaymentId,updated_at:new Date().toISOString()}).eq("id",order.id).neq("payment_status","paid");
    if(updateError) throw new Error("Payment was verified but order update failed. Contact the restaurant with your order number.");
    const {data:items}=await db.from("order_items").select("item_name as name,quantity").eq("order_id",order.id);
    return reply({order:{...order,payment_status:"paid",status:"accepted",items:items||[]}});
  } catch(e) {
    console.error("verify-payment error",e);
    return reply({error:e instanceof Error?e.message:"Unexpected server error."},500);
  }
});