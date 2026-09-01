/**
 * ============================================================================
 * StoryCraft — Servidor Backend Node.js / Express (server/index.js)
 * API REST para persistência do histórico em SQLite e servidor de arquivos
 * ============================================================================
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const DB = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração de Middlewares
app.use(cors());
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ limit: '35mb', extended: true }));

// Servir arquivos estáticos do front-end (index.html, style.css, script.js)
const publicPath = path.join(__dirname, '..');
app.use(express.static(publicPath));

// --- ROTAS DA API REST (/api/history) ---

/**
 * GET /api/health — Verificação de status do servidor
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * GET /api/history — Lista todo o histórico ordenado pelo mais recente
 */
app.get('/api/history', async (req, res) => {
  try {
    const stories = await DB.getAll();
    res.json({ success: true, data: stories });
  } catch (err) {
    console.error('[API] Erro ao buscar histórico:', err);
    res.status(500).json({ success: false, error: 'Erro ao carregar histórico.' });
  }
});

/**
 * POST /api/history — Salva uma nova arte no histórico
 */
app.post('/api/history', async (req, res) => {
  try {
    const { title, thumbnail, state, dateFormatted } = req.body;

    if (!title || !thumbnail || !state) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios ausentes (title, thumbnail, state).'
      });
    }

    const savedRecord = await DB.insert(title, thumbnail, state, dateFormatted);
    res.status(201).json({ success: true, data: savedRecord });
  } catch (err) {
    console.error('[API] Erro ao salvar arte no histórico:', err);
    res.status(500).json({ success: false, error: 'Erro ao gravar no banco de dados.' });
  }
});

/**
 * DELETE /api/history/:id — Exclui uma arte específica pelo ID
 */
app.delete('/api/history/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido.' });
    }

    const result = await DB.deleteById(id);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[API] Erro ao excluir arte:', err);
    res.status(500).json({ success: false, error: 'Erro ao remover item do banco.' });
  }
});

/**
 * DELETE /api/history — Limpa todo o histórico
 */
app.delete('/api/history', async (req, res) => {
  try {
    const result = await DB.clearAll();
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[API] Erro ao limpar histórico:', err);
    res.status(500).json({ success: false, error: 'Erro ao limpar banco de dados.' });
  }
});

// Fallback para SPA / index.html
app.use((req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Inicia o servidor HTTP
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 StoryCraft Server rodando em http://localhost:${PORT}`);
  console.log(`📂 Banco de Dados SQLite em disco: ${path.join(__dirname, 'storycraft.db')}`);
  console.log(`=======================================================`);
});
