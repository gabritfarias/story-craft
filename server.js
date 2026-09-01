/**
 * ============================================================================
 * StoryCraft — Servidor Node.js / Express com Prisma ORM (server.js)
 * API REST para persistência robusta de Stories e Profiles no Banco de Dados
 * ============================================================================
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const prisma = require("./lib/prisma");

const app = express();
const PORT = process.env.PORT || 3000;

// --- MIDDLEWARES ---
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Servir arquivos estáticos da SPA (index.html, style.css, script.js, ícones, manifest)
app.use(express.static(path.join(__dirname)));

// --- ROTAS DA API REST ---

/**
 * GET /api/health — Verificação de integridade do servidor e banco de dados
 */
app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: "connected"
    });
  } catch (err) {
    console.error("[HealthCheck] Falha na conexão com o banco:", err);
    res.status(500).json({
      status: "error",
      message: "Falha na conexão com o banco de dados.",
      error: err.message
    });
  }
});

// ============================================================================
// ROTAS DE HISTÓRICO DE STORIES (/api/stories)
// ============================================================================

/**
 * GET /api/stories — Retorna todas as artes salvas ordenadas da mais recente para a mais antiga
 */
app.get("/api/stories", async (req, res) => {
  try {
    const stories = await prisma.story.findMany({
      orderBy: { createdAt: "desc" }
    });

    const formatted = stories.map((s) => ({
      id: s.id,
      title: s.title,
      thumbnail: s.thumbnail,
      state: typeof s.state === "string" ? JSON.parse(s.state) : s.state,
      dateFormatted: s.dateFormatted,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error("[API] Erro ao buscar stories:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar histórico de artes." });
  }
});

/**
 * POST /api/stories — Salva ou atualiza uma arte/histórico no banco
 */
app.post("/api/stories", async (req, res) => {
  try {
    const { id, title, thumbnail, state, dateFormatted } = req.body;

    if (!title || !thumbnail || !state) {
      return res.status(400).json({
        success: false,
        error: "Campos obrigatórios ausentes (title, thumbnail, state)."
      });
    }

    const stateStr = typeof state === "string" ? state : JSON.stringify(state);
    const dateStr = dateFormatted || new Date().toLocaleString("pt-BR");

    let story;
    if (id) {
      // Upsert por ID fornecido
      story = await prisma.story.upsert({
        where: { id: String(id) },
        update: {
          title,
          thumbnail,
          state: stateStr,
          dateFormatted: dateStr
        },
        create: {
          id: String(id),
          title,
          thumbnail,
          state: stateStr,
          dateFormatted: dateStr
        }
      });
    } else {
      story = await prisma.story.create({
        data: {
          title,
          thumbnail,
          state: stateStr,
          dateFormatted: dateStr
        }
      });
    }

    res.status(201).json({
      success: true,
      data: {
        ...story,
        state: JSON.parse(story.state)
      }
    });
  } catch (err) {
    console.error("[API] Erro ao salvar story:", err);
    res.status(500).json({ success: false, error: "Erro ao salvar arte no banco de dados." });
  }
});

/**
 * DELETE /api/stories/:id — Remove uma arte do histórico
 */
app.delete("/api/stories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.story.delete({
      where: { id: String(id) }
    });
    res.json({ success: true, message: "Arte excluída com sucesso." });
  } catch (err) {
    console.error("[API] Erro ao excluir story:", err);
    res.status(500).json({ success: false, error: "Erro ao excluir arte do banco de dados." });
  }
});

/**
 * DELETE /api/stories — Limpa todo o histórico de artes
 */
app.delete("/api/stories", async (req, res) => {
  try {
    await prisma.story.deleteMany({});
    res.json({ success: true, message: "Todo o histórico de artes foi apagado." });
  } catch (err) {
    console.error("[API] Erro ao limpar stories:", err);
    res.status(500).json({ success: false, error: "Erro ao limpar histórico de artes." });
  }
});

// ============================================================================
// ROTAS DE PERFIS DE ESTILIZAÇÃO (/api/profiles)
// ============================================================================

