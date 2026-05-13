import 'dotenv/config';
import express, { Request, Response } from 'express';
import { ask, ingest } from "../src/services/rag-service";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Poser des questions
app.post('/api/ask', async (req: Request, res: Response) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: "La question est requise." });
    }

    const result = await ask(question, {
      systemContext: "Tu es l'assistant du service client de Boutique XYZ."
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Ajouter de nouvelles connaissances
app.post('/api/ingest', async (req: Request, res: Response) => {
  try {
    const { title, content, category } = req.body;
    await ingest({ title, content, metadata: { category } });
    return res.json({ success: true, message: "Document ajouté." });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur API RAG démarré sur http://192.168.1.146:${PORT}`);
});
