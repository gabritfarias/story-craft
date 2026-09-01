/**
 * ============================================================================
 * StoryCraft — Servidor Node.js / Express com Prisma ORM (server.js)
 * API REST para persistência de Stories e Profiles
 * 
 * ARQUITETURA DE PERSISTÊNCIA:
 * - Source of Truth (Produção): GitHubSync → data/perfis_e_projetos.json
 * - Cache Local / Dev: Prisma + SQLite (filesystem efêmero na Vercel)
 * ============================================================================
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

let prisma;
try {
  prisma = require("./lib/prisma");
} catch (err) {
  console.warn("[Prisma] Client não disponível — rodando sem banco local:", err.message);
  prisma = null;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Detecta ambiente serverless (Vercel)
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

// --- MIDDLEWARES ---
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Servir arquivos estáticos da SPA (index.html, style.css, script.js, ícones, manifest)
app.use(express.static(path.join(__dirname)));

// --- HELPERS ---

/**
 * Metadados de persistência adicionados a todas as respostas da API.
 * Indica ao front-end qual camada de persistência está sendo usada.
 */
function persistenceMeta() {
  return {
    persistence: {
      sourceOfTruth: "github",
      description: "A persistência primária é feita via GitHubSync (data/perfis_e_projetos.json). O Prisma/SQLite é apenas um cache local de desenvolvimento.",
      localCacheAvailable: !!prisma && !IS_SERVERLESS,
      environment: IS_SERVERLESS ? "serverless" : "local"
    }
  };
}

/**
 * Executa uma operação Prisma com tratamento de falha gracioso.
 * Em ambiente serverless (Vercel), o SQLite é efêmero e pode não existir.
 */
async function withPrismaFallback(operation, fallbackValue = null) {
  if (!prisma || IS_SERVERLESS) {
    return fallbackValue;
  }
  try {
    return await operation();
  } catch (err) {
    console.warn("[Prisma] Operação falhou (cache local):", err.message);
    return fallbackValue;
  }
}

// --- ROTAS DA API REST ---

/**
 * GET /api/health — Verificação de integridade do servidor e banco de dados
 */
app.get("/api/health", async (req, res) => {
  let dbStatus = "unavailable";
  if (prisma && !IS_SERVERLESS) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = "connected";
    } catch (err) {
      dbStatus = "error: " + err.message;
    }
  } else if (IS_SERVERLESS) {
    dbStatus = "serverless (ephemeral — use GitHubSync)";
  }

  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: dbStatus,
    ...persistenceMeta()
  });
});

// ============================================================================
// ROTAS DE HISTÓRICO DE STORIES (/api/stories)
// ============================================================================

/**
 * GET /api/stories — Retorna todas as artes salvas
 * Em produção serverless, retorna array vazio (dados persistem via GitHubSync)
 */
app.get("/api/stories", async (req, res) => {
  try {
    const stories = await withPrismaFallback(
      () => prisma.story.findMany({ orderBy: { createdAt: "desc" } }),
      []
    );

    const formatted = stories.map((s) => {
      let parsedData = {};
      try {
        parsedData = typeof s.data === "string" ? JSON.parse(s.data) : (s.data || {});
      } catch (e) {
        parsedData = { raw: s.data };
      }

      return {
        id: s.id,
        title: s.title || "Meu Story",
        thumbnail: parsedData.thumbnail || "",
        state: parsedData.state || parsedData,
        dateFormatted: parsedData.dateFormatted || s.createdAt.toLocaleString("pt-BR"),
        data: parsedData,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      };
    });

    res.json({
      success: true,
      data: formatted,
      note: IS_SERVERLESS
        ? "Ambiente serverless detectado. Os dados retornados são do cache local (efêmero). Use GitHubSync como fonte primária."
        : undefined,
      ...persistenceMeta()
    });
  } catch (err) {
    console.error("[API] Erro ao buscar stories:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar histórico de artes.", ...persistenceMeta() });
  }
});

/**
 * POST /api/stories — Salva um novo registro
 * Em produção: grava no cache local E sinaliza que o front deve sincronizar via GitHubSync
 */
