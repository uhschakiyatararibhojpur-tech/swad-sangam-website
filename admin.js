(() => {
  "use strict";
  const cfg=window.SWAD_CONFIG||{};
  const configured=cfg.SUPABASE_URL&&!cfg.SUPABASE_URL.includes("YOUR_PROJECT")&&cfg.SUPABASE_ANON_KEY&&!cfg.SUPABASE_ANON_KEY.includes("YOUR_");
  const db=configured&&window.supabase?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY):null;
  const $=s=>document.querySelector(s);
  const safe=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=n=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(Number(n||0));
  const toast=m=>{const el=$("#toast");el.textContent=m;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),3000);};
  let menu=[];
  const statuses=["placed","accepted","preparing","ready","delivered","cancelled"];
  if(!db){$("#login-panel").innerHTML='<p class="eyebrow">SETUP REQUIRED</p><h1>Connect your backend.</h1><p>Update <code>assets/config.js</code>, run the SQL setup and deploy the Supabase functions before using the owner dashboard.</p>';return;}
  async function requireAdmin(){
    const {data:{session}}=await db.auth.getSession();
    if(!session){$("#login-panel").hidden=false;$("#dashboard").hidden=true;return false;}
    const {data,error}=await db.from("admin_users").select("user_id").eq("user_id",session.user.id).maybeSingle();
    if(error||!data){await db.auth.signOut();$("#login-error").textContent="This account is not authorized as a restaurant owner.";$("#login-panel").hidden=false;$("#dashboard").hidden=true;return false;}
    $("#login-panel").hidden=true;$("#dashboard").hidden=false;return true;
  }
  $("#login-form").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.currentTarget);$("#login-error").textContent="";const {error}=await db.auth.signInWithPassword({email:f.get("email"),password:f.get("password")});if(error){$("#login-error").textContent="Sign-in failed. Check your email and password.";return;}if(await requireAdmin()){await loadOrders();await loadMenu();await loadSettings();}});
  $("#logout-button").addEventListener("click",async()=>{await db.auth.signOut();await requireAdmin();});
  async function loadOrders(){
    $("#orders-list").innerHTML='<p class="loading">Loading orders…</p>';
    const {data,error}=await db.from("orders").select("id,order_number,customer_name,phone,address,fulfillment,notes,payment_method,payment_status,status,subtotal,delivery_fee,total_amount,created_at,order_items(id,item_name,unit_price,quantity,line_total)").order("created_at",{ascending:false}).limit(100);
    if(error){$("#orders-list").innerHTML='<p class="error-message">Could not load orders. Check database policies and connection.</p>';return;}
    const filter=$("#order-filter").value;const list=(data||[]).filter(o=>filter==="all"||o.status===filter);
    $("#orders-list").innerHTML=list.length?list.map(o=>`<article class="order-card"><div class="order-card-top"><div><span class="order-number-label">${safe(o.order_number)}</span><h3>${safe(o.customer_name)}</h3><span class="muted">${new Date(o.created_at).toLocaleString("en-IN")}</span></div><div class="order-total">${money(o.total_amount)}<span class="status-pill status-${safe(o.status)}">${safe(o.status)}</span></div></div><div class="order-details"><p><b>Phone:</b> ${safe(o.phone)} ${o.phone?`<a href="tel:${safe(o.phone)}">Call</a>`:""}</p><p><b>Type:</b> ${safe(o.fulfillment)} · <b>Payment:</b> ${safe(o.payment_method)} (${safe(o.payment_status)})</p><p><b>Address:</b> ${safe(o.address||"Pickup")}</p>${o.notes?`<p><b>Notes:</b> ${safe(o.notes)}</p>`:""}<ul>${(o.order_items||[]).map(i=>`<li>${safe(i.item_name)} × ${i.quantity} — ${money(i.line_total)}</li>`).join("")}</ul><p>Subtotal ${money(o.subtotal)} · Delivery ${money(o.delivery_fee)}</p></div><div class="order-actions"><label>Update status<select data-status="${safe(o.id)}">${statuses.map(s=>`<option value="${s}" ${s===o.status?"selected":""}>${s[0].toUpperCase()+s.slice(1)}</option>`).join("")}</select></label><button class="button button-outline" data-whatsapp="${safe(o.id)}" data-phone="${safe(o.phone)}" data-message="${safe(`Hello ${o.customer_name}, update from Swad Sangam: your order ${o.order_number} is ${o.status}.`)}">WhatsApp customer</button></div></article>`).join(""):'<div class="empty-cart"><h3>No orders found</h3><p>New orders will appear here.</p></div>';
  }
  
  $("#refresh-orders").addEventListener("click", loadOrders);
  $("#order-filter").addEventListener("change", loadOrders);

  // Automatically refresh orders every 15 seconds
  let ordersRefreshTimer = null;

  function startOrdersAutoRefresh() {
    if (ordersRefreshTimer) return;

    ordersRefreshTimer = setInterval(() => {
      if (
        !$("#dashboard").hidden &&
        !$("#orders-tab").hidden &&
        !document.hidden
      ) {
        loadOrders();
      }
    }, 15000);
  }

  function stopOrdersAutoRefresh() {
    if (ordersRefreshTimer) {
      clearInterval(ordersRefreshTimer);
      ordersRefreshTimer = null;
    }
  }

  startOrdersAutoRefresh();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !$("#dashboard").hidden && !$("#orders-tab").hidden) {
      loadOrders();
    }
  });

  $("#orders-list").addEventListener("change",async e=>{const sel=e.target.closest("[data-status]");if(!sel)return;const {error}=await db.from("orders").update({status:sel.value}).eq("id",sel.dataset.status);if(error){toast("Could not update status.");loadOrders();}else toast("Order status updated.");});
  $("#orders-list").addEventListener("click",e=>{const b=e.target.closest("[data-whatsapp]");if(!b)return;const p=b.dataset.phone.replace(/\D/g,"");if(p.length<8){toast("Customer phone number is invalid.");return;}window.open(`https://wa.me/${p}?text=${encodeURIComponent(b.dataset.message)}`,"_blank","noopener");});
  async function loadMenu(){
    const {data,error}=await db.from("menu_items").select("*").order("category").order("name");if(error){$("#menu-admin-list").innerHTML='<p class="error-message">Could not load menu.</p>';return;}menu=data||[];
    $("#menu-admin-list").innerHTML=menu.map(i=>`<div class="menu-admin-row"><div><b>${safe(i.name)}</b><span>${safe(i.category)} · ${money(i.price)} · ${i.is_available?"Available":"Unavailable"}</span></div><div class="button-row"><button class="button button-outline" data-edit="${safe(i.id)}">Edit</button><button class="button button-outline" data-toggle="${safe(i.id)}">${i.is_available?"Mark unavailable":"Make available"}</button></div></div>`).join("")||'<p class="muted">No menu items yet. Add your first item.</p>';
  }
  function editor(item=null){
    const form=$("#item-form");form.reset();form.elements.id.value=item?.id||"";form.elements.name.value=item?.name||"";form.elements.category.value=item?.category||"";form.elements.price.value=item?.price||"";form.elements.image_url.value=item?.image_url||"";form.elements.description.value=item?.description||"";form.elements.is_available.checked=item?item.is_available:true;form.elements.is_vegetarian.checked=item?item.is_vegetarian:false;$("#editor-title").textContent=item?"Edit menu item":"Add menu item";$("#item-editor").hidden=false;$("#item-editor").scrollIntoView({behavior:"smooth",block:"start"});
  }
  $("#add-item").addEventListener("click",()=>editor());$("#cancel-editor").addEventListener("click",()=>$("#item-editor").hidden=true);
  $("#menu-admin-list").addEventListener("click",async e=>{
    const edit=e.target.closest("[data-edit]");if(edit){editor(menu.find(i=>i.id===edit.dataset.edit));return;}
    const toggle=e.target.closest("[data-toggle]");if(toggle){const item=menu.find(i=>i.id===toggle.dataset.toggle);const {error}=await db.from("menu_items").update({is_available:!item.is_available}).eq("id",item.id);if(error)toast("Could not update availability.");else{toast("Availability updated.");loadMenu();}}
  });
  $("#item-form").addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);const id=f.get("id");const item={name:String(f.get("name")).trim(),category:String(f.get("category")).trim(),price:Number(f.get("price")),image_url:String(f.get("image_url")||"").trim()||null,description:String(f.get("description")||"").trim(),is_available:f.get("is_available")==="on",is_vegetarian:f.get("is_vegetarian")==="on"};
    if(!Number.isFinite(item.price)||item.price<=0){$("#item-error").textContent="Enter a valid price.";return;}
    const q=id?db.from("menu_items").update(item).eq("id",id):db.from("menu_items").insert(item);const {error}=await q;
    if(error){$("#item-error").textContent="Save failed. Check your admin permissions and fields.";return;}$("#item-editor").hidden=true;toast("Menu item saved.");loadMenu();
  });
  async function loadSettings(){
    const {data,error}=await db.from("restaurant_settings").select("*").eq("id",1).maybeSingle();if(error||!data)return;const f=$("#settings-form");for(const k of ["name","location","phone","hours","delivery_fee","minimum_order"])f.elements[k].value=data[k]??"";f.elements.accepting_orders.checked=!!data.accepting_orders;
  }
  $("#settings-form").addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);const row={id:1,name:String(f.get("name")).trim(),location:String(f.get("location")||"").trim(),phone:String(f.get("phone")||"").trim(),hours:String(f.get("hours")||"").trim(),delivery_fee:Number(f.get("delivery_fee")),minimum_order:Number(f.get("minimum_order")),accepting_orders:f.get("accepting_orders")==="on"};
    const {error}=await db.from("restaurant_settings").upsert(row);if(error){$("#settings-error").textContent="Could not save settings.";return;}toast("Restaurant settings saved.");
  });
  document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll(".admin-tab").forEach(x=>x.hidden=x.id!==`${b.dataset.tab}-tab`);}));
  db.auth.onAuthStateChange((_event,session)=>{if(!session){$("#login-panel").hidden=false;$("#dashboard").hidden=true;}});
  requireAdmin().then(ok=>{if(ok){loadOrders();loadMenu();loadSettings();}});
})();
