-- TradeV schema for Supabase (Postgres 15+)
-- Run this once in the Supabase SQL editor (or `supabase db push`).
--
-- Security model: the browser NEVER talks to Supabase directly. Only the TradeV
-- server talks to Supabase, using the service_role (secret) key. Row Level
-- Security is enabled on every table with no policies, so the public anon key
-- cannot read or write anything, and all money-moving functions are executable
-- by service_role only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  id              bigint generated always as identity primary key,
  email           text not null unique,
  name            text not null default '',
  password_hash   text not null,
  role            text not null default 'customer' check (role in ('customer','admin')),
  balance         numeric(18,2) not null default 0 check (balance >= 0),
  status          text not null default 'active' check (status in ('active','suspended')),
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz
);

create table if not exists public.markets (
  id            bigint generated always as identity primary key,
  symbol        text not null unique,              -- e.g. BTC/USDT
  name          text not null default '',
  base          text not null,
  quote         text not null default 'USDT',
  price         numeric not null check (price > 0),
  volatility    numeric not null default 0.0008,   -- per-second sigma of log returns
  drift         numeric not null default 0,        -- per-second trend bias (e.g. 0.00002)
  max_leverage  int not null default 50 check (max_leverage between 1 and 200),
  fee_rate      numeric not null default 0.0005 check (fee_rate >= 0 and fee_rate < 0.1),
  min_margin    numeric(18,2) not null default 1,
  decimals      int not null default 2 check (decimals between 0 and 8),
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.candles (
  market_id  bigint not null references public.markets(id) on delete cascade,
  ts         timestamptz not null,                 -- start of the 1-minute bucket
  o numeric not null, h numeric not null, l numeric not null, c numeric not null,
  v numeric not null default 0,
  primary key (market_id, ts)
);

create table if not exists public.orders (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references public.app_users(id) on delete cascade,
  market_id     bigint not null references public.markets(id),
  side          text not null check (side in ('long','short')),
  type          text not null check (type in ('market','limit')),
  margin        numeric(18,2) not null check (margin > 0),
  leverage      int not null check (leverage >= 1),
  size          numeric,                            -- units of base asset, set when filled
  entry_price   numeric,
  limit_price   numeric,
  tp            numeric,
  sl            numeric,
  liq_price     numeric,
  fee           numeric(18,2) not null default 0,
  status        text not null default 'pending' check (status in ('pending','open','closed','cancelled')),
  exit_price    numeric,
  pnl           numeric(18,2),
  result        text check (result in ('win','lose','even')),
  close_reason  text check (close_reason in ('manual','tp','sl','liquidation','admin')),
  created_at    timestamptz not null default now(),
  opened_at     timestamptz,
  closed_at     timestamptz
);
create index if not exists orders_user_idx   on public.orders(user_id, created_at desc);
create index if not exists orders_status_idx on public.orders(status);

create table if not exists public.transactions (
  id             bigint generated always as identity primary key,
  user_id        bigint not null references public.app_users(id) on delete cascade,
  type           text not null check (type in ('deposit','withdrawal','bonus','trade_margin','trade_fee','trade_settle','order_refund','adjustment')),
  amount         numeric(18,2) not null,            -- signed effect on balance
  balance_after  numeric(18,2),
  status         text not null default 'completed' check (status in ('pending','completed','rejected')),
  order_id       bigint references public.orders(id) on delete set null,
  note           text,
  processed_by   bigint references public.app_users(id),
  processed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists tx_user_idx   on public.transactions(user_id, created_at desc);
create index if not exists tx_status_idx on public.transactions(status);

-- ---------------------------------------------------------------------------
-- Views (joined data for listings)
-- ---------------------------------------------------------------------------
create or replace view public.orders_view with (security_invoker = on) as
  select o.*, m.symbol, m.decimals, u.email as user_email, u.name as user_name
  from public.orders o
  join public.markets m on m.id = o.market_id
  join public.app_users u on u.id = o.user_id;

create or replace view public.transactions_view with (security_invoker = on) as
  select t.*, u.email as user_email, u.name as user_name
  from public.transactions t
  join public.app_users u on u.id = t.user_id;

create or replace view public.users_view with (security_invoker = on) as
  select u.id, u.email, u.name, u.role, u.balance, u.status, u.created_at, u.last_login_at,
         coalesce(s.trades, 0)  as trades,
         coalesce(s.wins, 0)    as wins,
         coalesce(s.losses, 0)  as losses,
         coalesce(s.total_pnl, 0) as total_pnl,
         coalesce(s.open_positions, 0) as open_positions
  from public.app_users u
  left join (
    select user_id,
           count(*) filter (where status = 'closed')                   as trades,
           count(*) filter (where result = 'win')                      as wins,
           count(*) filter (where result = 'lose')                     as losses,
           sum(pnl) filter (where status = 'closed')                   as total_pnl,
           count(*) filter (where status = 'open')                     as open_positions
    from public.orders group by user_id
  ) s on s.user_id = u.id;

-- ---------------------------------------------------------------------------
-- Lock everything down: RLS on, no policies => anon/authenticated get nothing.
-- ---------------------------------------------------------------------------
alter table public.app_users    enable row level security;
alter table public.markets      enable row level security;
alter table public.candles      enable row level security;
alter table public.orders       enable row level security;
alter table public.transactions enable row level security;

revoke all on public.app_users, public.markets, public.candles, public.orders, public.transactions,
              public.orders_view, public.transactions_view, public.users_view
  from anon, authenticated;
grant all on public.app_users, public.markets, public.candles, public.orders, public.transactions,
             public.orders_view, public.transactions_view, public.users_view
  to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._tx(p_user bigint, p_type text, p_amount numeric, p_order bigint,
                                      p_note text, p_status text default 'completed', p_by bigint default null)
returns bigint language plpgsql as $$
declare v_bal numeric; v_id bigint;
begin
  select balance into v_bal from public.app_users where id = p_user;
  insert into public.transactions(user_id, type, amount, balance_after, status, order_id, note, processed_by,
                                  processed_at)
  values (p_user, p_type, round(p_amount, 2), v_bal, p_status, p_order, p_note, p_by,
          case when p_status = 'pending' then null else now() end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public._order_json(p_id bigint) returns jsonb language sql stable as $$
  select to_jsonb(v) from public.orders_view v where v.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create or replace function public.create_user(p_email text, p_name text, p_password_hash text,
                                              p_role text default 'customer', p_start_balance numeric default 0)
returns jsonb language plpgsql as $$
declare v_id bigint;
begin
  if exists (select 1 from public.app_users where lower(email) = lower(p_email)) then
    raise exception 'EMAIL_TAKEN';
  end if;
  insert into public.app_users(email, name, password_hash, role, balance)
  values (lower(p_email), coalesce(p_name, ''), p_password_hash, coalesce(p_role, 'customer'),
          greatest(coalesce(p_start_balance, 0), 0))
  returning id into v_id;
  if coalesce(p_start_balance, 0) > 0 then
    perform public._tx(v_id, 'bonus', p_start_balance, null, 'Welcome demo balance');
  end if;
  return (select to_jsonb(u) - 'password_hash' from public.app_users u where id = v_id);
end $$;

create or replace function public.admin_adjust_balance(p_user bigint, p_amount numeric, p_note text, p_admin bigint)
returns jsonb language plpgsql as $$
declare v_bal numeric;
begin
  select balance into v_bal from public.app_users where id = p_user for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_bal + p_amount < 0 then raise exception 'INSUFFICIENT_BALANCE'; end if;
  update public.app_users set balance = balance + round(p_amount, 2) where id = p_user;
  perform public._tx(p_user, 'adjustment', p_amount, null, coalesce(p_note, 'Admin adjustment'), 'completed', p_admin);
  return (select to_jsonb(u) - 'password_hash' from public.app_users u where id = p_user);
end $$;

-- ---------------------------------------------------------------------------
-- Wallet: deposits need admin approval; withdrawals hold funds until processed.
-- ---------------------------------------------------------------------------
create or replace function public.request_deposit(p_user bigint, p_amount numeric, p_note text default null)
returns jsonb language plpgsql as $$
declare v_id bigint;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  perform 1 from public.app_users where id = p_user and status = 'active';
  if not found then raise exception 'ACCOUNT_INACTIVE'; end if;
  v_id := public._tx(p_user, 'deposit', p_amount, null, coalesce(p_note, 'Deposit request'), 'pending');
  return (select to_jsonb(t) from public.transactions t where id = v_id);
end $$;

create or replace function public.request_withdrawal(p_user bigint, p_amount numeric, p_note text default null)
returns jsonb language plpgsql as $$
declare v_bal numeric; v_status text; v_id bigint;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  select balance, status into v_bal, v_status from public.app_users where id = p_user for update;
  if v_status <> 'active' then raise exception 'ACCOUNT_INACTIVE'; end if;
  if v_bal < p_amount then raise exception 'INSUFFICIENT_BALANCE'; end if;
  update public.app_users set balance = balance - round(p_amount, 2) where id = p_user;
  v_id := public._tx(p_user, 'withdrawal', -p_amount, null, coalesce(p_note, 'Withdrawal request'), 'pending');
  return (select to_jsonb(t) from public.transactions t where id = v_id);
end $$;

create or replace function public.process_transaction(p_tx bigint, p_approve boolean, p_admin bigint, p_note text default null)
returns jsonb language plpgsql as $$
declare t public.transactions;
begin
  select * into t from public.transactions where id = p_tx for update;
  if not found then raise exception 'TX_NOT_FOUND'; end if;
  if t.status <> 'pending' then raise exception 'TX_NOT_PENDING'; end if;
  perform 1 from public.app_users where id = t.user_id for update;

  if t.type = 'deposit' and p_approve then
    update public.app_users set balance = balance + t.amount where id = t.user_id;
  elsif t.type = 'withdrawal' and not p_approve then
    update public.app_users set balance = balance - t.amount where id = t.user_id;  -- amount is negative: refund
  end if;

  update public.transactions
     set status = case when p_approve then 'completed' else 'rejected' end,
         processed_by = p_admin, processed_at = now(),
         balance_after = (select balance from public.app_users where id = t.user_id),
         note = coalesce(p_note, note)
   where id = p_tx;
  return (select to_jsonb(v) from public.transactions_view v where id = p_tx);
end $$;

-- ---------------------------------------------------------------------------
-- Trading
-- PnL model (linear perpetual): size = margin * leverage / entry
--   pnl = (exit - entry) * size   for long,  (entry - exit) * size for short
--   loss is capped at the margin (liquidation).
-- ---------------------------------------------------------------------------
create or replace function public._liq_price(p_side text, p_entry numeric, p_leverage int) returns numeric
language sql immutable as $$
  select case when p_side = 'long' then p_entry * (1 - 1.0 / p_leverage)
              else p_entry * (1 + 1.0 / p_leverage) end
$$;

create or replace function public.place_order(p_user bigint, p_market bigint, p_side text, p_type text,
                                              p_margin numeric, p_leverage int, p_exec_price numeric,
                                              p_limit_price numeric default null,
                                              p_tp numeric default null, p_sl numeric default null)
returns jsonb language plpgsql as $$
declare u public.app_users; m public.markets; v_fee numeric; v_id bigint; v_entry numeric;
begin
  select * into u from public.app_users where id = p_user for update;
  if not found or u.status <> 'active' then raise exception 'ACCOUNT_INACTIVE'; end if;
  select * into m from public.markets where id = p_market;
  if not found or not m.enabled then raise exception 'MARKET_CLOSED'; end if;
  if p_side not in ('long','short') then raise exception 'INVALID_SIDE'; end if;
  if p_type not in ('market','limit') then raise exception 'INVALID_TYPE'; end if;
  if p_margin is null or p_margin < m.min_margin then raise exception 'MARGIN_TOO_SMALL'; end if;
  if p_leverage is null or p_leverage < 1 or p_leverage > m.max_leverage then raise exception 'INVALID_LEVERAGE'; end if;
  if p_type = 'limit' and (p_limit_price is null or p_limit_price <= 0) then raise exception 'INVALID_LIMIT_PRICE'; end if;

  v_entry := case when p_type = 'market' then p_exec_price else p_limit_price end;
  if v_entry is null or v_entry <= 0 then raise exception 'INVALID_PRICE'; end if;
  if p_side = 'long' then
    if p_tp is not null and p_tp <= v_entry then raise exception 'TP_MUST_BE_ABOVE_ENTRY'; end if;
    if p_sl is not null and p_sl >= v_entry then raise exception 'SL_MUST_BE_BELOW_ENTRY'; end if;
  else
    if p_tp is not null and p_tp >= v_entry then raise exception 'TP_MUST_BE_BELOW_ENTRY'; end if;
    if p_sl is not null and p_sl <= v_entry then raise exception 'SL_MUST_BE_ABOVE_ENTRY'; end if;
  end if;

  v_fee := round(p_margin * p_leverage * m.fee_rate, 2);
  if u.balance < p_margin + v_fee then raise exception 'INSUFFICIENT_BALANCE'; end if;

  update public.app_users set balance = balance - round(p_margin, 2) - v_fee where id = p_user;

  if p_type = 'market' then
    insert into public.orders(user_id, market_id, side, type, margin, leverage, size, entry_price, tp, sl,
                              liq_price, fee, status, opened_at)
    values (p_user, p_market, p_side, 'market', round(p_margin, 2), p_leverage, p_margin * p_leverage / p_exec_price,
            p_exec_price, p_tp, p_sl, public._liq_price(p_side, p_exec_price, p_leverage), v_fee, 'open', now())
    returning id into v_id;
  else
    insert into public.orders(user_id, market_id, side, type, margin, leverage, limit_price, tp, sl, fee, status)
    values (p_user, p_market, p_side, 'limit', round(p_margin, 2), p_leverage, p_limit_price, p_tp, p_sl, v_fee, 'pending')
    returning id into v_id;
  end if;

  update public.app_users set balance = balance + v_fee where id = p_user;          -- record margin first,
  perform public._tx(p_user, 'trade_margin', -p_margin, v_id, 'Margin for order #' || v_id);
  update public.app_users set balance = balance - v_fee where id = p_user;          -- then the fee,
  perform public._tx(p_user, 'trade_fee', -v_fee, v_id, 'Trading fee for order #' || v_id);  -- so balance_after is exact
  return public._order_json(v_id);
end $$;

create or replace function public.fill_limit_order(p_order bigint, p_price numeric)
returns jsonb language plpgsql as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.status <> 'pending' then return null; end if;
  update public.orders
     set status = 'open', entry_price = p_price, opened_at = now(),
         size = o.margin * o.leverage / p_price,
         liq_price = public._liq_price(o.side, p_price, o.leverage)
   where id = p_order;
  return public._order_json(p_order);
end $$;

create or replace function public.close_order(p_order bigint, p_price numeric, p_reason text, p_user bigint default null)
returns jsonb language plpgsql as $$
declare o public.orders; v_pnl numeric; v_payout numeric; v_result text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if p_user is not null and o.user_id <> p_user then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'open' then raise exception 'ORDER_NOT_OPEN'; end if;
  if p_price is null or p_price <= 0 then raise exception 'INVALID_PRICE'; end if;

  v_pnl := case when o.side = 'long' then (p_price - o.entry_price) * o.size
                else (o.entry_price - p_price) * o.size end;
  v_pnl := round(greatest(v_pnl, -o.margin), 2);
  v_payout := o.margin + v_pnl;
  v_result := case when v_pnl - o.fee > 0 then 'win' when v_pnl - o.fee < 0 then 'lose' else 'even' end;

  update public.orders
     set status = 'closed', exit_price = p_price, pnl = v_pnl, result = v_result,
         close_reason = p_reason, closed_at = now()
   where id = p_order;

  perform 1 from public.app_users where id = o.user_id for update;
  update public.app_users set balance = balance + v_payout where id = o.user_id;
  perform public._tx(o.user_id, 'trade_settle', v_payout, p_order,
                     'Settlement order #' || p_order || ' (' || p_reason || ', PnL ' || v_pnl || ')');
  return public._order_json(p_order);
end $$;

create or replace function public.cancel_order(p_order bigint, p_user bigint default null)
returns jsonb language plpgsql as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or (p_user is not null and o.user_id <> p_user) then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;
  update public.orders set status = 'cancelled', closed_at = now() where id = p_order;
  perform 1 from public.app_users where id = o.user_id for update;
  update public.app_users set balance = balance + o.margin + o.fee where id = o.user_id;
  perform public._tx(o.user_id, 'order_refund', o.margin + o.fee, p_order, 'Cancelled order #' || p_order);
  return public._order_json(p_order);
end $$;

-- ---------------------------------------------------------------------------
-- Admin dashboard
-- ---------------------------------------------------------------------------
create or replace function public.admin_stats() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'customers',          (select count(*) from public.app_users where role = 'customer'),
    'active_customers',   (select count(*) from public.app_users where role = 'customer' and status = 'active'),
    'customer_balances',  (select coalesce(sum(balance), 0) from public.app_users where role = 'customer'),
    'open_positions',     (select count(*) from public.orders where status = 'open'),
    'pending_orders',     (select count(*) from public.orders where status = 'pending'),
    'open_margin',        (select coalesce(sum(margin), 0) from public.orders where status = 'open'),
    'closed_trades',      (select count(*) from public.orders where status = 'closed'),
    'wins',               (select count(*) from public.orders where result = 'win'),
    'losses',             (select count(*) from public.orders where result = 'lose'),
    'customer_pnl',       (select coalesce(sum(pnl), 0) from public.orders where status = 'closed'),
    'fees',               (select coalesce(sum(fee), 0) from public.orders where status in ('open','closed')),
    'volume',             (select coalesce(sum(margin * leverage), 0) from public.orders where status in ('open','closed')),
    'pending_deposits',   (select count(*) from public.transactions where type = 'deposit' and status = 'pending'),
    'pending_withdrawals',(select count(*) from public.transactions where type = 'withdrawal' and status = 'pending'),
    'markets',            (select count(*) from public.markets),
    'by_market', (select coalesce(jsonb_agg(x order by x.volume desc), '[]'::jsonb) from (
        select m.symbol, count(o.id) as trades,
               coalesce(sum(o.margin * o.leverage), 0) as volume,
               count(*) filter (where o.result = 'win')  as wins,
               count(*) filter (where o.result = 'lose') as losses,
               coalesce(sum(o.pnl), 0) as customer_pnl
        from public.markets m left join public.orders o on o.market_id = m.id and o.status in ('open','closed')
        group by m.symbol) x)
  )
$$;

-- Only the server (service_role) may call these.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in
             ('_tx','_order_json','_liq_price','create_user','admin_adjust_balance','request_deposit',
              'request_withdrawal','process_transaction','place_order','fill_limit_order','close_order',
              'cancel_order','admin_stats')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Seed markets
-- ---------------------------------------------------------------------------
insert into public.markets(symbol, name, base, quote, price, volatility, max_leverage, fee_rate, decimals) values
  ('BTC/USDT', 'Bitcoin',      'BTC', 'USDT', 70320,   0.0003, 100, 0.0005, 1),
  ('ETH/USDT', 'Ethereum',     'ETH', 'USDT', 3450,    0.0004, 100, 0.0005, 2),
  ('SOL/USDT', 'Solana',       'SOL', 'USDT', 165.4,   0.0006, 50,  0.0006, 3),
  ('BNB/USDT', 'BNB',          'BNB', 'USDT', 612.5,   0.0004, 50,  0.0006, 2),
  ('XAU/USD',  'Gold',         'XAU', 'USD',  2650,    0.00015, 100, 0.0004, 2),
  ('EUR/USD',  'Euro / Dollar','EUR', 'USD',  1.0842,  0.0001, 200, 0.0002, 5)
on conflict (symbol) do nothing;