/**
 * GET /api/profiles — Retorna todos os perfis de texto salvos
 */
app.get("/api/profiles", async (req, res) => {
  try {
    const profiles = await prisma.profile.findMany({
      orderBy: { createdAt: "desc" }
    });

    const formatted = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      textLayers: typeof p.textLayers === "string" ? JSON.parse(p.textLayers) : p.textLayers,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error("[API] Erro ao buscar perfis:", err);
    res.status(500).json({ success: false, error: "Erro ao carregar perfis de texto." });
  }
});

/**
 * POST /api/profiles — Cria ou atualiza um perfil de estilização
 */
app.post("/api/profiles", async (req, res) => {
  try {
    const { id, name, textLayers } = req.body;

    if (!name || !textLayers) {
      return res.status(400).json({
        success: false,
        error: "Campos obrigatórios ausentes (name, textLayers)."
      });
    }

    const layersStr = typeof textLayers === "string" ? textLayers : JSON.stringify(textLayers);

    let profile;
    if (id) {
      profile = await prisma.profile.upsert({
        where: { id: String(id) },
        update: {
          name,
          textLayers: layersStr
        },
        create: {
          id: String(id),
          name,
          textLayers: layersStr
        }
      });
    } else {
      profile = await prisma.profile.create({
        data: {
          name,
          textLayers: layersStr
        }
      });
    }

    res.status(201).json({
      success: true,
      data: {
        ...profile,
        textLayers: JSON.parse(profile.textLayers)
      }
    });
  } catch (err) {
    console.error("[API] Erro ao salvar perfil:", err);
    res.status(500).json({ success: false, error: "Erro ao salvar perfil no banco de dados." });
  }
});

/**
 * PUT /api/profiles/:id — Renomeia ou altera um perfil
 */
app.put("/api/profiles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, textLayers } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (textLayers !== undefined) {
      updateData.textLayers = typeof textLayers === "string" ? textLayers : JSON.stringify(textLayers);
    }

    const profile = await prisma.profile.update({
      where: { id: String(id) },
      data: updateData
    });

    res.json({
      success: true,
      data: {
        ...profile,
        textLayers: JSON.parse(profile.textLayers)
      }
    });
  } catch (err) {
    console.error("[API] Erro ao atualizar perfil:", err);
    res.status(500).json({ success: false, error: "Erro ao atualizar perfil." });
  }
});

/**
 * DELETE /api/profiles/:id — Remove um perfil do banco
 */
app.delete("/api/profiles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.profile.delete({
      where: { id: String(id) }
    });
    res.json({ success: true, message: "Perfil removido com sucesso." });
  } catch (err) {
    console.error("[API] Erro ao excluir perfil:", err);
    res.status(500).json({ success: false, error: "Erro ao excluir perfil." });
  }
});

/**
 * DELETE /api/profiles — Limpa todos os perfis customizados
 */
app.delete("/api/profiles", async (req, res) => {
  try {
    await prisma.profile.deleteMany({});
    res.json({ success: true, message: "Todos os perfis foram removidos." });
  } catch (err) {
    console.error("[API] Erro ao limpar perfis:", err);
    res.status(500).json({ success: false, error: "Erro ao limpar perfis." });
  }
});

// --- ROTA DE FALLBACK SPA ---
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("=======================================================");
  console.log(`🚀 StoryCraft Backend Server rodando em http://localhost:${PORT}`);
  console.log(`🌐 Acesso na rede local disponível em http://0.0.0.0:${PORT}`);
  console.log(`📂 Banco de dados Prisma configurado via ${process.env.DATABASE_URL || "file:./dev.db"}`);
  console.log("=======================================================");
});

// --- TRATAMENTO GRACIOSO DE ERROS E ENCERRAMENTO ---
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Process] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught Exception:", error);
});

const shutdown = async () => {
  console.log("[Server] Encerrando conexões com o banco e servidor...");
  server.close(async () => {
    await prisma.$disconnect();
    console.log("[Server] Encerrado com sucesso.");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
