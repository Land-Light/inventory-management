create table if not exists inventory_rooms (
  id text primary key,
  created_at timestamptz not null default now()
);

alter table inventory_rooms
add column if not exists created_at timestamptz not null default now();

create table if not exists inventory_products (
  room_id text not null references inventory_rooms(id) on delete cascade,
  jan text not null,
  name text not null,
  expected integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (room_id, jan)
);

create table if not exists inventory_count_entries (
  id text primary key,
  room_id text not null references inventory_rooms(id) on delete cascade,
  device_id text not null,
  user_name text not null,
  jan text not null,
  shelf_no text not null check (length(trim(shelf_no)) between 1 and 20),
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_products_room_id_idx
on inventory_products(room_id);

create index if not exists inventory_count_entries_room_id_idx
on inventory_count_entries(room_id);

create index if not exists inventory_count_entries_room_jan_idx
on inventory_count_entries(room_id, jan);

alter table inventory_rooms enable row level security;
alter table inventory_products enable row level security;
alter table inventory_count_entries enable row level security;

drop policy if exists "inventory rooms are readable" on inventory_rooms;
drop policy if exists "inventory rooms can be created" on inventory_rooms;
drop policy if exists "inventory rooms can be updated" on inventory_rooms;
drop policy if exists "inventory rooms can be deleted" on inventory_rooms;
drop policy if exists "inventory products are readable" on inventory_products;
drop policy if exists "inventory products can be created" on inventory_products;
drop policy if exists "inventory products can be updated" on inventory_products;
drop policy if exists "inventory products can be deleted" on inventory_products;
drop policy if exists "inventory count entries are readable" on inventory_count_entries;
drop policy if exists "inventory count entries can be created" on inventory_count_entries;
drop policy if exists "inventory count entries can be updated" on inventory_count_entries;
drop policy if exists "inventory count entries can be deleted" on inventory_count_entries;

create policy "inventory rooms are readable"
on inventory_rooms for select
to anon
using (true);

create policy "inventory rooms can be created"
on inventory_rooms for insert
to anon
with check (true);

create policy "inventory rooms can be updated"
on inventory_rooms for update
to anon
using (true)
with check (true);

create policy "inventory rooms can be deleted"
on inventory_rooms for delete
to anon
using (true);

create policy "inventory products are readable"
on inventory_products for select
to anon
using (true);

create policy "inventory products can be created"
on inventory_products for insert
to anon
with check (true);

create policy "inventory products can be updated"
on inventory_products for update
to anon
using (true)
with check (true);

create policy "inventory products can be deleted"
on inventory_products for delete
to anon
using (true);

create policy "inventory count entries are readable"
on inventory_count_entries for select
to anon
using (true);

create policy "inventory count entries can be created"
on inventory_count_entries for insert
to anon
with check (true);

create policy "inventory count entries can be updated"
on inventory_count_entries for update
to anon
using (true)
with check (true);

create policy "inventory count entries can be deleted"
on inventory_count_entries for delete
to anon
using (true);

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table inventory_rooms to anon, authenticated;
grant select, insert, update, delete on table inventory_products to anon, authenticated;
grant select, insert, update, delete on table inventory_count_entries to anon, authenticated;
