(() => {
  "use strict";
  const cfg = window.SWAD_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR_PROJECT") && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_");
  const db = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const $ = (s) => document.querySelector(s);
  const state = { items: [], categories: ["all"], category: "all", cart: new Map(), settings: { name: cfg.RESTAURANT_NAME || "Swad Sangam", location: cfg.DEFAULT_LOCATION || "Bihar, India", phone: "", hours: "", delivery_fee: 0, minimum_order: 0, accepting_orders: true } };
  const rupees = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(n || 0));
  const safe = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const toast = (m) => { const el=$("#toast"); el.textContent=m; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),3200); };
  const placeholder = "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=700&q=80";

  async function loadSettings() {
    if (!db) return;
    const { data } = await db.from("restaurant_settings").select("*").eq("id", 1).maybeSingle();
    if (data) state.settings = { ...state.settings, ...data };
    $("#restaurant-location").textContent = state.settings.location || "Bihar, India";
    $("#restaurant-hours").textContent = state.settings.hours || "Opening hours to be confirmed";
    $("#restaurant-phone").textContent = state.settings.phone || "Contact the restaurant for assistance";
    document.title = `${state.settings.name || "Swad Sangam"} | Taste that brings us together`;
  }
  async function loadMenu() {
    const grid=$("#menu-grid");
    if (!db) {
      grid.innerHTML = `<div class="setup-notice"><b>Website preview</b><p>Connect your Supabase project in <code>assets/config.js</code> and run <code>supabase/schema.sql</code> to load the live menu and accept real orders.</p></div>`;
      $("#menu-message").textContent = "Backend setup is required before placing real orders.";
      return;
    }
    const { data, error } = await db.from("menu_items").select("id,name,description,category,price,image_url,is_available,is_vegetarian").eq("is_available", true).order("category").order("name");
    if (error) { grid.innerHTML = `<p class="error-message">Could not load the menu. Please try again later.</p>`; return; }
    state.items = data || [];
    state.categories = ["all", ...new Set(state.items.map(i=>i.category).filter(Boolean))];
    renderCategories(); renderMenu();
  }
  function renderCategories() {
    $("#category-list").innerHTML = state.categories.map(c=>`<button class="category-chip ${state.category===c?"active":""}" data-category="${safe(c)}">${c==="all"?"All items":safe(c)}</button>`).join("");
  }
  function renderMenu() {
    const items = state.items.filter(i=>state.category==="all" || i.category===state.category);
    $("#menu-grid").innerHTML = items.length ? items.map(i=>`<article class="food-card">
      <div class="food-image-wrap"><img src="${safe(i.image_url || placeholder)}" alt="${safe(i.name)}" loading="lazy" onerror="this.src='${placeholder}'">${i.is_vegetarian?'<span class="veg-mark" title="Vegetarian">●</span>':''}</div>
      <div class="food-card-copy"><div class="food-card-title"><h3>${safe(i.name)}</h3><b>${rupees(i.price)}</b></div><p>${safe(i.description || "")}</p><button class="add-button" data-add="${safe(i.id)}">Add to cart <span>+</span></button></div>
    </article>`).join("") : `<p class="muted">No items in this category yet.</p>`;
  }
  function totals() {
    let subtotal=0;
    for (const [id,qty] of state.cart) { const i=state.items.find(x=>x.id===id); if(i) subtotal += Number(i.price)*qty; }
    const delivery = $("#fulfillment")?.value === "pickup" ? 0 : Number(state.settings.delivery_fee || 0);
    return { subtotal, delivery, total: subtotal + delivery };
  }
  function renderCart() {
    const count = [...state.cart.values()].reduce((a,b)=>a+b,0);
    $("#cart-count").textContent=count;
    const entries=[...state.cart.entries()].map(([id,qty])=>({ item:state.items.find(i=>i.id===id), qty })).filter(x=>x.item);
    $("#cart-items").innerHTML=entries.length ? entries.map(({item,qty})=>`<div class="cart-line"><img src="${safe(item.image_url || placeholder)}" alt=""><div class="cart-line-copy"><b>${safe(item.name)}</b><span>${rupees(item.price)}</span><div class="quantity-controls"><button data-qty="${safe(item.id)}" data-delta="-1" aria-label="Decrease quantity">−</button><span>${qty}</span><button data-qty="${safe(item.id)}" data-delta="1" aria-label="Increase quantity">+</button></div></div><b>${rupees(Number(item.price)*qty)}</b></div>`).join("") : `<div class="empty-cart"><span>♡</span><h3>Your cart is waiting</h3><p>Add a dish you love to get started.</p></div>`;
    const t=totals();
    $("#cart-summary").innerHTML=entries.length?`<div><span>Subtotal</span><b>${rupees(t.subtotal)}</b></div><div><span>Delivery fee</span><b>${rupees(t.delivery)}</b></div><div class="grand-total"><span>Total</span><b>${rupees(t.total)}</b></div>`:"";
    $("#checkout-button").disabled=!entries.length;
    $("#checkout-total").innerHTML=`<div><span>Items subtotal</span><b>${rupees(t.subtotal)}</b></div><div><span>Delivery fee</span><b>${rupees(t.delivery)}</b></div><div class="grand-total"><span>Total</span><b>${rupees(t.total)}</b></div>`;
  }
  function openCart() { $("#cart-drawer").classList.add("open"); $("#drawer-backdrop").classList.add("show"); $("#cart-drawer").setAttribute("aria-hidden","false"); }
  function closeCart() { $("#cart-drawer").classList.remove("open"); $("#drawer-backdrop").classList.remove("show"); $("#cart-drawer").setAttribute("aria-hidden","true"); }
  function openCheckout() {
    if (!db) { toast("Connect the backend before placing real orders."); return; }
    closeCart(); $("#checkout-backdrop").classList.add("show"); renderCart(); updateAddressField();
  }
  function closeCheckout() { $("#checkout-backdrop").classList.remove("show"); }
  function updateAddressField() { const pickup=$("#fulfillment").value==="pickup"; $("#address-label").hidden=pickup; $("#address").required=!pickup; renderCart(); }
  async function postFunction(name, payload) {
    const { data: { session } } = await db.auth.getSession();
    const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${name}`, { method:"POST", headers:{ "Content-Type":"application/json", "apikey":cfg.SUPABASE_ANON_KEY, "Authorization":`Bearer ${session?.access_token || cfg.SUPABASE_ANON_KEY}` }, body:JSON.stringify(payload) });
    const json=await res.json().catch(()=>({error:"Unexpected server response"}));
    if(!res.ok) throw new Error(json.error || "Could not process the request.");
    return json;
  }
  function whatsappUrl(order) {
    const number=String(cfg.RESTAURANT_WHATSAPP||"").replace(/\D/g,"");
    if(!number || number.includes("XXXXXXXX")) return "";
    const lines=[`New order request — ${state.settings.name || "Swad Sangam"}`,`Order: ${order.order_number}`,`Customer: ${order.customer_name}`,`Phone: ${order.phone}`,`Type: ${order.fulfillment}`,`Address: ${order.address || "Pickup"}`,`Items: ${order.items.map(i=>`${i.name || i.item_name} x ${i.quantity}`).join(", ")}`,`Total: ${rupees(order.total_amount)}`,`Payment: ${order.payment_method}`];
    return `https://wa.me/${number}?text=${encodeURIComponent(lines.join("\n"))}`;
  }
  $("#category-list").addEventListener("click",e=>{const b=e.target.closest("[data-category]");if(!b)return;state.category=b.dataset.category;renderCategories();renderMenu();});
  $("#menu-grid").addEventListener("click",e=>{const b=e.target.closest("[data-add]");if(!b)return;const id=b.dataset.add;state.cart.set(id,(state.cart.get(id)||0)+1);renderCart();toast("Added to your cart");});
  $("#cart-items").addEventListener("click",e=>{const b=e.target.closest("[data-qty]");if(!b)return;const id=b.dataset.qty;const next=(state.cart.get(id)||0)+Number(b.dataset.delta);if(next<=0)state.cart.delete(id);else state.cart.set(id,next);renderCart();});
  $("#open-cart").addEventListener("click",openCart); $("#close-cart").addEventListener("click",closeCart); $("#drawer-backdrop").addEventListener("click",closeCart);
  $("#checkout-button").addEventListener("click",openCheckout); $("#close-checkout").addEventListener("click",closeCheckout);
  $("#checkout-backdrop").addEventListener("click",e=>{if(e.target.id==="checkout-backdrop")closeCheckout();});
  $("#fulfillment").addEventListener("change",updateAddressField);
  $("#checkout-form").addEventListener("change",e=>{if(e.target.name==="payment_method"){}});
  $("#checkout-form").addEventListener("submit", async e=>{
    e.preventDefault(); const form=e.currentTarget; const button=$("#place-order"); const err=$("#checkout-error"); err.textContent="";
    if(!db) {err.textContent="Backend is not configured.";return;}
    const f=new FormData(form); const payment=f.get("payment_method");
    const payload={ customer_name:String(f.get("customer_name")).trim(), phone:String(f.get("phone")).trim(), address:$("#fulfillment").value==="pickup"?"":String(f.get("address")||"").trim(), fulfillment:String(f.get("fulfillment")), notes:String(f.get("notes")||"").trim(), payment_method:payment, items:[...state.cart.entries()].map(([menu_item_id,quantity])=>({menu_item_id,quantity})) };
    if(!payload.items.length){err.textContent="Your cart is empty.";return;}
    button.disabled=true; button.textContent=payment==="online"?"Preparing secure payment…":"Placing order…";
    try {
      const created=await postFunction("create-order",payload);
      if(payment==="online") {
        if(!window.Razorpay) throw new Error("Payment checkout did not load. Please try again or choose cash payment.");
        const options={key:cfg.RAZORPAY_KEY_ID,amount:created.amount,currency:created.currency||"INR",name:state.settings.name||"Swad Sangam",description:`Order ${created.order_number}`,order_id:created.razorpay_order_id,prefill:{name:payload.customer_name,contact:payload.phone},theme:{color:"#6f1726"},
          handler:async response=>{
            try {
              const verified=await postFunction("verify-payment",{order_id:created.order_id,razorpay_order_id:response.razorpay_order_id,razorpay_payment_id:response.razorpay_payment_id,razorpay_signature:response.razorpay_signature});
              finishOrder(verified.order, "Payment successful. Your order has been received.");
            } catch(ex) { err.textContent=ex.message+" If money was deducted, contact the restaurant with order "+created.order_number+"."; button.disabled=false; button.textContent="Try payment again"; }
          },
          modal:{ondismiss:()=>{button.disabled=false;button.textContent="Place order";toast("Payment was not completed. Your order is not confirmed.");}}
        };
        const rzp=new Razorpay(options); rzp.on("payment.failed",resp=>{err.textContent=resp.error?.description||"Payment failed. Please try again.";}); rzp.open();
      } else {
        finishOrder(created.order,"Order placed successfully! The restaurant will confirm it shortly.");
      }
    } catch(ex) { err.textContent=ex.message || "Something went wrong. Please try again."; }
    finally { if(button.textContent!=="Preparing secure payment…"){button.disabled=false;if(button.textContent!=="Place order")button.textContent="Place order";} }
  });
  function finishOrder(order,message) {
    state.cart.clear(); renderCart(); closeCheckout(); closeCart(); toast(message);
    const link=whatsappUrl(order);
    const modal=document.createElement("div"); modal.className="success-card";
    modal.innerHTML=`<div class="success-icon">✓</div><h2>Thank you!</h2><p>${safe(message)}</p><div class="order-number">Order number<br><strong>${safe(order.order_number)}</strong></div><p class="muted">Please save your order number for reference.</p>${link?`<a class="button button-primary full-width" target="_blank" rel="noopener" href="${link}">Send order details on WhatsApp</a>`:""}<button class="button button-outline full-width" id="done-order">Continue browsing</button>`;
    document.body.appendChild(modal); $("#done-order").addEventListener("click",()=>modal.remove());
  }
  $("#year").textContent=new Date().getFullYear();
  $("#restaurant-location").textContent=state.settings.location;
  $("#restaurant-phone").textContent="Contact the restaurant for assistance";
  loadSettings().then(loadMenu); renderCart();
})();