// ============================================================
// RAG SERVICE — Version minimale, propre, adaptable
// ============================================================
// Architecture en 4 étapes claires :
//   1. embed()   — texte → vecteur numérique
//   2. ingest()  — stocker un document avec son vecteur
//   3. search()  — trouver les chunks les plus proches
//   4. ask()     — générer une réponse ancrée dans les sources
//
// Dépendances : groq-sdk  @supabase/supabase-js
// Variables d'env requises : GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, HF_TOKEN
// ============================================================

import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import ws from "ws";


// ─── Config ─────────────────────────────────────────────────
// Centraliser ici : facile à changer pour tes amis / démos

const CONFIG = {
  // Modèle d'embedding : transforme du texte en vecteur de 384 dimensions.
  // "all-MiniLM-L6-v2" est léger, gratuit, et très bon pour le retrieval.
  embeddingModel:
    "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",

  // LLM pour la génération (réponse finale)
  llmModel: "llama-3.3-70b-versatile",

  // Nombre de chunks retournés au LLM (top-K)
  topK: 3,

  // Seuil de similarité (0 à 1) — en dessous = chunk ignoré
  similarityThreshold: 0.3,

  // Longueur max d'un chunk dans le prompt (en caractères)
  maxChunkLength: 400,
};

// ─── Types ──────────────────────────────────────────────────

export interface Document {
  id?: string;
  title: string;
  content: string;
  // Metadata libre : adapte à ton domaine
  // Ex : { category: "faq" } ou { author: "Alice" } ou {}
  metadata?: Record<string, unknown>;
}

export interface RAGResponse {
  answer: string;
  sources: Array<{ title: string; similarity: number }>;
  processingTimeMs: number;
}

// ─── Clients ────────────────────────────────────────────────

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const supabase = createClient(
  "" + process.env.SUPABASE_URL!,
  "" + process.env.SUPABASE_SERVICE_KEY!,
  {
    auth: {
      persistSession: false
    },
    realtime: {
      transport: ws as unknown as WebSocketLikeConstructor     
    }
  }
);

// ============================================================
// ÉTAPE 1 — EMBED
// Convertit du texte en tableau de nombres (vecteur).
// Des textes sémantiquement proches auront des vecteurs proches.
// ============================================================

export async function embed(text: string): Promise<number[]> {
  const response = await fetch(CONFIG.embeddingModel, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: text.slice(0, 1500) }), // tronquer pour l'API
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding failed: ${err}`);
  }

  const data = await response.json();

  // L'API retourne soit un tableau plat, soit un tableau de tableaux
  if (Array.isArray(data) && typeof data[0] === "number") return data;
  if (Array.isArray(data) && Array.isArray(data[0])) return data[0];

  throw new Error("Format d'embedding inattendu");
}

// ============================================================
// ÉTAPE 2 — INGEST (stocker un document)
// Génère l'embedding du contenu, puis l'insère en base.
// À appeler une fois par document, pas à chaque question.
// ============================================================

export async function ingest(doc: Document): Promise<void> {
  const vector = await embed(doc.content);

  const { error } = await supabase.from("documents").insert({
    title: doc.title,
    content: doc.content,
    metadata: doc.metadata ?? {},
    embedding: vector,
  });

  if (error) throw new Error(`Ingest failed: ${error.message}`);
  console.log(`✓ Ingéré : ${doc.title}`);
}

// ============================================================
// ÉTAPE 3 — SEARCH (retrieval)
// Calcule la similarité cosinus entre la question et tous les chunks.
// Retourne les CONFIG.topK plus proches.
//
// Prérequis Supabase : une fonction RPC "match_documents" (voir README).
// ============================================================

export async function search(
  query: string,
  // Filtre optionnel sur metadata — adapte à ton contexte
  filter?: Record<string, unknown>
): Promise<Array<{ title: string; content: string; similarity: number }>> {
  const queryVector = await embed(query);

  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: queryVector,
    match_count: CONFIG.topK,
    similarity_threshold: CONFIG.similarityThreshold,
    filter: filter ?? {},
  });

  if (error) throw new Error(`Search failed: ${error.message}`);
  return data ?? [];
}

// ============================================================
// ÉTAPE 4 — GENERATE (génération augmentée)
// Injecte les chunks retrouvés dans le prompt système,
// puis demande au LLM de répondre en se basant UNIQUEMENT
// sur ces sources.
// ============================================================

export async function generate(
  question: string,
  chunks: Array<{ title: string; content: string; similarity: number }>,
  // systemContext : décris ton domaine ici (adapte à l'utilisateur)
  systemContext = "Tu es un assistant utile."
): Promise<string> {
  if (chunks.length === 0) {
    return "Je n'ai pas trouvé d'information pertinente dans ma base de connaissances.";
  }

  // Construire le contexte à partir des chunks récupérés
  const context = chunks
    .map(
      (c, i) =>
        `[Source ${i + 1} — ${c.title}]\n${c.content.slice(0, CONFIG.maxChunkLength)}`
    )
    .join("\n\n---\n\n");

  const systemPrompt = `${systemContext}

Tu dois répondre en te basant UNIQUEMENT sur les sources ci-dessous.
Si la réponse n'est pas dans les sources, dis-le clairement.
Cite toujours les sources utilisées (ex : "Selon la source 1…").

SOURCES :
${context}`;

  const response = await groq.chat.completions.create({
    model: CONFIG.llmModel,
    temperature: 0.2,
    max_tokens: 500,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
  });

  return response.choices[0].message.content ?? "";
}

// ============================================================
// POINT D'ENTRÉE PUBLIC — ask()
// Orchestre les 4 étapes.
// C'est la seule fonction que ton controller appelle.
// ============================================================

export async function ask(
  question: string,
  options: {
    // Contexte système libre : explique qui est l'assistant et pour quel domaine
    systemContext?: string;
    // Filtre metadata optionnel pour le retrieval
    filter?: Record<string, unknown>;
  } = {}
): Promise<RAGResponse> {
  const t0 = Date.now();

  const chunks = await search(question, options.filter);
  const answer = await generate(question, chunks, options.systemContext);

  return {
    answer,
    sources: chunks.map((c) => ({ title: c.title, similarity: c.similarity })),
    processingTimeMs: Date.now() - t0,
  };
}