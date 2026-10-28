-- Swad Sangam database schema. Run in Supabase SQL Editor.
-- IMPORTANT: Do not enable public write access. Admin actions require authenticated user_id in admin_users.
create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_settings (
  id integer primary key default 1 check (id = 1),
  name text not null default 'Swad Sangam',
  location text not null default 'Bihar, India',
  phone text not null default '',
  hours text not null default '',
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  minimum_order numeric(10,2) not null default 0 check (minimum_order >= 0),
  accepting_orders boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.restaurant_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '',
  category text not null check (char_length(category) between 1 and 60),
  price numeric(10,2) not null check (price > 0 and price <= 100000),
  image_url text,
  is_available boolean not null default true,
  is_vegetarian boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null check (char_length(customer_name) between 1 and 100),
  phone text not null check (char_length(phone) between 8 and 20),
  address text not null default '',
  fulfillment text not null check (fulfillment in ('delivery','pickup')),
  notes text not null default '',
  payment_method text not null check (payment_method in ('cod','online')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  status text not null default 'placed' check (status in ('placed','accepted','preparing','ready','delivered','cancelled')),
  subtotal numeric(10,2) not null check (subtotal >= 0),
  delivery_fee numeric(10,2) not null check (delivery_fee >= 0),
  total_amount numeric(10,2) not null check (total_amount >= 0),
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  item_name text not null,
  unit_price numeric(10,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity between 1 and 50),
  line_total numeric(10,2) not null check (line_total >= 0)
);

create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists menu_items_category_idx on public.menu_items(category);

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.admin_users enable row level security;
alter table public.restaurant_settings enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Admin can inspect the allowlist only for their own user id.
drop policy if exists "admin_users read own row" on public.admin_users;
create policy "admin_users read own row" on public.admin_users for select to authenticated using (user_id = auth.uid());

drop policy if exists "public read restaurant settings" on public.restaurant_settings;
create policy "public read restaurant settings" on public.restaurant_settings for select to anon, authenticated using (true);
drop policy if exists "admin manage restaurant settings" on public.restaurant_settings;
create policy "admin manage restaurant settings" on public.restaurant_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "public read available menu" on public.menu_items;
create policy "public read available menu" on public.menu_items for select to anon, authenticated using (is_available = true or public.is_admin());
drop policy if exists "admin manage menu" on public.menu_items;
create policy "admin manage menu" on public.menu_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin manage orders" on public.orders;
create policy "admin manage orders" on public.orders for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin manage order items" on public.order_items;
create policy "admin manage order items" on public.order_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- The anonymous client cannot insert or read orders directly. Edge Functions use the service role key
-- only server-side, validate all prices from menu_items, and create/read order rows.
revoke insert, update, delete on public.orders from anon, authenticated;
revoke select on public.orders from anon;
revoke insert, update, delete on public.order_items from anon, authenticated;
revoke select on public.order_items from anon;

grant select on public.restaurant_settings to anon, authenticated;
grant select on public.menu_items to anon, authenticated;
grant select, insert, update, delete on public.menu_items to authenticated;
grant select, insert, update, delete on public.restaurant_settings to authenticated;
grant select on public.admin_users to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;

-- Optional starter items. Edit or remove them in the owner dashboard.
insert into public.menu_items (name,description,category,price,image_url,is_vegetarian) values
('Paneer Tikka','Smoky paneer with spices and chutney.','Starters',229,'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?auto=format&fit=crop&w=700&q=80',true),
('Veg Biryani','Fragrant rice, vegetables and aromatic spices.','Main Course',199,'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=700&q=80',true),
('Butter Naan','Soft tandoor naan brushed with butter.','Breads',45,'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=700&q=80',true),
('Dal Tadka','Comforting yellow lentils tempered with spices.','Main Course',149,'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=700&q=80',true)
on conflict do nothing;
