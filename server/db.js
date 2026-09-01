/**
 * ============================================================================
 * StoryCraft — Camada de Banco de Dados SQLite (server/db.js)
 * Persistência definitiva em disco do histórico de artes
 * ============================================================================
 */

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'storycraft.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[SQLite] Erro ao conectar ao banco de dados:', err.message);
  } else {
    console.log('[SQLite] Conectado ao banco de dados em disco:', DB_PATH);
  }
});

// Inicialização da tabela `history`
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      image_data TEXT NOT NULL,
      state_json TEXT NOT NULL,
      date_formatted TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('[SQLite] Erro ao criar tabela history:', err.message);
    } else {
      console.log('[SQLite] Tabela "history" pronta para uso.');
    }
  });
});

const DB = {
  /**
   * Retorna todas as artes salvas, ordenadas pela mais recente
   */
  getAll() {
    return new Promise((resolve, reject) => {
      const sql = `SELECT id, title, image_data, state_json, date_formatted, created_at FROM history ORDER BY id DESC`;
      db.all(sql, [], (err, rows) => {
        if (err) return reject(err);

        const mapped = (rows || []).map(row => {
          let parsedState = null;
          try {
            parsedState = JSON.parse(row.state_json);
          } catch (e) {
            console.warn('[SQLite] Erro ao analisar state_json do item:', row.id);
          }

          return {
            id: row.id,
            title: row.title,
            thumbnail: row.image_data,
            dateFormatted: row.date_formatted || new Date(row.created_at).toLocaleString('pt-BR'),
            createdAt: row.created_at,
            state: parsedState
          };
        });

        resolve(mapped);
      });
    });
  },

  /**
   * Insere uma nova arte no histórico e mantém o limite de 50 itens
   */
  insert(title, imageData, state, dateFormatted) {
    return new Promise((resolve, reject) => {
      const stateJson = typeof state === 'string' ? state : JSON.stringify(state);
      const sql = `
        INSERT INTO history (title, image_data, state_json, date_formatted)
        VALUES (?, ?, ?, ?)
      `;

      const nowFormatted = dateFormatted || new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());

      db.run(sql, [title, imageData, stateJson, nowFormatted], function (err) {
        if (err) return reject(err);

        const newId = this.lastID;

        // Podar registros antigos mantendo até 50 itens
        db.run(`
          DELETE FROM history WHERE id NOT IN (
            SELECT id FROM history ORDER BY id DESC LIMIT 50
          )
        `, (pruneErr) => {
          if (pruneErr) console.warn('[SQLite] Aviso ao podar histórico antigo:', pruneErr.message);
        });

        resolve({
          id: newId,
          title,
          thumbnail: imageData,
          dateFormatted: nowFormatted,
          state: typeof state === 'string' ? JSON.parse(state) : state
        });
      });
    });
  },

  /**
   * Remove uma arte específica por ID
   */
  deleteById(id) {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM history WHERE id = ?`;
      db.run(sql, [id], function (err) {
        if (err) return reject(err);
        resolve({ deleted: this.changes > 0 });
      });
    });
  },

  /**
   * Limpa todo o histórico de artes
   */
  clearAll() {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM history`;
      db.run(sql, [], function (err) {
        if (err) return reject(err);
        resolve({ cleared: true });
      });
    });
  }
};

module.exports = DB;
