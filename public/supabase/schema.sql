-- 予約分析ダッシュボード 新スキーマ
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。

create extension if not exists pgcrypto;

-- 店舗マスタ ---------------------------------------------------------------
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  brand text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- CSVファイル名 / CSV内の表記ゆれ → 店舗を紐付けるための学習テーブル
create table if not exists public.store_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null unique,
  store_id uuid not null references public.stores(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 予約経路マスタ -------------------------------------------------------------
create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  excluded_by_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- CSVの「予約経路」表記ゆれ → 経路マスタを紐付ける学習テーブル
create table if not exists public.route_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null unique,
  route_id uuid not null references public.routes(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 未振り分けの経路がひとつに集まるよう、「未分類」ルートを用意
insert into public.routes (name, sort_order, excluded_by_default)
values ('未分類', 999, false)
on conflict (name) do nothing;

-- 予約データ本体（1予約 = 1行） --------------------------------------------
create table if not exists public.reservations (
  id bigserial primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  route_id uuid not null references public.routes(id),
  raw_route_text text,
  reservation_no text,
  customer_name text,
  reserved_at timestamptz,
  visit_date date not null,
  visit_time time,
  treatment_start time,
  treatment_end time,
  fee numeric not null default 0,
  staff_name text,
  nominated boolean not null default false,
  gender text,
  menu_text text,
  source_file text,
  source_month text, -- ファイル名から推定した対象月 (YYYY-MM)。visit_dateが空のCSV行の救済用
  imported_at timestamptz not null default now(),
  unique (store_id, reservation_no)
);

create index if not exists idx_reservations_store_date on public.reservations (store_id, visit_date);
create index if not exists idx_reservations_route_date on public.reservations (route_id, visit_date);
create index if not exists idx_reservations_visit_date on public.reservations (visit_date);

-- RLS: このアプリはサーバー側 (service role key) からのみ読み書きする想定
alter table public.stores enable row level security;
alter table public.store_aliases enable row level security;
alter table public.routes enable row level security;
alter table public.route_aliases enable row level security;
alter table public.reservations enable row level security;

drop policy if exists "deny_all_stores" on public.stores;
create policy "deny_all_stores" on public.stores for all to public using (false) with check (false);
drop policy if exists "deny_all_store_aliases" on public.store_aliases;
create policy "deny_all_store_aliases" on public.store_aliases for all to public using (false) with check (false);
drop policy if exists "deny_all_routes" on public.routes;
create policy "deny_all_routes" on public.routes for all to public using (false) with check (false);
drop policy if exists "deny_all_route_aliases" on public.route_aliases;
create policy "deny_all_route_aliases" on public.route_aliases for all to public using (false) with check (false);
drop policy if exists "deny_all_reservations" on public.reservations;
create policy "deny_all_reservations" on public.reservations for all to public using (false) with check (false);

-- 集計RPC: 店舗×経路×月 で件数・売上を集計して返す ---------------------------
create or replace function public.monthly_summary(
  p_store_ids uuid[] default null,
  p_date_from date default null,
  p_date_to date default null
)
returns table (
  store_id uuid,
  store_name text,
  route_id uuid,
  route_name text,
  month text,
  cnt bigint,
  sales numeric
)
language sql
stable
as $$
  select
    r.store_id,
    s.name as store_name,
    r.route_id,
    rt.name as route_name,
    to_char(r.visit_date, 'YYYY-MM') as month,
    count(*) as cnt,
    coalesce(sum(r.fee), 0) as sales
  from public.reservations r
  join public.stores s on s.id = r.store_id
  join public.routes rt on rt.id = r.route_id
  where (p_store_ids is null or r.store_id = any(p_store_ids))
    and (p_date_from is null or r.visit_date >= p_date_from)
    and (p_date_to is null or r.visit_date <= p_date_to)
  group by r.store_id, s.name, r.route_id, rt.name, to_char(r.visit_date, 'YYYY-MM')
$$;

-- 初期の経路マスタ（OLIVE SPAの実データで確認済みの7種類 + 未分類）
insert into public.routes (name, sort_order) values
  ('電話予約', 1),
  ('LINEミニアプリ', 2),
  ('Hot Pepper Beauty Kirei Salon', 3),
  ('Web予約', 4),
  ('Web予約(英語)', 5),
  ('Google', 6),
  ('次回予約', 7)
on conflict (name) do nothing;
