-- Add unique constraint on ohlcv_cache for upsert support
alter table public.ohlcv_cache
  add constraint ohlcv_cache_pair_market_tf_dates_unique
  unique (pair, market, timeframe, date_from, date_to);
