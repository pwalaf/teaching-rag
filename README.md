# Teaching RAG — Backend RAG TypeScript Minimaliste

Un backend RAG (Retrieval-Augmented Generation) propre, pédagogique et structuré utilisant :

* TypeScript
* Express
* Supabase
* pgvector
* Groq
* Hugging Face Embeddings

Le projet a été construit dans une logique d’apprentissage et d’enseignement.

---

# Objectif du projet

Ce projet montre comment construire un système RAG moderne en séparant clairement les responsabilités :

1. Embedding
2. Stockage vectoriel
3. Retrieval
4. Génération augmentée

L’objectif est de comprendre :

* l’architecture d’un RAG
* les embeddings
* la recherche vectorielle
* pgvector
* Supabase
* les permissions SQL
* l’orchestration backend
* le debugging d’infrastructure

---

# Architecture générale

Le pipeline complet :

```txt
Question utilisateur
        ↓
Embedding de la question
        ↓
Recherche vectorielle dans Supabase
        ↓
Récupération des chunks pertinents
        ↓
Injection dans le prompt
        ↓
Génération par le LLM
        ↓
Réponse sourcée
```

---

# Stack technique

| Technologie  | Rôle                            |
| ------------ | ------------------------------- |
| TypeScript   | Backend typé                    |
| Express      | API HTTP                        |
| Supabase     | Base de données PostgreSQL      |
| pgvector     | Recherche vectorielle           |
| Groq         | Génération LLM                  |
| Hugging Face | Embeddings                      |
| ws           | Compatibilité WebSocket Node.js |
| nodemon      | Reload automatique              |

---

# Structure du projet

```txt
teaching-rag/
│
├── src/
│   ├── index.ts
│   └── services/
│       └── rag-service.ts
│
├── dist/
├── .env
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

# Installation

## 1. Cloner le projet

```bash
git clone https://github.com/pwalaf/teaching-rag.git
cd teaching-rag
```

---

## 2. Installer les dépendances

```bash
npm install
```

---

# Variables d’environnement

Créer un fichier `.env`

```env
GROQ_API_KEY=...
HF_TOKEN=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
PORT=3000
```

---

# Configuration Supabase

## Activer pgvector

Dans le SQL Editor :

```sql
create extension if not exists vector;
```

---

## Créer la table documents

```sql
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  metadata jsonb default '{}',
  embedding vector(384),
  created_at timestamptz default now()
);
```

---

## Créer l’index HNSW

```sql
create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);
```

---

## Fonction RPC de retrieval

```sql
create or replace function match_documents(
  query_embedding vector(384),
  match_count int default 3,
  similarity_threshold float default 0.3,
  filter jsonb default '{}'
)
returns table (
  id uuid,
  title text,
  content text,
  metadata jsonb,
  similarity float
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
```

---

# Permissions SQL importantes

Le backend utilise la clé `service_role`.

Dans certains projets Supabase, des permissions SQL explicites sont nécessaires.

Exécuter :

```sql
grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;

grant all privileges on all sequences in schema public to service_role;

grant execute on all functions in schema public to service_role;
```

---

# Configuration TypeScript

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "./dist",
    "rootDir": "./src",
    "ignoreDeprecations": "6.0"
  }
}
```

---

# Scripts disponibles

```bash
npm run dev
```

Lance le serveur en mode développement.

---

```bash
npm run build
```

Compile TypeScript vers `dist/`.

---

```bash
npm start
```

Lance la version compilée.

---

# API Endpoints

## Ingestion

```http
POST /api/ingest
```

### Exemple

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Politique de retour",
    "content": "Les clients ont 30 jours pour retourner un article.",
    "category": "support"
  }'
```

---

## Question / Réponse

```http
POST /api/ask
```

### Exemple

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Combien de jours les clients ont-ils pour retourner un article ?"
  }'
```

---

# Fonctionnement du RAG

## 1. Embedding

Le texte est transformé en vecteur numérique.

Le modèle utilisé :

```txt
sentence-transformers/all-MiniLM-L6-v2
```

Dimensions :

```txt
384
```

---

## 2. Stockage

Le vecteur est stocké dans PostgreSQL via pgvector.

---

## 3. Retrieval

Lors d’une question :

* la question est embedded
* une similarité cosinus est calculée
* les chunks les plus proches sont récupérés

---

## 4. Augmentation du prompt

Les documents retrouvés sont injectés dans le prompt système.

---

## 5. Génération

Le LLM répond uniquement à partir des sources fournies.

---

# Exemple de réponse

```json
{
  "answer": "Selon la source 1, les clients ont 30 jours pour retourner un article.",
  "sources": [
    {
      "title": "Politique de retour",
      "similarity": 0.84
    }
  ],
  "processingTimeMs": 3616
}
```

---

# Bugs rencontrés et résolution

## 1. process inconnu dans TypeScript

Erreur :

```txt
Cannot find name 'process'
```

Solution :

```bash
npm install -D @types/node
```

---

## 2. ts-node et tsconfig

Erreur :

```txt
ERR_UNKNOWN_FILE_EXTENSION
```

Cause : configuration TypeScript absente.

Solution : création d’un `tsconfig.json` propre.

---

## 3. Imports avec .ts

Erreur :

```txt
TS5097
```

Solution :

```ts
import "./rag-service"
```

au lieu de :

```ts
import "./rag-service.ts"
```

---

## 4. WebSocket Supabase sous Node.js

Erreur :

```txt
Node.js 20 detected without native WebSocket support
```

Solution :

```bash
npm install ws
```

Puis :

```ts
realtime: {
  transport: ws as unknown as WebSocketLikeConstructor
}
```

---

## 5. Permissions Supabase

Erreur :

```txt
permission denied for table documents
```

Cause : permissions SQL manquantes.

Solution :

```sql
grant usage on schema public to service_role;
```

et autres grants nécessaires.

---

# Limites actuelles

Le système actuel :

```txt
1 document = 1 embedding
```

Ce n’est pas idéal pour les longs documents.

---

# Améliorations futures

## Chunking

Découper les documents en petits morceaux.

---

## Streaming

Réponses token par token.

---

## Hybrid Search

Combiner :

* vector search
* keyword search

---

## Cache embeddings

Éviter les recalculs.

---

## Citations avancées

Ajouter lignes/pages/sources exactes.

---

# Concepts importants appris

Ce projet permet de comprendre :

* architecture backend
* TypeScript
* debugging
* embeddings
* retrieval
* génération LLM
* PostgreSQL
* permissions SQL
* séparation des responsabilités
* pipeline RAG moderne

---

# Licence

ISC
