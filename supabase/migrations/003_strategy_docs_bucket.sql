-- Storage buckets for backtest feature

-- Strategy docs bucket (private, authenticated read/write only)
insert into storage.buckets (id, name, public)
values ('strategy-docs', 'strategy-docs', false)
on conflict (id) do nothing;

-- Policy: authenticated users can upload their own strategy docs
create policy "Users can upload strategy docs"
  on storage.objects for insert
  with check (bucket_id = 'strategy-docs' and auth.uid()::text = (storage.foldername(name))[1]);

-- Policy: authenticated users can read their own strategy docs
create policy "Users can read their own strategy docs"
  on storage.objects for select
  using (bucket_id = 'strategy-docs' and auth.uid()::text = (storage.foldername(name))[1]);
