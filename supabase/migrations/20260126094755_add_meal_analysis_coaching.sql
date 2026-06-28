alter table "public"."daily_totals" enable row level security;

alter table "public"."meal_analysis" enable row level security;

alter table "public"."meals" enable row level security;


  create policy "anon_select_daily_totals"
  on "public"."daily_totals"
  as permissive
  for select
  to anon
using (true);



  create policy "anon_update_daily_totals"
  on "public"."daily_totals"
  as permissive
  for update
  to anon
using (true)
with check (true);



  create policy "anon_upsert_daily_totals"
  on "public"."daily_totals"
  as permissive
  for insert
  to anon
with check (true);



  create policy "anon_insert_meal_analysis"
  on "public"."meal_analysis"
  as permissive
  for insert
  to anon
with check (true);



  create policy "anon_select_meal_analysis"
  on "public"."meal_analysis"
  as permissive
  for select
  to anon
using (true);



  create policy "anon_insert_meals"
  on "public"."meals"
  as permissive
  for insert
  to anon
with check (true);



  create policy "anon_select_meals"
  on "public"."meals"
  as permissive
  for select
  to anon
using (true);



  create policy "anon_read_meal_photos"
  on "storage"."objects"
  as permissive
  for select
  to anon
using ((bucket_id = 'meal_photos'::text));



  create policy "anon_upload_meal_photos"
  on "storage"."objects"
  as permissive
  for insert
  to anon
with check ((bucket_id = 'meal_photos'::text));



