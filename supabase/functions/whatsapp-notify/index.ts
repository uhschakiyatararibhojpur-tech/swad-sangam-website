// Optional server-to-server WhatsApp Cloud API sender.
// This function should be called only from a trusted server workflow or configured database webhook.
// Never expose WHATSAPP_TOKEN in frontend JavaScript.
const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply({error:"Method not allowed"},405);
  try{
    const token=Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneId=Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const notifySecret=Deno.env.get("WHATSAPP_NOTIFY_SECRET");
    if(!token||!phoneId||!notifySecret)return reply({error:"WhatsApp Cloud API is not configured."},503);
    if(req.headers.get("x-notify-secret")!==notifySecret)return reply({error:"Unauthorized."},401);
    const body=await req.json();
    const to=String(body.to||"").replace(/\D/g,"");
    const text=String(body.text||"").slice(0,3500);
    if(!/^\d{10,15}$/.test(to)||!text)return reply({error:"A valid recipient phone and message are required."},400);
    const res=await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`,{
      method:"POST",headers:{"Authorization":`Bearer ${token}`,"Content-Type":"application/json"},
      body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to,type:"text",text:{preview_url:false,body:text}})
    });
    const result=await res.json();
    if(!res.ok){console.error("WhatsApp API error",result);return reply({error:"WhatsApp could not send the notification."},502);}
    return reply({sent:true,message_id:result.messages?.[0]?.id||null});
  }catch(e){console.error("whatsapp-notify error",e);return reply({error:"Unexpected server error."},500);}
});