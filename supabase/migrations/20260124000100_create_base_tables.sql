-- Base tables for protein_v1 (local + prod)
-- Creates core tables if missing

create extension if not exists pgcrypto;

create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  meal_type text,
  photo_url text,
  meal_text text,
  date date,
  created_at timestamptz default now()
);

create table if not exists public.meal_analysis (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid references public.meals(id) on delete cascade,
  protein_grams numeric,
  confidence text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.daily_totals (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  date date not null,
  protein_total numeric default 0,
  protein_goal numeric default 120,
  updated_at timestamptz default now(),
  unique (session_id, date)
);
