
-- 1. Activer l'extension vecteur (si pas déjà fait)
create extension if not exists vector;

-- 2. Table des documents
create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null,
  metadata    jsonb default '{}',
  embedding   vector(384),  -- 384 = dimensions de all-MiniLM-L6-v2
  created_at  timestamptz default now()
);

-- 3. Index HNSW pour la recherche vectorielle rapide
create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);

-- 4. Fonction RPC de recherche par similarité cosinus
--    Appelée par rag.service.ts → supabase.rpc("match_documents", ...)
create or replace function match_documents(
  query_embedding  vector(384),
  match_count      int     default 3,
  similarity_threshold float default 0.3,
  filter           jsonb   default '{}'
)
returns table (
  id          uuid,
  title       text,
  content     text,
  metadata    jsonb,
  similarity  float
)
language plpgsql
as $$
begin
  return query
  select
    d.id,
    d.title,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where
    (filter = '{}' or d.metadata @> filter)
    and 1 - (d.embedding <=> query_embedding) >= similarity_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Permissions backend
grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;

grant all privileges on all sequences in schema public to service_role;

grant execute on all functions in schema public to service_role;