app.post("/api/stories", async (req, res) => {
  try {
    const { title, data, thumbnail, state, dateFormatted } = req.body;

    if (!title && !data && !thumbnail && !state) {
      return res.status(400).json({
        success: false,
        error: "Campos obrigatórios ausentes. Envie dados do canvas para gravação."
      });
    }

    const payloadData = data || {
      thumbnail,
      state,
      dateFormatted: dateFormatted || new Date().toLocaleString("pt-BR")
    };

    const dataStr = typeof payloadData === "string" ? payloadData : JSON.stringify(payloadData);
    const storyTitle = title || (payloadData.state && payloadData.state.projectTitle) || "Meu Story";

    // Tenta gravar no cache local (Prisma/SQLite)
    const story = await withPrismaFallback(
      () => prisma.story.create({
        data: {
          title: storyTitle,
          data: dataStr
        }
      }),
      null
    );

    if (story) {
      let parsedData = {};
      try {
        parsedData = JSON.parse(story.data);
      } catch (e) {
        parsedData = story.data;
      }

      res.status(201).json({
        success: true,
        data: {
          id: story.id,
          title: story.title,
          thumbnail: parsedData.thumbnail || "",
          state: parsedData.state || parsedData,
          dateFormatted: parsedData.dateFormatted || story.createdAt.toLocaleString("pt-BR"),
          data: parsedData,
          createdAt: story.createdAt,
          updatedAt: story.updatedAt
        },
        githubSyncRequired: true,
        note: "Gravado no cache local. Sincronize via GitHubSync para persistência permanente.",
        ...persistenceMeta()
      });
    } else {
      // Sem Prisma — retorna sucesso parcial, delega persistência ao GitHubSync
      console.log("[API] Prisma indisponível. Persistência delegada ao GitHubSync.");
      res.status(201).json({
        success: true,
        data: {
          id: `temp_${Date.now()}`,
          title: storyTitle,
          data: typeof payloadData === "string" ? JSON.parse(payloadData) : payloadData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        githubSyncRequired: true,
        note: "Cache local indisponível (serverless). Persistência delegada integralmente ao GitHubSync (data/perfis_e_projetos.json).",
        ...persistenceMeta()
      });
    }
  } catch (err) {
    console.error("[API] Erro ao salvar story:", err);
    res.status(500).json({ success: false, error: "Erro ao salvar história.", ...persistenceMeta() });
  }
});

/**
 * DELETE /api/stories/:id — Remove um registro pelo ID
 */
app.delete("/api/stories/:id", async (req, res) => {
  try {
    const storyId = parseInt(req.params.id, 10);
    if (isNaN(storyId)) {
      return res.status(400).json({ success: false, error: "ID inválido (deve ser um número inteiro)." });
    }

    await withPrismaFallback(
      () => prisma.story.delete({ where: { id: storyId } })
    );

    res.json({
      success: true,
      message: `Story #${storyId} removida do cache local.`,
      githubSyncRequired: true,
      note: "Remova também do GitHubSync para garantir consistência.",
      ...persistenceMeta()
    });
  } catch (err) {
    console.error("[API] Erro ao excluir story:", err);
    res.status(500).json({ success: false, error: "Erro ao excluir arte.", ...persistenceMeta() });
  }
});

/**
 * DELETE /api/stories — Limpa todo o histórico
 */
app.delete("/api/stories", async (req, res) => {
  try {
    await withPrismaFallback(
      () => prisma.story.deleteMany({})
    );

    res.json({
      success: true,
      message: "Cache local de histórico limpo.",
      githubSyncRequired: true,
      ...persistenceMeta()
    });
  } catch (err) {
    console.error("[API] Erro ao limpar stories:", err);
    res.status(500).json({ success: false, error: "Erro ao limpar histórico.", ...persistenceMeta() });
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
    const profiles = await withPrismaFallback(
      () => prisma.profile.findMany({ orderBy: { createdAt: "desc" } }),
      []
    );

    const formatted = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      textLayers: typeof p.textLayers === "string" ? JSON.parse(p.textLayers) : p.textLayers,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt
    }));

    res.json({
      success: true,
      data: formatted,
      note: IS_SERVERLESS
        ? "Ambiente serverless. Perfis retornados são do cache efêmero. Use GitHubSync como fonte primária."
        : undefined,
      ...persistenceMeta()
    });
  } catch (err) {
    console.error("[API] Erro ao buscar perfis:", err);
    res.status(500).json({ success: false, error: "Erro ao carregar perfis.", ...persistenceMeta() });
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
      profile = await withPrismaFallback(
        () => prisma.profile.upsert({
          where: { id: String(id) },
          update: { name, textLayers: layersStr },
          create: { id: String(id), name, textLayers: layersStr }
        }),
        null
      );
    } else {
      profile = await withPrismaFallback(
        () => prisma.profile.create({
          data: { name, textLayers: layersStr }
        }),
        null
      );
    }

    if (profile) {
      res.status(201).json({
        success: true,
        data: {
          ...profile,
          textLayers: JSON.parse(profile.textLayers)
        },
        githubSyncRequired: true,
        note: "Perfil salvo no cache local. Sincronize via GitHubSync para persistência permanente.",
        ...persistenceMeta()
      });
    } else {
      // Sem Prisma — retorna sucesso parcial
      console.log("[API] Prisma indisponível. Persistência do perfil delegada ao GitHubSync.");
      res.status(201).json({
        success: true,
        data: {
          id: id || `temp_${Date.now()}`,
          name,
          textLayers: typeof textLayers === "string" ? JSON.parse(textLayers) : textLayers,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        githubSyncRequired: true,
        note: "Cache local indisponível (serverless). Persistência delegada ao GitHubSync.",
        ...persistenceMeta()
      });
    }
  } catch (err) {
    console.error("[API] Erro ao salvar perfil:", err);
    res.status(500).json({ success: false, error: "Erro ao salvar perfil.", ...persistenceMeta() });
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

    const profile = await withPrismaFallback(
      () => prisma.profile.update({
        where: { id: String(id) },
        data: updateData
      }),
      null
    );

    if (profile) {
      res.json({
        success: true,
        data: {
          ...profile,
          textLayers: JSON.parse(profile.textLayers)
        },
        githubSyncRequired: true,
        ...persistenceMeta()
      });
    } else {
      res.json({
        success: true,
        data: { id, ...updateData },
        githubSyncRequired: true,
        note: "Cache local indisponível. Atualize via GitHubSync.",
        ...persistenceMeta()
      });
    }
  } catch (err) {
    console.error("[API] Erro ao atualizar perfil:", err);
    res.status(500).json({ success: false, error: "Erro ao atualizar perfil.", ...persistenceMeta() });
  }
});

