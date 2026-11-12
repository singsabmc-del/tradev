-- TradeV 002: serverless (Vercel) support. Run after 001_init.sql.
--
-- On Vercel there is no always-running process, so the market engine is "catch-up":
-- every request advances a market from markets.last_tick_at to now, simulating the
-- missed seconds and settling any TP / SL / liquidation / limit fill that happened
-- in between at its trigger price and time. apply_tick() commits one advance
-- atomically and uses last_tick_at as an optimistic lock, so concurrent function
-- instances can never double-apply a tick or double-settle an order.

alter table public.markets add column if not exists last_tick_at timestamptz not null default now();

-- small key/value store for background-job claims and status (e.g. Google Sheets sync)
create table if not exists public.app_state (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default 'epoch'
);

-- login throttling that works across serverless instances
create table if not exists public.login_failures (
  id   bigint generated always as identity primary key,
  key  text not null,
  at   timestamptz not null default now()
);
create index if not exists login_failures_key_idx on public.login_failures(key, at);

alter table public.app_state      enable row level security;
alter table public.login_failures enable row level security;
revoke all on public.app_state, public.login_failures from anon, authenticated;
grant all on public.app_state, public.login_failures to service_role;

-- 24h market statistics from candles
create or replace view public.market_stats_24h with (security_invoker = on) as
  select market_id,
         (array_agg(o order by ts))[1] as open24h,
         max(h) as high24h,
         min(l) as low24h,
         sum(v) as volume24h
  from public.candles
  where ts >= now() - interval '24 hours'
  group by market_id;
revoke all on public.market_stats_24h from anon, authenticated;
grant select on public.market_stats_24h to service_role;

-- ---------------------------------------------------------------------------
-- fill / close now accept the time the trigger actually happened
-- ---------------------------------------------------------------------------
drop function if exists public.fill_limit_order(bigint, numeric);
create or replace function public.fill_limit_order(p_order bigint, p_price numeric, p_at timestamptz default now())
returns jsonb language plpgsql as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.status <> 'pending' then return null; end if;
  update public.orders
     set status = 'open', entry_price = p_price, opened_at = coalesce(p_at, now()),
         size = o.margin * o.leverage / p_price,
         liq_price = public._liq_price(o.side, p_price, o.leverage)
   where id = p_order;
  return public._order_json(p_order);
end $$;

drop function if exists public.close_order(bigint, numeric, text, bigint);
create or replace function public.close_order(p_order bigint, p_price numeric, p_reason text,
                                              p_user bigint default null, p_at timestamptz default now())
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
         close_reason = p_reason, closed_at = greatest(coalesce(p_at, now()), o.opened_at)
   where id = p_order;

  perform 1 from public.app_users where id = o.user_id for update;
  update public.app_users set balance = balance + v_payout where id = o.user_id;
  perform public._tx(o.user_id, 'trade_settle', v_payout, p_order,
                     'Settlement order #' || p_order || ' (' || p_reason || ', PnL ' || v_pnl || ')');
  return public._order_json(p_order);
end $$;

-- ---------------------------------------------------------------------------
-- apply_tick: commit one market advance atomically (optimistic lock on last_tick_at)
--   p_candles: [{ts, o, h, l, c, v}]          upserted
--   p_events:  [{type:'fill'|'close', order_id, price, reason, at}]  applied in order
-- ---------------------------------------------------------------------------
create or replace function public.apply_tick(p_market bigint, p_expected timestamptz, p_new_at timestamptz,
                                             p_price numeric, p_candles jsonb, p_events jsonb)
returns jsonb language plpgsql as $$
declare v_rows int; ev jsonb; res jsonb; v_out jsonb := '[]'::jsonb;
begin
  update public.markets
     set price = p_price, last_tick_at = p_new_at
   where id = p_market and last_tick_at = p_expected and enabled;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok', false); end if;

  insert into public.candles(market_id, ts, o, h, l, c, v)
  select p_market, (x->>'ts')::timestamptz, (x->>'o')::numeric, (x->>'h')::numeric,
         (x->>'l')::numeric, (x->>'c')::numeric, coalesce((x->>'v')::numeric, 0)
  from jsonb_array_elements(coalesce(p_candles, '[]'::jsonb)) x
  on conflict (market_id, ts) do update
     set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v;

  for ev in select * from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) loop
    begin
      if ev->>'type' = 'fill' then
        res := public.fill_limit_order((ev->>'order_id')::bigint, (ev->>'price')::numeric, (ev->>'at')::timestamptz);
      else
        res := public.close_order((ev->>'order_id')::bigint, (ev->>'price')::numeric, ev->>'reason',
                                  null, (ev->>'at')::timestamptz);
      end if;
      if res is not null then v_out := v_out || jsonb_build_array(res); end if;
    exception when others then
      null; -- order already changed by someone else (e.g. closed manually): skip
    end;
  end loop;
  return jsonb_build_object('ok', true, 'orders', v_out);
end $$;

-- Admin moved the price: re-anchor the simulation at "now"
create or replace function public.set_market_price(p_market bigint, p_price numeric)
returns void language sql as $$
  update public.markets set price = p_price, last_tick_at = now(), updated_at = now() where id = p_market
$$;

-- ---------------------------------------------------------------------------
-- background jobs & throttling
-- ---------------------------------------------------------------------------
-- Returns true for exactly one caller per interval (across all instances).
create or replace function public.claim_job(p_key text, p_seconds numeric)
returns boolean language plpgsql as $$
declare v_claimed int;
begin
  with c as (
    insert into public.app_state(key, updated_at) values (p_key, now())
    on conflict (key) do update set updated_at = now()
      where public.app_state.updated_at < now() - make_interval(secs => p_seconds)
    returning 1
  ) select count(*) into v_claimed from c;
  return v_claimed > 0;
end $$;

create or replace function public.set_state(p_key text, p_value jsonb)
returns void language sql as $$
  insert into public.app_state(key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value
$$;

create or replace function public.note_login_failure(p_key text)
returns int language plpgsql as $$
declare n int;
begin
  insert into public.login_failures(key) values (p_key);
  delete from public.login_failures where at < now() - interval '1 day';
  select count(*) into n from public.login_failures where key = p_key and at > now() - interval '15 minutes';
  return n;
end $$;

create or replace function public.login_failure_count(p_key text)
returns int language sql stable as $$
  select count(*)::int from public.login_failures where key = p_key and at > now() - interval '15 minutes'
$$;

create or replace function public.prune_candles(p_days int default 30)
returns int language plpgsql as $$
declare n int;
begin
  delete from public.candles where ts < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end $$;

-- service_role only
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in
             ('fill_limit_order','close_order','apply_tick','set_market_price','claim_job','set_state',
              'note_login_failure','login_failure_count','prune_candles')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