/**
 * DELETE /api/profiles/:id — Remove um perfil do banco
 */
app.delete("/api/profiles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await withPrismaFallback(
      () => prisma.profile.delete({ where: { id: String(id) } })
    );

    res.json({
      success: true,
      message: "Perfil removido do cache local.",
      githubSyncRequired: true,
      ...persistenceMeta()
    });
  } catch (err) {
    console.error("[API] Erro ao excluir perfil:", err);
    res.status(500).json({ success: false, error: "Erro ao excluir perfil.", ...persistenceMeta() });
  }
});

/**
 * DELETE /api/profiles — Limpa todos os perfis customizados
 */
app.delete("/api/profiles", async (req, res) => {
  try {
    await withPrismaFallback(
      () => prisma.profile.deleteMany({})
    );

    res.json({
      success: true,
      message: "Cache local de perfis limpo.",
      githubSyncRequired: true,
      ...persistenceMeta()
    });
  } catch (err) {
    console.error("[API] Erro ao limpar perfis:", err);
    res.status(500).json({ success: false, error: "Erro ao limpar perfis.", ...persistenceMeta() });
  }
});

// --- ROTA DE FALLBACK SPA ---
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// --- INICIALIZAÇÃO DO SERVIDOR ---
if (!IS_SERVERLESS) {
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log("=======================================================");
    console.log(`🚀 StoryCraft Backend Server rodando em http://localhost:${PORT}`);
    console.log(`🌐 Acesso na rede local disponível em http://0.0.0.0:${PORT}`);
    console.log(`📂 Prisma/SQLite: cache local de desenvolvimento`);
    console.log(`☁️  Source of Truth: GitHubSync → data/perfis_e_projetos.json`);
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
      if (prisma) await prisma.$disconnect();
      console.log("[Server] Encerrado com sucesso.");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Exporta app para uso em ambientes serverless (Vercel)
module.exports = app;
