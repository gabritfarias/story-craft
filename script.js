/**
 * ============================================================================
 * StoryCraft — Editor de Fotos para Instagram Stories (9:16)
 * JavaScript Puro (ES6+) — Sem dependências externas
 * 
 * Módulos:
 *  1. Configurações Globais e Constantes (CONFIG)
 *  2. Estado Global da Aplicação (AppState)
 *  3. Gerenciador de Banco de Dados Local (IndexedDB - Histórico com Limite)
 *  4. Gerenciador de Perfis de Estilização (LocalStorage - Perfis com Validação)
 *  5. Controlador de Imagem de Fundo (Upload Seguro, Pan, Zoom, Filtros Debounced)
 *  6. Sistema de Camadas de Texto Interativas (Drag, Edit, Resize, Acessibilidade por Teclado)
 *  7. Painel Inspetor de Propriedades (Contextual com 12+ Fontes)
 *  8. Motor de Renderização e Exportação Canvas 1080x1920 (High-Res com Auto-Fit & Word-Wrap)
 *  9. Controlador de Pré-visualização (Simulador Instagram Story Contido 9:16)
 * 10. Controlador de Histórico de Artes
 * 11. Utilitários Globais, Text Wrapping Inteligente, Toast e Captura de Erros
 * ============================================================================
 */

(function () {
  'use strict';

  // --- DEBUGGER DE TELA PARA MOBILE (ALERTA NATIVO PARA ERROS JS SILENCIOSOS) ---
  window.addEventListener('error', function (e) {
    alert('Erro JS: ' + (e.message || e) + ' na linha ' + (e.lineno || '?'));
  });
  window.addEventListener('unhandledrejection', function (e) {
    alert('Erro Async: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });

  /* ==========================================================================
     1. CONFIGURAÇÕES GLOBAIS E CONSTANTES (CONFIG)
     ========================================================================== */
  const CONFIG = {
    CANVAS_WIDTH: 1080,
    CANVAS_HEIGHT: 1920,
    ASPECT_RATIO: 9 / 16,
    MIN_ZOOM: 0.4,
    MAX_ZOOM: 3.0,
    ZOOM_STEP: 0.1,
    MAX_IMAGE_SIZE_BYTES: 15 * 1024 * 1024, // 15MB
    MAX_HISTORY_ITEMS: 50,
    DB_NAME: 'StoryCraftDB_v1',
    DB_VERSION: 2,
    STORE_NAME: 'saved_stories',
    PROFILES_STORAGE_KEY: 'story_editor_profiles_v1',
    FILTER_DEBOUNCE_MS: 120,
    MAX_TEXT_LAYER_WIDTH_RATIO: 0.90 // 90% da largura máxima do canvas para margem de segurança
  };

  /* ==========================================================================
     2. ESTADO GLOBAL DA APLICAÇÃO (AppState)
     ========================================================================== */
  const AppState = {
    projectTitle: 'Oferta Smartphone Pro',
    
    // Imagem de Fundo
    bgImage: null, // HTMLImageElement ou null
    bgImageDataUrl: null, // Para persistência no IndexedDB
    imageTransform: {
      panX: 0,
      panY: 0,
      zoom: 1.0,
      brightness: 100,
      contrast: 100,
      saturation: 100
    },
    currentFitMode: 'cover', // 'cover', 'contain', 'center'
    
    // Cor e Gradiente de Fundo
    backgroundColor: '#0f172a',
    backgroundGradient: null,
    overlayDarkness: 0,

    // Camadas de Texto
    textLayers: [],
    selectedLayerId: null,

    // Configurações de Interface
    showSafeZones: true,
    isDraggingImage: false,
    dragStartPos: { x: 0, y: 0 },
    imageStartPan: { x: 0, y: 0 },
    isExporting: false
  };

  /* ==========================================================================
     2.1 GERENCIADOR DE HISTÓRICO DE AÇÕES (Undo / Desfazer)
     ========================================================================== */
  const ActionHistory = {
    stack: [],
    MAX_HISTORY: 20,
    isApplyingState: false,

    captureSnapshot() {
      return {
        textLayers: JSON.parse(JSON.stringify(AppState.textLayers || [])),
        selectedLayerId: AppState.selectedLayerId,
        imageTransform: { ...(AppState.imageTransform || {}) },
        bgImageDataUrl: AppState.bgImageDataUrl,
        backgroundColor: AppState.backgroundColor,
        backgroundGradient: AppState.backgroundGradient,
        overlayDarkness: AppState.overlayDarkness,
        currentFitMode: AppState.currentFitMode,
        projectTitle: AppState.projectTitle
      };
    },

    saveState() {
      if (this.isApplyingState) return;
      const snapshot = this.captureSnapshot();
      this.stack.push(snapshot);
      if (this.stack.length > this.MAX_HISTORY) {
        this.stack.shift();
      }
      this.updateUI();
    },

    undo() {
      if (this.stack.length === 0) return;
      this.isApplyingState = true;

      const previousState = this.stack.pop();

      AppState.textLayers = JSON.parse(JSON.stringify(previousState.textLayers || []));
      AppState.selectedLayerId = previousState.selectedLayerId;
      AppState.imageTransform = { ...(previousState.imageTransform || {}) };
      AppState.backgroundColor = previousState.backgroundColor;
      AppState.backgroundGradient = previousState.backgroundGradient;
      AppState.overlayDarkness = previousState.overlayDarkness;
      AppState.currentFitMode = previousState.currentFitMode;
      if (previousState.projectTitle !== undefined) {
        AppState.projectTitle = previousState.projectTitle;
        if (DOM.projectTitleInput) DOM.projectTitleInput.value = previousState.projectTitle;
      }

      if (previousState.bgImageDataUrl !== AppState.bgImageDataUrl) {
        AppState.bgImageDataUrl = previousState.bgImageDataUrl;
        if (previousState.bgImageDataUrl) {
          const img = new Image();
          img.onload = () => {
            AppState.bgImage = img;
            BackgroundController.render();
            if (DOM.canvasEmptyState) DOM.canvasEmptyState.classList.add('hidden');
          };
          img.src = previousState.bgImageDataUrl;
        } else {
          AppState.bgImage = null;
          BackgroundController.render();
          if (DOM.canvasEmptyState && AppState.textLayers.length === 0) {
            DOM.canvasEmptyState.classList.remove('hidden');
          }
        }
      } else {
        BackgroundController.render();
      }

      TextLayerManager.renderLayers();
      InspectorController.update();

      this.isApplyingState = false;
      this.updateUI();
      showToast('Ação desfeita!');
    },

    updateUI() {
      const canUndo = this.stack.length > 0;
      if (DOM.btnUndo) {
        DOM.btnUndo.disabled = !canUndo;
      }
      if (DOM.mobileUndoBtn) {
        DOM.mobileUndoBtn.disabled = !canUndo;
      }
    }
  };

  /* ==========================================================================
     3. GERENCIADOR DE BANCO DE DADOS (REST API Server com Resiliência Offline)
     ========================================================================== */
  const DB = {
    isServerActive: false,
    indexedDBInstance: null,
    LOCAL_STORAGE_KEY: 'storycraft_history_backup',

    async fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    },

    async init() {
      // 1. Testa conectividade com a API REST do servidor
      try {
        const res = await this.fetchWithTimeout('/api/health', {}, 2500);
        if (res && res.ok) {
          this.isServerActive = true;
          console.log('[StoryCraft] Conectado à API REST do Backend Node.js (Prisma).');
        } else {
          this.isServerActive = false;
        }
      } catch (e) {
        console.warn('[StoryCraft] Backend offline ou operando standalone. Usando IndexedDB/LocalStorage como fallback.');
        this.isServerActive = false;
      }

      // 2. Inicializa o IndexedDB local para contingência e cache
      try {
        await this.initIndexedDB();
      } catch (storageErr) {
        console.warn('[StoryCraft] Erro ao inicializar IndexedDB local:', storageErr);
      }
    },

    initIndexedDB() {
      return new Promise((resolve) => {
        if (!window.indexedDB) return resolve(null);
        try {
          const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
          request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
              db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id' });
            }
          };
          request.onsuccess = (event) => {
            this.indexedDBInstance = event.target.result;
            resolve(this.indexedDBInstance);
          };
          request.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    },

    async getAllStories() {
      if (this.isServerActive) {
        try {
          const res = await this.fetchWithTimeout('/api/stories', {}, 3500);
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
              return json.data;
            }
          }
        } catch (err) {
          console.warn('[DB] Falha ao buscar stories do servidor, alternando para local:', err.message);
          this.isServerActive = false;
        }
      }

      if (this.indexedDBInstance || window.indexedDB) {
        try {
          const items = await this.getAllFromIndexedDB();
          if (items && items.length > 0) {
            return items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          }
        } catch (e) {
          console.warn('[DB] Falha no IndexedDB, buscando LocalStorage:', e);
        }
      }
      return this.getAllFromLocalStorage();
    },

    async saveStory(storyData) {
      if (!storyData.id) {
        storyData.id = 'story_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      }
      storyData.timestamp = storyData.timestamp || Date.now();

      if (this.isServerActive) {
        try {
          const res = await this.fetchWithTimeout('/api/stories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: storyData.id,
              title: storyData.title,
              thumbnail: storyData.thumbnail,
              state: storyData.state,
              dateFormatted: storyData.dateFormatted
            })
          }, 5000);

          if (res.ok) {
            const json = await res.json();
            if (json.success && json.data) {
              this.saveToIndexedDB(storyData).catch(() => {});
              return json.data;
            }
          }
        } catch (err) {
          console.warn('[DB] Falha ao salvar no servidor, gravando localmente:', err.message);
          this.isServerActive = false;
        }
      }

      let saved = null;
      if (this.indexedDBInstance || window.indexedDB) {
        try {
          saved = await this.saveToIndexedDB(storyData);
        } catch (e) {
          console.warn('[DB] Falha ao salvar no IndexedDB, usando LocalStorage:', e);
        }
      }
      if (!saved) {
        saved = this.saveToLocalStorage(storyData);
      }
      return saved;
    },

    async deleteStory(id) {
      if (this.isServerActive) {
        try {
          const res = await this.fetchWithTimeout(`/api/stories/${id}`, { method: 'DELETE' }, 4000);
          if (res.ok) {
            this.deleteFromIndexedDB(id).catch(() => {});
            this.deleteFromLocalStorage(id);
            return true;
          }
        } catch (err) {
          console.warn('[DB] Falha ao excluir no servidor, tentando localmente:', err.message);
          this.isServerActive = false;
        }
      }

      if (this.indexedDBInstance || window.indexedDB) {
        try {
          await this.deleteFromIndexedDB(id);
        } catch (e) {
          console.warn('[DB] Falha ao excluir do IndexedDB:', e);
        }
      }
      this.deleteFromLocalStorage(id);
      return true;
    },

    async clearAll() {
      if (this.isServerActive) {
        try {
          const res = await this.fetchWithTimeout('/api/stories', { method: 'DELETE' }, 4000);
          if (res.ok) {
            this.clearIndexedDB().catch(() => {});
            localStorage.removeItem(this.LOCAL_STORAGE_KEY);
            return true;
          }
        } catch (err) {
          console.warn('[DB] Falha ao limpar no servidor, limpando localmente:', err.message);
          this.isServerActive = false;
        }
      }

      if (this.indexedDBInstance || window.indexedDB) {
        try {
          await this.clearIndexedDB();
        } catch (e) {
          console.warn('[DB] Falha ao limpar IndexedDB:', e);
        }
      }
      localStorage.removeItem(this.LOCAL_STORAGE_KEY);
      return true;
    },

    // --- MÉTODOS DE INDEXEDDB ---
    getAllFromIndexedDB() {
      return new Promise((resolve) => {
        try {
          const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
          request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
              db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id' });
            }
          };
          request.onsuccess = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) return resolve([]);
            const tx = db.transaction([CONFIG.STORE_NAME], 'readonly');
            const store = tx.objectStore(CONFIG.STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          };
          request.onerror = () => resolve([]);
        } catch (e) {
          resolve([]);
        }
      });
    },

    saveToIndexedDB(storyData) {
      return new Promise((resolve, reject) => {
        try {
          const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
          request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
              db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id' });
            }
          };
          request.onsuccess = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
              return reject(new Error('Store não existe'));
            }
            const tx = db.transaction([CONFIG.STORE_NAME], 'readwrite');
            const store = tx.objectStore(CONFIG.STORE_NAME);
            const req = store.put(storyData);
            req.onsuccess = () => resolve(storyData);
            req.onerror = (e) => reject(e);
          };
          request.onerror = (e) => reject(e);
        } catch (e) {
          reject(e);
        }
      });
    },

    deleteFromIndexedDB(id) {
      return new Promise((resolve) => {
        try {
          const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
          request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
              db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id' });
            }
          };
          request.onsuccess = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) return resolve();
            const tx = db.transaction([CONFIG.STORE_NAME], 'readwrite');
            const store = tx.objectStore(CONFIG.STORE_NAME);
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
          };
          request.onerror = () => resolve();
        } catch (e) {
          resolve();
        }
      });
    },

    clearIndexedDB() {
      return new Promise((resolve) => {
        try {
          const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
          request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
              db.createObjectStore(CONFIG.STORE_NAME, { keyPath: 'id' });
            }
          };
          request.onsuccess = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) return resolve();
            const tx = db.transaction([CONFIG.STORE_NAME], 'readwrite');
            const store = tx.objectStore(CONFIG.STORE_NAME);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
          };
          request.onerror = () => resolve();
        } catch (e) {
          resolve();
        }
      });
    },

    // --- MÉTODOS DE FALLBACK LOCALSTORAGE ---
    getAllFromLocalStorage() {
      try {
        const data = localStorage.getItem(this.LOCAL_STORAGE_KEY);
        return data ? JSON.parse(data) : [];
      } catch (e) {
        return [];
      }
    },

    saveToLocalStorage(storyData) {
      try {
        const stories = this.getAllFromLocalStorage();
        const existingIdx = stories.findIndex(s => s.id === storyData.id);
        if (existingIdx >= 0) {
          stories[existingIdx] = storyData;
        } else {
          stories.unshift(storyData);
        }
        localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(stories.slice(0, 30)));
        return storyData;
      } catch (e) {
        console.warn('[DB] Erro ao gravar no LocalStorage:', e);
        return storyData;
      }
    },

    deleteFromLocalStorage(id) {
      try {
        const stories = this.getAllFromLocalStorage().filter(s => s.id !== id);
        localStorage.setItem(this.LOCAL_STORAGE_KEY, JSON.stringify(stories));
      } catch (e) {
        console.warn('[DB] Erro ao deletar do LocalStorage:', e);
      }
    }
  };

  /* ==========================================================================
     4. GERENCIADOR DE PERFIS DE ESTILIZAÇÃO (REST API + LocalStorage)
     ========================================================================== */
  const ProfileManager = {
    profiles: [],

    async init() {
      try {
        if (DOM.profilesLoadingIndicator) DOM.profilesLoadingIndicator.style.display = 'flex';
        await this.loadProfiles();
        this.bindEvents();
        this.renderProfilesList();
      } catch (err) {
        console.error('[ProfileManager] Erro ao carregar perfis:', err);
      } finally {
        if (DOM.profilesLoadingIndicator) DOM.profilesLoadingIndicator.style.display = 'none';
      }
    },

    bindEvents() {
      if (DOM.saveProfileHeaderBtn) {
        DOM.saveProfileHeaderBtn.addEventListener('click', () => {
          this.promptCreateProfile();
        });
      }

      if (DOM.createProfileFromTabBtn) {
        DOM.createProfileFromTabBtn.addEventListener('click', () => {
          this.promptCreateProfile();
        });
      }
    },

    async loadProfiles() {
      // 1. Tenta carregar da REST API
      if (DB.isServerActive) {
        try {
          const res = await DB.fetchWithTimeout('/api/profiles', {}, 3000);
          if (res.ok) {
            const json = await res.json();
            if (json.success && Array.isArray(json.data) && json.data.length > 0) {
              this.profiles = json.data;
              this.saveToStorage();
              return;
            }
          }
        } catch (e) {
          console.warn('[ProfileManager] Falha ao carregar do servidor, usando LocalStorage:', e);
        }
      }

      // 2. Fallback para LocalStorage
      try {
        const stored = localStorage.getItem(CONFIG.PROFILES_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.profiles = parsed;
          } else {
            this.profiles = this.getDefaultFactoryProfiles();
            this.saveToStorage();
          }
        } else {
          this.profiles = this.getDefaultFactoryProfiles();
          this.saveToStorage();
        }
      } catch (err) {
        console.error('Erro ao carregar perfis do localStorage:', err);
        this.profiles = this.getDefaultFactoryProfiles();
        this.saveToStorage();
      }
    },

    saveToStorage() {
      try {
        localStorage.setItem(CONFIG.PROFILES_STORAGE_KEY, JSON.stringify(this.profiles));
      } catch (err) {
        console.error('Erro ao salvar perfis no localStorage:', err);
      }
    },

    getDefaultFactoryProfiles() {
      return [
        {
          id: 'profile_default_1',
          name: 'Oferta Smartphone Pro',
          createdAt: Date.now(),
          textLayers: [
            {
              id: 'pl_1', text: '🔥 LANÇAMENTO EXCLUSIVO',
              x: 50, y: 18, fontSize: 18, fontFamily: "'Montserrat', sans-serif",
              fontWeight: '800', fontStyle: 'normal', textTransform: 'uppercase',
              color: '#000000', textAlign: 'center', hasBg: true, bgColor: '#facc15',
              bgPadding: 8, bgRadius: 6, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 10
            },
            {
              id: 'pl_2', text: 'iPhone 15 Pro Max 256GB',
              x: 50, y: 26, fontSize: 30, fontFamily: "'Montserrat', sans-serif",
              fontWeight: '800', fontStyle: 'normal', textTransform: 'none',
              color: '#ffffff', textAlign: 'center', hasBg: false, bgColor: '#10b981',
              bgPadding: 8, bgRadius: 6, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 11
            },
            {
              id: 'pl_3', text: 'R$ 5.999,00 à vista',
              x: 50, y: 74, fontSize: 34, fontFamily: "'Montserrat', sans-serif",
              fontWeight: '900', fontStyle: 'normal', textTransform: 'none',
              color: '#ffffff', textAlign: 'center', hasBg: true, bgColor: '#10b981',
              bgPadding: 12, bgRadius: 10, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 12
            },
            {
              id: 'pl_4', text: 'ou 12x de R$ 549,90 no cartão',
              x: 50, y: 82, fontSize: 19, fontFamily: "'Inter', sans-serif",
              fontWeight: '600', fontStyle: 'normal', textTransform: 'none',
              color: '#f8fafc', textAlign: 'center', hasBg: false, bgColor: '#10b981',
              bgPadding: 8, bgRadius: 6, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 13
            }
          ]
        },
        {
          id: 'profile_default_2',
          name: 'Super Promoção Varejo',
          createdAt: Date.now() - 1000,
          textLayers: [
            {
              id: 'pl_21', text: '⚡ ATÉ 50% DE DESCONTO',
              x: 50, y: 17, fontSize: 20, fontFamily: "'Anton', sans-serif",
              fontWeight: '700', fontStyle: 'normal', textTransform: 'uppercase',
              color: '#ffffff', textAlign: 'center', hasBg: true, bgColor: '#ef4444',
              bgPadding: 10, bgRadius: 6, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 10
            },
            {
              id: 'pl_22', text: 'SUPER PROMOÇÃO',
              x: 50, y: 25, fontSize: 34, fontFamily: "'Bebas Neue', sans-serif",
              fontWeight: '700', fontStyle: 'normal', textTransform: 'uppercase',
              color: '#ffffff', textAlign: 'center', hasBg: false, bgColor: '#10b981',
              bgPadding: 8, bgRadius: 6, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 11
            },
            {
              id: 'pl_23', text: 'DE R$ 2.499 POR APENAS',
              x: 50, y: 70, fontSize: 16, fontFamily: "'Montserrat', sans-serif",
              fontWeight: '700', fontStyle: 'normal', textTransform: 'uppercase',
              color: '#cbd5e1', textAlign: 'center', hasBg: false, bgColor: '#10b981',
              bgPadding: 8, bgRadius: 6, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 12
            },
            {
              id: 'pl_24', text: 'R$ 1.299,00',
              x: 50, y: 78, fontSize: 40, fontFamily: "'Anton', sans-serif",
              fontWeight: '800', fontStyle: 'normal', textTransform: 'none',
              color: '#000000', textAlign: 'center', hasBg: true, bgColor: '#facc15',
              bgPadding: 12, bgRadius: 8, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 13
            },
            {
              id: 'pl_25', text: '🚨 ÚLTIMAS UNIDADES EM ESTOQUE',
              x: 50, y: 86, fontSize: 16, fontFamily: "'Inter', sans-serif",
              fontWeight: '800', fontStyle: 'normal', textTransform: 'uppercase',
              color: '#ffffff', textAlign: 'center', hasBg: true, bgColor: '#dc2626',
              bgPadding: 8, bgRadius: 20, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 14
            }
          ]
        },
        {
          id: 'profile_default_3',
          name: 'Moda & Luxo Sofisticado',
          createdAt: Date.now() - 2000,
          textLayers: [
            {
              id: 'pl_31', text: 'NOVA COLEÇÃO',
              x: 50, y: 19, fontSize: 16, fontFamily: "'Cinzel', serif",
              fontWeight: '700', fontStyle: 'normal', textTransform: 'uppercase',
              color: '#ffffff', textAlign: 'center', hasBg: false, bgColor: '#10b981',
              bgPadding: 8, bgRadius: 6, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 10
            },
            {
              id: 'pl_32', text: 'Peça Exclusiva Signature',
              x: 50, y: 26, fontSize: 28, fontFamily: "'Playfair Display', serif",
              fontWeight: '700', fontStyle: 'italic', textTransform: 'none',
              color: '#ffffff', textAlign: 'center', hasBg: false, bgColor: '#10b981',
              bgPadding: 8, bgRadius: 6, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 11
            },
            {
              id: 'pl_33', text: 'R$ 899,00',
              x: 50, y: 76, fontSize: 34, fontFamily: "'Cinzel', serif",
              fontWeight: '700', fontStyle: 'normal', textTransform: 'none',
              color: '#ffffff', textAlign: 'center', hasBg: true, bgColor: '#0f172a',
              bgPadding: 12, bgRadius: 4, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 12
            },
            {
              id: 'pl_34', text: 'Disponível sob encomenda',
              x: 50, y: 83, fontSize: 16, fontFamily: "'Lora', serif",
              fontWeight: '600', fontStyle: 'italic', textTransform: 'none',
              color: '#cbd5e1', textAlign: 'center', hasBg: false, bgColor: '#10b981',
              bgPadding: 8, bgRadius: 6, hasShadow: true, hasStroke: false, strokeColor: '#000000', rotation: 0, zIndex: 13
            }
          ]
        }
      ];
    },

    promptCreateProfile() {
      if (!AppState.textLayers || AppState.textLayers.length === 0) {
        showToast('Adicione pelo menos um bloco de texto antes de salvar um perfil.', 'error');
        return;
      }

      const defaultName = AppState.projectTitle || 'Novo Perfil de Textos';
      const name = prompt('Digite um nome para o seu novo Perfil de Estilização:', defaultName);

      if (name && name.trim()) {
        this.createProfileFromCurrentLayers(name.trim());
      }
    },

    async createProfileFromCurrentLayers(name) {
      try {
        const cleanLayers = JSON.parse(JSON.stringify(AppState.textLayers));

        const newProfile = {
          id: 'profile_' + Date.now(),
          name: name,
          createdAt: Date.now(),
          textLayers: cleanLayers
        };

        if (DB.isServerActive) {
          try {
            const res = await DB.fetchWithTimeout('/api/profiles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newProfile)
            }, 4000);
            if (res.ok) {
              const json = await res.json();
              if (json.success && json.data) {
                newProfile.id = json.data.id;
              }
            }
          } catch (e) {
            console.warn('[ProfileManager] Falha ao salvar perfil no servidor, salvo localmente:', e);
          }
        }

        this.profiles.unshift(newProfile);
        this.saveToStorage();
        this.renderProfilesList();

        switchToTab('tab-profiles');
        showToast(`Perfil "${name}" salvo com sucesso!`);
      } catch (err) {
        console.error('Erro ao criar perfil:', err);
        showToast('Não foi possível salvar o perfil. Tente novamente.', 'error');
      }
    },

    applyProfile(profile) {
      try {
        if (confirm(`Deseja aplicar o perfil "${profile.name}"?\nIsso substituirá os textos atuais mantendo a foto de fundo intacta.`)) {
          const newLayers = profile.textLayers.map((l, idx) => ({
            ...JSON.parse(JSON.stringify(l)),
            id: 'layer_' + Date.now() + '_' + idx
          }));

          AppState.textLayers = newLayers;
          TextLayerManager.renderLayers();
          TextLayerManager.selectLayer(newLayers[0]?.id || null);
          showToast(`Perfil "${profile.name}" aplicado!`);
        }
      } catch (err) {
        console.error('Erro ao aplicar perfil:', err);
        showToast('Não foi possível aplicar o perfil selecionado.', 'error');
      }
    },

    async renameProfile(profile) {
      try {
        const newName = prompt('Digite o novo nome para o perfil:', profile.name);
        if (newName && newName.trim()) {
          profile.name = newName.trim();

          if (DB.isServerActive) {
            try {
              await DB.fetchWithTimeout(`/api/profiles/${profile.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: profile.name })
              }, 4000);
            } catch (e) {
              console.warn('[ProfileManager] Falha ao renomear no servidor:', e);
            }
          }

          this.saveToStorage();
          this.renderProfilesList();
          showToast('Perfil renomeado com sucesso!');
        }
      } catch (err) {
        console.error('Erro ao renomear perfil:', err);
        showToast('Não foi possível renomear o perfil.', 'error');
      }
    },

    async deleteProfile(profileId) {
      try {
        if (confirm('Tem certeza de que deseja excluir este perfil?')) {
          if (DB.isServerActive) {
            try {
              await DB.fetchWithTimeout(`/api/profiles/${profileId}`, { method: 'DELETE' }, 4000);
            } catch (e) {
              console.warn('[ProfileManager] Falha ao excluir no servidor:', e);
            }
          }

          this.profiles = this.profiles.filter(p => p.id !== profileId);
          this.saveToStorage();
          this.renderProfilesList();
          showToast('Perfil excluído com sucesso.');
        }
      } catch (err) {
        console.error('Erro ao excluir perfil:', err);
        showToast('Não foi possível excluir o perfil.', 'error');
      }
    },

    renderProfilesList() {
      DOM.profilesCountBadge.textContent = this.profiles.length;

      if (this.profiles.length === 0) {
        DOM.emptyProfilesMsg.style.display = 'block';
        DOM.profilesListContainer.querySelectorAll('.profile-card-item').forEach(el => el.remove());
        return;
      }

      DOM.emptyProfilesMsg.style.display = 'none';
      DOM.profilesListContainer.querySelectorAll('.profile-card-item').forEach(el => el.remove());

      this.profiles.forEach(profile => {
        const item = document.createElement('div');
        item.className = 'profile-card-item';

        const thumbDataUrl = this.generateNeutralThumbnail(profile.textLayers);

        item.innerHTML = `
          <div class="profile-card-thumb" aria-hidden="true">
            <img src="${thumbDataUrl}" alt="${profile.name}">
          </div>
          <div class="profile-card-details">
            <span class="profile-card-title" title="${profile.name}">${profile.name}</span>
            <div class="profile-card-meta">
              <span class="profile-badge-tag">${profile.textLayers.length} blocos de texto</span>
            </div>
            <div class="profile-card-actions">
              <button class="btn btn-primary btn-xs btn-apply-profile" aria-label="Aplicar perfil ${profile.name}">Aplicar</button>
              <button class="btn btn-outline btn-xs btn-rename-profile" aria-label="Renomear perfil ${profile.name}">Renomear</button>
              <button class="btn btn-ghost btn-xs btn-delete-profile" aria-label="Excluir perfil ${profile.name}">✕</button>
            </div>
          </div>
        `;

        item.querySelector('.btn-apply-profile').addEventListener('click', () => this.applyProfile(profile));
        item.querySelector('.btn-rename-profile').addEventListener('click', () => this.renameProfile(profile));
        item.querySelector('.btn-delete-profile').addEventListener('click', () => this.deleteProfile(profile.id));

        DOM.profilesListContainer.appendChild(item);
      });
    },

    generateNeutralThumbnail(layers) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 180;
        canvas.height = 320;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#161922';
        ctx.fillRect(0, 0, 180, 320);

        const thumbScale = 180 / (DOM.storyCanvasContainer.clientWidth || 360);

        layers.forEach(layer => {
          ctx.save();
          const realX = (layer.x / 100) * 180;
          const realY = (layer.y / 100) * 320;

          if (layer.type === 'image') {
            const destW = (layer.width || 120) * thumbScale;
            const destH = (layer.height || 120) * thumbScale;
            ctx.translate(realX, realY);
            ctx.rotate(((layer.rotation || 0) * Math.PI) / 180);
            if (layer.imgElement && layer.imgElement.complete) {
              ctx.drawImage(layer.imgElement, -destW / 2, -destH / 2, destW, destH);
            } else if (layer.imgUrl) {
              const fallbackImg = new Image();
              fallbackImg.src = layer.imgUrl;
              ctx.drawImage(fallbackImg, -destW / 2, -destH / 2, destW, destH);
            }
            ctx.restore();
            return;
          }

          const baseFontSize = Math.max(9, Math.round(layer.fontSize * thumbScale));

          let maxAllowedWidth = 180 * 0.90;
          if (layer.customWidth) {
            maxAllowedWidth = layer.customWidth * thumbScale;
          }
          const layout = wrapAndFitCanvasText(
            ctx,
            layer.text,
            maxAllowedWidth,
            baseFontSize,
            layer.fontFamily,
            layer.fontWeight,
            layer.fontStyle,
            layer.textTransform,
            layer.hasBg,
            layer.bgPadding * thumbScale,
            layer.bgRadius * thumbScale,
            8,
            (layer.letterSpacing || 0) * thumbScale,
            layer.lineHeight || 1.25
          );

          ctx.translate(realX, realY);
          ctx.rotate((layer.rotation * Math.PI) / 180);

          if (layer.hasBg) {
            ctx.fillStyle = layer.bgColor;
            drawRoundedRect(ctx, -layout.badgeW / 2, -layout.badgeH / 2, layout.badgeW, layout.badgeH, layout.badgeRadius);
            ctx.fill();
          }

          ctx.font = `${layer.fontStyle} ${layer.fontWeight} ${layout.fontSize}px ${layer.fontFamily.replace(/"/g, '')}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const startY = -(layout.totalHeight / 2) + (layout.lineHeight / 2);
          layout.lines.forEach((line, i) => {
            ctx.fillStyle = layer.color;
            ctx.fillText(line, 0, startY + (i * layout.lineHeight));
          });

          ctx.restore();
        });

        return canvas.toDataURL('image/png');
      } catch (err) {
        console.error('Erro ao gerar miniatura de perfil:', err);
        return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320" fill="%23222"><rect width="180" height="320"/></svg>';
      }
    }
  };

  /* ==========================================================================
     5. REFERÊNCIAS DO DOM
     ========================================================================== */
  const DOM = {
    // Header & Títulos
    projectTitleInput: document.getElementById('projectTitleInput'),
    toggleSafeZoneBtn: document.getElementById('toggleSafeZoneBtn'),
    btnToggleSafeZone: document.getElementById('btnToggleSafeZone'),
    btnUndo: document.getElementById('btnUndo'),
    mobileUndoBtn: document.getElementById('mobileUndoBtn'),
    resetCanvasBtn: document.getElementById('resetCanvasBtn'),
    openPreviewModalBtn: document.getElementById('openPreviewModalBtn'),
    saveProfileHeaderBtn: document.getElementById('saveProfileHeaderBtn'),
    exportStoryBtn: document.getElementById('exportStoryBtn'),

    // Navegação de Abas
    navTabs: document.querySelectorAll('.nav-tab'),
    tabPanels: document.querySelectorAll('.tab-panel'),
    historyCountBadge: document.getElementById('historyCountBadge'),
    profilesCountBadge: document.getElementById('profilesCountBadge'),

    // Upload & Ajustes de Imagem
    imageDropzone: document.getElementById('imageDropzone'),
    imageFileInput: document.getElementById('imageFileInput'),
    zoomOutPhotoBtn: document.getElementById('zoomOutPhotoBtn'),
    zoomInPhotoBtn: document.getElementById('zoomInPhotoBtn'),
    imageZoomSlider: document.getElementById('imageZoomSlider'),
    imageZoomValue: document.getElementById('imageZoomValue'),
    resetImageTransformBtn: document.getElementById('resetImageTransformBtn'),
    fitButtonsContainer: document.getElementById('fitButtonsContainer'),
    fitCoverBtn: document.getElementById('fitCoverBtn'),
    fitContainBtn: document.getElementById('fitContainBtn'),
    centerImageBtn: document.getElementById('centerImageBtn'),
    brightnessSlider: document.getElementById('brightnessSlider'),
    brightnessValue: document.getElementById('brightnessValue'),
    contrastSlider: document.getElementById('contrastSlider'),
    contrastValue: document.getElementById('contrastValue'),
    saturationSlider: document.getElementById('saturationSlider'),
    saturationValue: document.getElementById('saturationValue'),
    sampleChips: document.querySelectorAll('.sample-chip'),

    // Presets de Texto
    addProductNamePreset: document.getElementById('addProductNamePreset'),
    addPriceCashPreset: document.getElementById('addPriceCashPreset'),
    addPriceInstallmentPreset: document.getElementById('addPriceInstallmentPreset'),
    addConditionPreset: document.getElementById('addConditionPreset'),
    addCtaPreset: document.getElementById('addCtaPreset'),
    addSaldaoPreset: document.getElementById('addSaldaoPreset'),
    addTrocaComTrocoPreset: document.getElementById('addTrocaComTrocoPreset'),
    addFreeTextBtn: document.getElementById('addFreeTextBtn'),
    styleTemplatePills: document.querySelectorAll('.style-template-pill'),

    // Perfis
    createProfileFromTabBtn: document.getElementById('createProfileFromTabBtn'),
    profilesListContainer: document.getElementById('profilesListContainer'),
    emptyProfilesMsg: document.getElementById('emptyProfilesMsg'),
    profilesLoadingIndicator: document.getElementById('profilesLoadingIndicator'),

    // Selos & Logos
    stickerItems: document.querySelectorAll('.sticker-item'),
    customBadgeTextInput: document.getElementById('customBadgeTextInput'),
    addCustomBadgeBtn: document.getElementById('addCustomBadgeBtn'),
    logoDropzone: document.getElementById('logoDropzone'),
    logoFileInput: document.getElementById('logoFileInput'),
    customFontFileInput: document.getElementById('customFontFileInput'),

    // Fundo & Gradientes
    colorSwatches: document.querySelectorAll('.color-swatch'),
    customBgColorInput: document.getElementById('customBgColorInput'),
    customBgColorText: document.getElementById('customBgColorText'),
    gradientSwatches: document.querySelectorAll('.gradient-swatch'),
    overlayDarknessSlider: document.getElementById('overlayDarknessSlider'),
    overlayDarknessValue: document.getElementById('overlayDarknessValue'),

    // Histórico
    historyListContainer: document.getElementById('historyListContainer'),
    emptyHistoryMsg: document.getElementById('emptyHistoryMsg'),
    historyLoadingIndicator: document.getElementById('historyLoadingIndicator'),
    clearAllHistoryBtn: document.getElementById('clearAllHistoryBtn'),

    // Workspace & Palco
    canvasWorkspace: document.getElementById('canvasWorkspace'),
    stageViewport: document.getElementById('stageViewport'),
    smartphoneFrame: document.getElementById('smartphoneFrame'),
    storyCanvasContainer: document.getElementById('storyCanvasContainer'),
    backgroundCanvas: document.getElementById('backgroundCanvas'),
    textLayersOverlay: document.getElementById('textLayersOverlay'),
    safeZonesGuide: document.getElementById('safeZonesGuide'),
    canvasEmptyState: document.getElementById('canvasEmptyState'),
    activeLayersCount: document.getElementById('activeLayersCount'),
    zoomOutWorkspaceBtn: document.getElementById('zoomOutWorkspaceBtn'),
    zoomInWorkspaceBtn: document.getElementById('zoomInWorkspaceBtn'),
    workspaceZoomPercent: document.getElementById('workspaceZoomPercent'),
    fitScreenBtn: document.getElementById('fitScreenBtn'),

    // Inspetor de Propriedades
    inspectorPanel: document.getElementById('inspectorPanel'),
    noSelectionState: document.getElementById('noSelectionState'),
    textInspectorState: document.getElementById('textInspectorState'),
    selectedLayerTypeName: document.getElementById('selectedLayerTypeName'),
    duplicateLayerBtn: document.getElementById('duplicateLayerBtn'),
    deleteLayerBtn: document.getElementById('deleteLayerBtn'),
    inspectorTextInput: document.getElementById('inspectorTextInput'),
    fontFamilySelect: document.getElementById('fontFamilySelect'),
    fontSizeSlider: document.getElementById('fontSizeSlider'),
    fontSizeValue: document.getElementById('fontSizeValue'),
    letterSpacingSlider: document.getElementById('letterSpacingSlider'),
    letterSpacingValue: document.getElementById('letterSpacingValue'),
    lineHeightSlider: document.getElementById('lineHeightSlider'),
    lineHeightValue: document.getElementById('lineHeightValue'),
    toggleBoldBtn: document.getElementById('toggleBoldBtn'),
    toggleItalicBtn: document.getElementById('toggleItalicBtn'),
    toggleUppercaseBtn: document.getElementById('toggleUppercaseBtn'),
    alignLeftBtn: document.getElementById('alignLeftBtn'),
    alignCenterBtn: document.getElementById('alignCenterBtn'),
    alignRightBtn: document.getElementById('alignRightBtn'),
    textColorPicker: document.getElementById('textColorPicker'),
    textColorHex: document.getElementById('textColorHex'),
    quickColorDots: document.querySelectorAll('.quick-color-dot'),
    enableBadgeCheck: document.getElementById('enableBadgeCheck'),
    badgeOptionsContainer: document.getElementById('badgeOptionsContainer'),
    badgeColorPicker: document.getElementById('badgeColorPicker'),
    badgeColorHex: document.getElementById('badgeColorHex'),
    badgeRadiusSlider: document.getElementById('badgeRadiusSlider'),
    badgeRadiusValue: document.getElementById('badgeRadiusValue'),
    badgePaddingSlider: document.getElementById('badgePaddingSlider'),
    badgePaddingValue: document.getElementById('badgePaddingValue'),
    enableShadowCheck: document.getElementById('enableShadowCheck'),
    enableStrokeCheck: document.getElementById('enableStrokeCheck'),
    strokeOptionsContainer: document.getElementById('strokeOptionsContainer'),
    strokeColorPicker: document.getElementById('strokeColorPicker'),
    strokeColorHex: document.getElementById('strokeColorHex'),
    alignCanvasLeftBtn: document.getElementById('alignCanvasLeftBtn'),
    alignCanvasCenterHBtn: document.getElementById('alignCanvasCenterHBtn'),
    alignCanvasRightBtn: document.getElementById('alignCanvasRightBtn'),
    alignCanvasTopBtn: document.getElementById('alignCanvasTopBtn'),
    alignCanvasCenterVBtn: document.getElementById('alignCanvasCenterVBtn'),
    alignCanvasBottomBtn: document.getElementById('alignCanvasBottomBtn'),
    bringForwardBtn: document.getElementById('bringForwardBtn'),
    sendBackwardBtn: document.getElementById('sendBackwardBtn'),

    // Modal de Preview
    previewModal: document.getElementById('previewModal'),
    closePreviewBackdrop: document.getElementById('closePreviewBackdrop'),
    closePreviewModalBtn: document.getElementById('closePreviewModalBtn'),
    closePreviewBtn2: document.getElementById('closePreviewBtn2'),
    previewRenderedImage: document.getElementById('previewRenderedImage'),
    instagramUiOverlay: document.getElementById('instagramUiOverlay'),
    toggleIgUiCheck: document.getElementById('toggleIgUiCheck'),
    downloadFromPreviewBtn: document.getElementById('downloadFromPreviewBtn'),

    // Toast & Export Canvas
    toastNotification: document.getElementById('toastNotification'),
    toastIcon: document.getElementById('toastIcon'),
    toastMessage: document.getElementById('toastMessage'),
    exportCanvas: document.getElementById('exportCanvas')
  };

  /* ==========================================================================
     6. CONTROLADOR DE IMAGEM DE FUNDO & CANVAS 2D
     ========================================================================== */
  const BackgroundController = {
    ctx: null,

    init() {
      if (DOM.backgroundCanvas) {
        this.ctx = DOM.backgroundCanvas.getContext('2d');
      }
      this.bindEvents();
      this.render();
    },

    bindEvents() {
      // Upload seguro por input file com validação
      if (DOM.imageFileInput) {
        DOM.imageFileInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) {
            this.validateAndLoadImageFile(file);
          }
        });
      }

      // Drag and Drop na dropzone
      if (DOM.imageDropzone) {
        ['dragenter', 'dragover'].forEach(eventName => {
          DOM.imageDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            DOM.imageDropzone.classList.add('dragover');
          });
        });

        ['dragleave', 'drop'].forEach(eventName => {
          DOM.imageDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            DOM.imageDropzone.classList.remove('dragover');
          });
        });

        DOM.imageDropzone.addEventListener('drop', (e) => {
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (file) {
            this.validateAndLoadImageFile(file);
          }
        });
      }

      // Drag and Drop direto no Canvas
      if (DOM.storyCanvasContainer) {
        ['dragenter', 'dragover'].forEach(eventName => {
          DOM.storyCanvasContainer.addEventListener(eventName, (e) => {
            e.preventDefault();
          });
        });

        DOM.storyCanvasContainer.addEventListener('drop', (e) => {
          e.preventDefault();
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (file) {
            this.validateAndLoadImageFile(file);
          }
        });

        // Zoom via Scroll do Mouse no Canvas
        DOM.storyCanvasContainer.addEventListener('wheel', (e) => {
          if (!AppState.bgImage) return;
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.08 : -0.08;
          this.setZoom(AppState.imageTransform.zoom + delta);
        }, { passive: false });
      }

      // Pan da Imagem de Fundo (Mouse e Touch no Canvas)
      if (DOM.backgroundCanvas) {
        DOM.backgroundCanvas.addEventListener('mousedown', (e) => {
          if (!AppState.bgImage) return;
          ActionHistory.saveState();
          AppState.isDraggingImage = true;
          AppState.dragStartPos = { x: e.clientX, y: e.clientY };
          AppState.imageStartPan = { ...AppState.imageTransform };
        });

        // Touch para celulares
        DOM.backgroundCanvas.addEventListener('touchstart', (e) => {
          if (!AppState.bgImage || e.touches.length !== 1) return;
          ActionHistory.saveState();
          AppState.isDraggingImage = true;
          AppState.dragStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          AppState.imageStartPan = { ...AppState.imageTransform };
        }, { passive: true });
      }

      window.addEventListener('mousemove', (e) => {
        if (!AppState.isDraggingImage) return;
        const dx = e.clientX - AppState.dragStartPos.x;
        const dy = e.clientY - AppState.dragStartPos.y;
        
        const scale = CONFIG.CANVAS_WIDTH / (DOM.storyCanvasContainer?.clientWidth || 360);
        AppState.imageTransform.panX = AppState.imageStartPan.panX + (dx * scale);
        AppState.imageTransform.panY = AppState.imageStartPan.panY + (dy * scale);
        this.render();
      });

      window.addEventListener('mouseup', () => {
        AppState.isDraggingImage = false;
      });

      window.addEventListener('touchmove', (e) => {
        if (!AppState.isDraggingImage || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - AppState.dragStartPos.x;
        const dy = e.touches[0].clientY - AppState.dragStartPos.y;
        const scale = CONFIG.CANVAS_WIDTH / (DOM.storyCanvasContainer?.clientWidth || 360);
        AppState.imageTransform.panX = AppState.imageStartPan.panX + (dx * scale);
        AppState.imageTransform.panY = AppState.imageStartPan.panY + (dy * scale);
        this.render();
      }, { passive: true });

      window.addEventListener('touchend', () => {
        AppState.isDraggingImage = false;
      });

      // Botões Funcionais de Zoom (+ e -)
      if (DOM.zoomOutPhotoBtn) {
        DOM.zoomOutPhotoBtn.addEventListener('click', () => {
          ActionHistory.saveState();
          this.setZoom(AppState.imageTransform.zoom - CONFIG.ZOOM_STEP);
        });
      }

      if (DOM.zoomInPhotoBtn) {
        DOM.zoomInPhotoBtn.addEventListener('click', () => {
          ActionHistory.saveState();
          this.setZoom(AppState.imageTransform.zoom + CONFIG.ZOOM_STEP);
        });
      }

      // Zoom Slider Sincronizado
      if (DOM.imageZoomSlider) {
        DOM.imageZoomSlider.addEventListener('change', () => ActionHistory.saveState());
        DOM.imageZoomSlider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          this.setZoom(val / 100, false);
        });
      }

      // Botões de Enquadramento
      if (DOM.fitCoverBtn) DOM.fitCoverBtn.addEventListener('click', () => { ActionHistory.saveState(); this.fitImage('cover'); });
      if (DOM.fitContainBtn) DOM.fitContainBtn.addEventListener('click', () => { ActionHistory.saveState(); this.fitImage('contain'); });
      if (DOM.centerImageBtn) {
        DOM.centerImageBtn.addEventListener('click', () => {
          ActionHistory.saveState();
          AppState.imageTransform.panX = 0;
          AppState.imageTransform.panY = 0;
          this.updateFitModeUI('center');
          this.render();
        });
      }

      if (DOM.resetImageTransformBtn) DOM.resetImageTransformBtn.addEventListener('click', () => { ActionHistory.saveState(); this.resetTransform(); });

      // Filtros de Imagem com Debounce
      const debouncedRender = debounce(() => this.render(), CONFIG.FILTER_DEBOUNCE_MS);

      if (DOM.brightnessSlider) {
        DOM.brightnessSlider.addEventListener('change', () => ActionHistory.saveState());
        DOM.brightnessSlider.addEventListener('input', (e) => {
          AppState.imageTransform.brightness = parseInt(e.target.value, 10);
          if (DOM.brightnessValue) DOM.brightnessValue.textContent = `${AppState.imageTransform.brightness}%`;
          debouncedRender();
        });
      }

      if (DOM.contrastSlider) {
        DOM.contrastSlider.addEventListener('change', () => ActionHistory.saveState());
        DOM.contrastSlider.addEventListener('input', (e) => {
          AppState.imageTransform.contrast = parseInt(e.target.value, 10);
          if (DOM.contrastValue) DOM.contrastValue.textContent = `${AppState.imageTransform.contrast}%`;
          debouncedRender();
        });
      }

      if (DOM.saturationSlider) {
        DOM.saturationSlider.addEventListener('change', () => ActionHistory.saveState());
        DOM.saturationSlider.addEventListener('input', (e) => {
          AppState.imageTransform.saturation = parseInt(e.target.value, 10);
          if (DOM.saturationValue) DOM.saturationValue.textContent = `${AppState.imageTransform.saturation}%`;
          debouncedRender();
        });
      }

      // Chips de Exemplo de Produtos
      if (DOM.sampleChips) {
        DOM.sampleChips.forEach(chip => {
          chip.addEventListener('click', () => {
            ActionHistory.saveState();
            const sample = chip.getAttribute('data-sample');
            this.loadSampleProduct(sample);
          });
        });
      }

      // Paleta de Cores e Gradientes
      if (DOM.colorSwatches) {
        DOM.colorSwatches.forEach(swatch => {
          swatch.addEventListener('click', () => {
            ActionHistory.saveState();
            DOM.colorSwatches.forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            const color = swatch.getAttribute('data-color');
            AppState.backgroundColor = color;
            AppState.backgroundGradient = null;
            if (DOM.customBgColorInput) DOM.customBgColorInput.value = color;
            if (DOM.customBgColorText) DOM.customBgColorText.value = color;
            this.render();
          });
        });
      }

      if (DOM.customBgColorInput) {
        DOM.customBgColorInput.addEventListener('change', () => ActionHistory.saveState());
        DOM.customBgColorInput.addEventListener('input', (e) => {
          AppState.backgroundColor = e.target.value;
          AppState.backgroundGradient = null;
          if (DOM.customBgColorText) DOM.customBgColorText.value = e.target.value;
          this.render();
        });
      }

      if (DOM.gradientSwatches) {
        DOM.gradientSwatches.forEach(swatch => {
          swatch.addEventListener('click', () => {
            ActionHistory.saveState();
            AppState.backgroundGradient = swatch.getAttribute('data-gradient');
            this.render();
          });
        });
      }

      if (DOM.overlayDarknessSlider) {
        DOM.overlayDarknessSlider.addEventListener('change', () => ActionHistory.saveState());
        DOM.overlayDarknessSlider.addEventListener('input', (e) => {
          AppState.overlayDarkness = parseInt(e.target.value, 10);
          if (DOM.overlayDarknessValue) DOM.overlayDarknessValue.textContent = `${AppState.overlayDarkness}%`;
          this.render();
        });
      }
    },

    validateAndLoadImageFile(file) {
      if (!file) return;

      if (!file.type || !file.type.startsWith('image/')) {
        showToast('Por favor, selecione um arquivo de imagem válido (PNG, JPG, WEBP).', 'error');
        return;
      }

      if (file.size > CONFIG.MAX_IMAGE_SIZE_BYTES) {
        showToast('O tamanho da imagem excede o limite máximo permitido de 15MB.', 'error');
        return;
      }

      this.loadImageFromFile(file);
    },

    loadImageFromFile(file) {
      const reader = new FileReader();

      reader.onload = (e) => {
        const dataUrl = e.target.result;
        this.setImageFromDataUrl(dataUrl, file.name);
      };

      reader.onerror = () => {
        showToast('Não foi possível ler o arquivo de imagem selecionado.', 'error');
      };

      reader.readAsDataURL(file);
    },

    setImageFromDataUrl(dataUrl, name = 'Produto') {
      const img = new Image();

      img.onload = () => {
        AppState.bgImage = img;
        AppState.bgImageDataUrl = dataUrl;
        
        if (AppState.projectTitle === 'Oferta Smartphone Pro' && name !== 'Produto') {
          const cleanName = name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
          AppState.projectTitle = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
          DOM.projectTitleInput.value = AppState.projectTitle;
        }

        DOM.canvasEmptyState.classList.add('hidden');
        this.fitImage('cover');
        showToast('Foto carregada com sucesso!');
      };

      img.onerror = () => {
        showToast('Arquivo de imagem inválido ou corrompido.', 'error');
      };

      img.src = dataUrl;
    },

    setZoom(newZoom, updateSlider = true) {
      newZoom = Math.min(Math.max(CONFIG.MIN_ZOOM, newZoom), CONFIG.MAX_ZOOM);
      AppState.imageTransform.zoom = parseFloat(newZoom.toFixed(2));
      const zoomPercent = Math.round(AppState.imageTransform.zoom * 100);

      DOM.imageZoomValue.textContent = `${zoomPercent}%`;
      if (updateSlider) {
        DOM.imageZoomSlider.value = zoomPercent;
      }
      this.render();
    },

    updateFitModeUI(mode) {
      AppState.currentFitMode = mode;
      DOM.fitCoverBtn.classList.toggle('active', mode === 'cover');
      DOM.fitContainBtn.classList.toggle('active', mode === 'contain');
      DOM.centerImageBtn.classList.toggle('active', mode === 'center');
    },

    fitImage(mode = 'cover') {
      if (!AppState.bgImage) return;
      AppState.currentFitMode = mode;
      AppState.imageTransform.panX = 0;
      AppState.imageTransform.panY = 0;
      this.updateFitModeUI(mode);
      this.setZoom(1.0, true);
    },

    resetTransform() {
      AppState.imageTransform = {
        panX: 0,
        panY: 0,
        zoom: 1.0,
        brightness: 100,
        contrast: 100,
        saturation: 100
      };
      if (DOM.brightnessSlider) DOM.brightnessSlider.value = 100;
      if (DOM.brightnessValue) DOM.brightnessValue.textContent = '100%';
      if (DOM.contrastSlider) DOM.contrastSlider.value = 100;
      if (DOM.contrastValue) DOM.contrastValue.textContent = '100%';
      if (DOM.saturationSlider) DOM.saturationSlider.value = 100;
      if (DOM.saturationValue) DOM.saturationValue.textContent = '100%';
      this.fitImage('cover');
    },

    render() {
      if (!this.ctx && DOM.backgroundCanvas) {
        this.ctx = DOM.backgroundCanvas.getContext('2d');
      }
      const ctx = this.ctx;
      if (!ctx) return;
      const w = CONFIG.CANVAS_WIDTH;
      const h = CONFIG.CANVAS_HEIGHT;

      ctx.clearRect(0, 0, w, h);

      // 1. Fundo Base
      if (AppState.backgroundGradient) {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        if (AppState.backgroundGradient.includes('#4f46e5')) {
          grad.addColorStop(0, '#4f46e5'); grad.addColorStop(1, '#06b6d4');
        } else if (AppState.backgroundGradient.includes('#831843')) {
          grad.addColorStop(0, '#831843'); grad.addColorStop(1, '#be185d');
        } else if (AppState.backgroundGradient.includes('#14532d')) {
          grad.addColorStop(0, '#14532d'); grad.addColorStop(1, '#059669');
        } else if (AppState.backgroundGradient.includes('#78350f')) {
          grad.addColorStop(0, '#78350f'); grad.addColorStop(1, '#d97706');
        } else {
          grad.addColorStop(0, '#1e1b4b'); grad.addColorStop(1, '#0f172a');
        }
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = AppState.backgroundColor;
      }
      ctx.fillRect(0, 0, w, h);

      // 2. Foto do Produto (Escala Proporcional Rigorosa sem Distorção)
      if (AppState.bgImage) {
        ctx.save();
        const b = AppState.imageTransform.brightness;
        const c = AppState.imageTransform.contrast;
        const s = AppState.imageTransform.saturation;
        ctx.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;

        const img = AppState.bgImage;
        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;

        const baseScale = getBaseScale(img, AppState.currentFitMode);
        const totalScale = baseScale * AppState.imageTransform.zoom;

        const imgW = naturalW * totalScale;
        const imgH = naturalH * totalScale;

        const centerX = (w - imgW) / 2 + AppState.imageTransform.panX;
        const centerY = (h - imgH) / 2 + AppState.imageTransform.panY;

        ctx.drawImage(img, centerX, centerY, imgW, imgH);
        ctx.restore();
      }

      // 3. Vinheta
      if (AppState.overlayDarkness > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${AppState.overlayDarkness / 100})`;
        ctx.fillRect(0, 0, w, h);
      }
    },

    loadSampleProduct(type) {
      try {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 1080;
        tempCanvas.height = 1080;
        const tctx = tempCanvas.getContext('2d');

        tctx.clearRect(0, 0, 1080, 1080);
        
        if (type === 'smartphone') {
          AppState.projectTitle = 'iPhone 15 Pro Max 256GB';
          tctx.save();
          tctx.shadowColor = 'rgba(0,0,0,0.6)';
          tctx.shadowBlur = 40;
          tctx.shadowOffsetY = 20;

          tctx.fillStyle = '#232733';
          drawRoundedRect(tctx, 315, 140, 450, 800, 60);
          tctx.fill();

          const screenGrad = tctx.createLinearGradient(335, 160, 745, 920);
          screenGrad.addColorStop(0, '#3b82f6');
          screenGrad.addColorStop(0.5, '#8b5cf6');
          screenGrad.addColorStop(1, '#ec4899');
          tctx.fillStyle = screenGrad;
          drawRoundedRect(tctx, 335, 160, 410, 760, 48);
          tctx.fill();

          tctx.fillStyle = '#000000';
          drawRoundedRect(tctx, 480, 185, 120, 32, 16);
          tctx.fill();
          tctx.restore();

        } else if (type === 'smartwatch') {
          AppState.projectTitle = 'Apple Watch Ultra 2 GPS';
          tctx.save();
          tctx.shadowColor = 'rgba(0,0,0,0.5)';
          tctx.shadowBlur = 40;
          tctx.fillStyle = '#f97316';
          drawRoundedRect(tctx, 440, 80, 200, 920, 20);
          tctx.fill();

          tctx.fillStyle = '#e2e8f0';
          drawRoundedRect(tctx, 340, 320, 400, 440, 70);
          tctx.fill();

          tctx.fillStyle = '#000000';
          drawRoundedRect(tctx, 360, 340, 360, 400, 50);
          tctx.fill();

          tctx.fillStyle = '#22c55e';
          tctx.font = 'bold 80px Inter, sans-serif';
          tctx.textAlign = 'center';
          tctx.fillText('10:45', 540, 530);
          tctx.fillStyle = '#94a3b8';
          tctx.font = '32px Inter, sans-serif';
          tctx.fillText('🔥 520 kcal  ⚡ 98%', 540, 600);
          tctx.restore();

        } else if (type === 'headphone') {
          AppState.projectTitle = 'Sony WH-1000XM5 Noise Cancelling';
          tctx.save();
          tctx.strokeStyle = '#334155';
          tctx.lineWidth = 40;
          tctx.beginPath();
          tctx.arc(540, 480, 220, Math.PI, 0);
          tctx.stroke();

          tctx.fillStyle = '#1e293b';
          tctx.beginPath();
          tctx.ellipse(320, 540, 90, 150, 0, 0, 2 * Math.PI);
          tctx.fill();
          tctx.beginPath();
          tctx.ellipse(760, 540, 90, 150, 0, 0, 2 * Math.PI);
          tctx.fill();
          tctx.restore();

        } else {
          AppState.projectTitle = 'Tênis Esportivo Nike Air Pro';
          tctx.save();
          tctx.fillStyle = '#ef4444';
          tctx.beginPath();
          tctx.moveTo(250, 650);
          tctx.quadraticCurveTo(350, 450, 600, 480);
          tctx.quadraticCurveTo(850, 520, 900, 650);
          tctx.lineTo(250, 650);
          tctx.fill();

          tctx.fillStyle = '#ffffff';
          drawRoundedRect(tctx, 230, 650, 690, 60, 20);
          tctx.fill();
          tctx.restore();
        }

        DOM.projectTitleInput.value = AppState.projectTitle;
        const dataUrl = tempCanvas.toDataURL('image/png');
        this.setImageFromDataUrl(dataUrl, AppState.projectTitle);

        TextLayerManager.setupDefaultProductLayers(AppState.projectTitle);
      } catch (err) {
        console.error('Erro ao carregar produto de exemplo:', err);
        showToast('Não foi possível carregar o produto de exemplo.', 'error');
      }
    }
  };

  /* ==========================================================================
     7. SISTEMA DE CAMADAS DE TEXTO & ACESSIBILIDADE POR TECLADO
     ========================================================================== */
  const TextLayerManager = {
    draggedLayerId: null,
    dragOffset: { x: 0, y: 0 },
    resizingLayerId: null,
    resizeStartX: 0,
    resizeStartWidth: 0,
    resizeDir: 1,
    initialPinchDist: 0,
    initialPinchSize: 0,
    initialPinchWidth: 0,

    init() {
      this.bindEvents();
      this.renderLayers();
    },

    bindEvents() {
      if (DOM.addProductNamePreset) {
        DOM.addProductNamePreset.addEventListener('click', () => {
          this.addLayer({
            text: AppState.projectTitle || 'Smartphone Pro Max 256GB',
            fontSize: 28,
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: '800',
            color: '#ffffff',
            y: 22,
            hasBg: false
          });
        });
      }

      if (DOM.addPriceCashPreset) {
        DOM.addPriceCashPreset.addEventListener('click', () => {
          this.addLayer({
            text: 'R$ 4.999,00 à vista',
            fontSize: 34,
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: '900',
            color: '#ffffff',
            hasBg: true,
            bgColor: '#10b981',
            bgPadding: 10,
            bgRadius: 8,
            y: 72
          });
        });
      }

      if (DOM.addPriceInstallmentPreset) {
        DOM.addPriceInstallmentPreset.addEventListener('click', () => {
          this.addLayer({
            text: 'ou 12x de R$ 489,90 no cartão',
            fontSize: 19,
            fontFamily: "'Inter', sans-serif",
            fontWeight: '600',
            color: '#f8fafc',
            y: 80,
            hasBg: false
          });
        });
      }

      if (DOM.addConditionPreset) {
        DOM.addConditionPreset.addEventListener('click', () => {
          this.addLayer({
            text: '🔥 15% OFF NO PIX',
            fontSize: 19,
            fontFamily: "'Bebas Neue', sans-serif",
            fontWeight: '700',
            color: '#000000',
            hasBg: true,
            bgColor: '#facc15',
            bgPadding: 8,
            bgRadius: 6,
            y: 16
          });
        });
      }

      if (DOM.addCtaPreset) {
        DOM.addCtaPreset.addEventListener('click', () => {
          this.addLayer({
            text: '👆 Envie mensagem para comprar',
            fontSize: 17,
            fontFamily: "'Poppins', sans-serif",
            fontWeight: '700',
            color: '#ffffff',
            hasBg: true,
            bgColor: '#6366f1',
            bgPadding: 10,
            bgRadius: 20,
            y: 86
          });
        });
      }

      // Preset Especial de Varejo: Saldão Seminovos
      if (DOM.addSaldaoPreset) {
        DOM.addSaldaoPreset.addEventListener('click', async () => {
          await loadGoogleFontDynamically('Anton');
          this.addLayer({
            text: 'MEGA SALDÃO\nDE SEMINOVOS',
            fontSize: 32,
            fontFamily: "'Anton', sans-serif",
            fontWeight: '900',
            fontStyle: 'normal',
            textTransform: 'uppercase',
            color: '#ffffff',
            textAlign: 'center',
            hasBg: true,
            bgColor: '#dc2626',
            bgPadding: 12,
            bgRadius: 8,
            hasShadow: true,
            y: 20
          });
        });
      }

      // Preset Especial de Varejo: Troca com Troco
      if (DOM.addTrocaComTrocoPreset) {
        DOM.addTrocaComTrocoPreset.addEventListener('click', async () => {
          await loadGoogleFontDynamically('Montserrat');
          this.addLayer({
            text: '🔄 ACEITAMOS SEU USADO\nC/ TROCA COM TROCO NA HORA!',
            fontSize: 20,
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: '800',
            fontStyle: 'normal',
            textTransform: 'uppercase',
            color: '#ffffff',
            textAlign: 'center',
            hasBg: true,
            bgColor: '#059669',
            bgPadding: 10,
            bgRadius: 10,
            hasShadow: true,
            y: 75
          });
        });
      }

      // Upload de Logos e Stickers Customizados do Lojista
      if (DOM.logoDropzone && DOM.logoFileInput) {
        DOM.logoDropzone.addEventListener('click', () => DOM.logoFileInput.click());
        DOM.logoDropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          DOM.logoDropzone.classList.add('dragover');
        });
        DOM.logoDropzone.addEventListener('dragleave', () => {
          DOM.logoDropzone.classList.remove('dragover');
        });
        DOM.logoDropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          DOM.logoDropzone.classList.remove('dragover');
          if (e.dataTransfer.files.length > 0) {
            this.loadImageLayerFromFile(e.dataTransfer.files[0]);
          }
        });
        DOM.logoFileInput.addEventListener('change', (e) => {
          if (e.target.files.length > 0) {
            this.loadImageLayerFromFile(e.target.files[0]);
            e.target.value = '';
          }
        });
      }

      if (DOM.addFreeTextBtn) {
        DOM.addFreeTextBtn.addEventListener('click', () => {
          this.addLayer({
            text: 'Novo Texto Livre',
            fontSize: 26,
            y: 50
          });
        });
      }

      if (DOM.stickerItems) {
        DOM.stickerItems.forEach(sticker => {
          sticker.addEventListener('click', () => {
            const text = sticker.getAttribute('data-text');
            const bg = sticker.getAttribute('data-bg');
            const color = sticker.getAttribute('data-color');
            this.addLayer({
              text: text,
              fontSize: 18,
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: '800',
              color: color,
              hasBg: true,
              bgColor: bg,
              bgPadding: 8,
              bgRadius: 6,
              y: 18
            });
          });
        });
      }

      if (DOM.addCustomBadgeBtn) {
        DOM.addCustomBadgeBtn.addEventListener('click', () => {
          const val = DOM.customBadgeTextInput ? DOM.customBadgeTextInput.value.trim() : '';
          if (val) {
            this.addLayer({
              text: val.toUpperCase(),
              fontSize: 20,
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: '800',
              color: '#ffffff',
              hasBg: true,
              bgColor: '#6366f1',
              bgPadding: 8,
              bgRadius: 6,
              y: 18
            });
            if (DOM.customBadgeTextInput) DOM.customBadgeTextInput.value = '';
          }
        });
      }

      if (DOM.styleTemplatePills) {
        DOM.styleTemplatePills.forEach(pill => {
          pill.addEventListener('click', () => {
            const style = pill.getAttribute('data-style');
            this.applyGlobalTypographyStyle(style);
          });
        });
      }

      const handleCanvasDeselect = (e) => {
        if (
          e.target === DOM.backgroundCanvas ||
          e.target === DOM.safeZonesGuide ||
          e.target === DOM.storyCanvasContainer ||
          (e.target.classList && (
            e.target.classList.contains('stage-viewport') ||
            e.target.classList.contains('canvas-workspace') ||
            e.target.classList.contains('smartphone-frame')
          ))
        ) {
          this.selectLayer(null);
        }
      };

      if (DOM.storyCanvasContainer) {
        DOM.storyCanvasContainer.addEventListener('mousedown', handleCanvasDeselect);
        DOM.storyCanvasContainer.addEventListener('touchstart', handleCanvasDeselect, { passive: true });
      }
      if (DOM.canvasWorkspace) {
        DOM.canvasWorkspace.addEventListener('mousedown', handleCanvasDeselect);
        DOM.canvasWorkspace.addEventListener('touchstart', handleCanvasDeselect, { passive: true });
      }

      window.addEventListener('mousemove', (e) => this.handleDragMove(e));
      window.addEventListener('mouseup', () => this.handleDragEnd());

      window.addEventListener('touchmove', (e) => this.handleDragMove(e), { passive: false });
      window.addEventListener('touchend', () => this.handleDragEnd());

      // Atalhos de teclado (Acessibilidade: Delete, Escape, Setas)
      window.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
        if (document.activeElement.isContentEditable) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (AppState.selectedLayerId) {
            e.preventDefault();
            this.deleteLayer(AppState.selectedLayerId);
          }
        } else if (e.key === 'Escape') {
          this.selectLayer(null);
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && AppState.selectedLayerId) {
          const layer = AppState.textLayers.find(l => l.id === AppState.selectedLayerId);
          if (layer) {
            e.preventDefault();
            const step = e.shiftKey ? 5 : 1;
            if (e.key === 'ArrowUp') layer.y = Math.max(5, layer.y - step);
            if (e.key === 'ArrowDown') layer.y = Math.min(95, layer.y + step);
            if (e.key === 'ArrowLeft') layer.x = Math.max(5, layer.x - step);
            if (e.key === 'ArrowRight') layer.x = Math.min(95, layer.x + step);
            this.renderLayers();
          }
        }
      });
    },

    setupDefaultProductLayers(productName) {
      AppState.textLayers = [
        {
          id: 'layer_tag_' + Date.now(),
          text: '🔥 OFERTA EXCLUSIVA',
          x: 50,
          y: 18,
          fontSize: 17,
          fontFamily: "'Montserrat', sans-serif",
          fontWeight: '800',
          fontStyle: 'normal',
          textTransform: 'uppercase',
          color: '#000000',
          textAlign: 'center',
          hasBg: true,
          bgColor: '#facc15',
          bgPadding: 8,
          bgRadius: 6,
          hasShadow: true,
          hasStroke: false,
          strokeColor: '#000000',
          rotation: 0,
          zIndex: 10
        },
        {
          id: 'layer_title_' + (Date.now() + 1),
          text: productName,
          x: 50,
          y: 26,
          fontSize: 27,
          fontFamily: "'Montserrat', sans-serif",
          fontWeight: '800',
          fontStyle: 'normal',
          textTransform: 'none',
          color: '#ffffff',
          textAlign: 'center',
          hasBg: false,
          bgColor: '#10b981',
          bgPadding: 8,
          bgRadius: 6,
          hasShadow: true,
          hasStroke: false,
          strokeColor: '#000000',
          rotation: 0,
          zIndex: 11
        },
        {
          id: 'layer_cash_' + (Date.now() + 2),
          text: 'R$ 5.499,00 à vista',
          x: 50,
          y: 73,
          fontSize: 32,
          fontFamily: "'Montserrat', sans-serif",
          fontWeight: '900',
          fontStyle: 'normal',
          textTransform: 'none',
          color: '#ffffff',
          textAlign: 'center',
          hasBg: true,
          bgColor: '#10b981',
          bgPadding: 12,
          bgRadius: 10,
          hasShadow: true,
          hasStroke: false,
          strokeColor: '#000000',
          rotation: 0,
          zIndex: 12
        },
        {
          id: 'layer_card_' + (Date.now() + 3),
          text: 'ou 12x de R$ 519,90 no cartão',
          x: 50,
          y: 81,
          fontSize: 18,
          fontFamily: "'Inter', sans-serif",
          fontWeight: '600',
          fontStyle: 'normal',
          textTransform: 'none',
          color: '#f8fafc',
          textAlign: 'center',
          hasBg: false,
          bgColor: '#10b981',
          bgPadding: 8,
          bgRadius: 6,
          hasShadow: true,
          hasStroke: false,
          strokeColor: '#000000',
          rotation: 0,
          zIndex: 13
        }
      ];

      this.renderLayers();
      this.selectLayer(AppState.textLayers[1]?.id || null, false);
    },

    addLayer(customProps = {}) {
      ActionHistory.saveState();
      const defaultLayer = {
        id: 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        text: 'Novo Texto',
        x: 50,
        y: 50,
        fontSize: 26,
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: '700',
        fontStyle: 'normal',
        textTransform: 'none',
        color: '#ffffff',
        textAlign: 'center',
        hasBg: false,
        bgColor: '#10b981',
        bgPadding: 10,
        bgRadius: 8,
        hasShadow: true,
        hasStroke: false,
        strokeColor: '#000000',
        letterSpacing: 0,
        lineHeight: 1.25,
        rotation: 0,
        zIndex: AppState.textLayers.length + 10
      };

      const newLayer = { ...defaultLayer, ...customProps };
      AppState.textLayers.push(newLayer);
      this.renderLayers();
      this.selectLayer(newLayer.id);
      showToast('Texto adicionado!');
    },

    loadImageLayerFromFile(file) {
      if (!file) return;
      if (!file.type || !file.type.startsWith('image/')) {
        showToast('Por favor envie um arquivo de imagem válido (PNG ou WEBP).', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const img = new Image();
        img.onload = () => {
          ActionHistory.saveState();
          const defaultW = Math.min(130, Math.round(img.width / 2));
          const aspect = img.height / img.width;
          const defaultH = Math.round(defaultW * aspect);

          const newLayer = {
            id: 'img_layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            type: 'image',
            imgUrl: dataUrl,
            imgElement: img,
            text: file.name.replace(/\.[^/.]+$/, ''),
            x: 50,
            y: 50,
            width: defaultW,
            height: defaultH,
            rotation: 0,
            zIndex: AppState.textLayers.length + 10
          };

          AppState.textLayers.push(newLayer);
          this.renderLayers();
          this.selectLayer(newLayer.id);
          showToast('Logo/Sticker adicionado ao palco!');
        };
        img.onerror = () => {
          showToast('Erro ao processar imagem da logo.', 'error');
        };
        img.src = dataUrl;
      };
      reader.onerror = () => {
        showToast('Falha ao ler arquivo de imagem.', 'error');
      };
      reader.readAsDataURL(file);
    },

    duplicateLayer(id) {
      const layer = AppState.textLayers.find(l => l.id === id);
      if (!layer) return;

      ActionHistory.saveState();
      const duplicated = {
        ...layer,
        id: 'layer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        x: Math.min(layer.x + 4, 85),
        y: Math.min(layer.y + 4, 85),
        zIndex: AppState.textLayers.length + 10
      };

      if (layer.type === 'image' && layer.imgUrl) {
        const img = new Image();
        img.src = layer.imgUrl;
        duplicated.imgElement = img;
      }

      AppState.textLayers.push(duplicated);
      this.renderLayers();
      this.selectLayer(duplicated.id);
      showToast('Camada duplicada!');
    },

    deleteLayer(id) {
      ActionHistory.saveState();
      AppState.textLayers = AppState.textLayers.filter(l => l.id !== id);
      if (AppState.selectedLayerId === id) {
        AppState.selectedLayerId = null;
        InspectorController.update();
      }
      this.renderLayers();
      showToast('Camada excluída!');
    },

    selectLayer(id, autoOpen = true) {
      AppState.selectedLayerId = id;
      
      document.querySelectorAll('.text-layer-item').forEach(el => {
        if (el.getAttribute('data-id') === id) {
          el.classList.add('selected');
        } else {
          el.classList.remove('selected');
          el.classList.remove('editing');
          el.contentEditable = 'false';
        }
      });

      // 4. Interatividade Mobile: Abre gaveta direita do Inspetor apenas se autoOpen for true e id existir
      if (autoOpen && id) {
        if (window.innerWidth <= 860) {
          openRightDrawer();
        }
      } else if (!id) {
        if (window.innerWidth <= 860) {
          const inspectorPanel = document.querySelector('.inspector-panel');
          if (inspectorPanel) inspectorPanel.classList.remove('drawer-right-open');
          const sidebarTools = document.querySelector('.sidebar-tools');
          if (!sidebarTools || !sidebarTools.classList.contains('drawer-left-open')) {
            const backdrop = document.querySelector('.mobile-backdrop');
            if (backdrop) backdrop.classList.remove('backdrop-visible');
          }
        }
      }

      InspectorController.update();
    },

    renderLayers() {
      DOM.textLayersOverlay.innerHTML = '';
      DOM.activeLayersCount.textContent = `${AppState.textLayers.length} camadas`;

      AppState.textLayers.forEach(layer => {
        const el = document.createElement('div');
        const isImage = layer.type === 'image';
        el.className = 'text-layer-item' + (isImage ? ' image-layer' : '');
        el.setAttribute('data-id', layer.id);
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', isImage ? `Camada de imagem: ${layer.text}` : `Camada de texto: ${layer.text}`);
        el.style.zIndex = layer.zIndex;

        el.style.left = `${layer.x}%`;
        el.style.top = `${layer.y}%`;
        el.style.transform = `translate(-50%, -50%) rotate(${layer.rotation || 0}deg)`;

        if (isImage) {
          el.style.width = `${layer.width || 120}px`;
          el.style.height = `${layer.height || 120}px`;
          el.style.padding = '0';
          el.style.background = 'transparent';

          const imgEl = document.createElement('img');
          imgEl.src = layer.imgUrl;
          imgEl.alt = layer.text || 'Logo Lojista';
          imgEl.draggable = false;
          el.appendChild(imgEl);
        } else {
          el.style.fontSize = `${layer.fontSize}px`;
          el.style.fontFamily = layer.fontFamily;
          el.style.fontWeight = layer.fontWeight;
          el.style.fontStyle = layer.fontStyle;
          el.style.textTransform = layer.textTransform;
          el.style.textAlign = layer.textAlign;
          el.style.color = layer.color;
          el.style.letterSpacing = `${layer.letterSpacing || 0}px`;
          el.style.lineHeight = `${layer.lineHeight || 1.25}`;

          if (layer.hasBg) {
            el.style.backgroundColor = layer.bgColor;
            el.style.padding = `${layer.bgPadding}px ${layer.bgPadding * 1.5}px`;
            el.style.borderRadius = `${layer.bgRadius}px`;
          } else {
            el.style.backgroundColor = 'transparent';
            el.style.padding = '4px 8px';
            el.style.borderRadius = '0px';
          }

          if (layer.hasShadow) {
            el.style.textShadow = '0 2px 8px rgba(0,0,0,0.8), 0 1px 3px rgba(0,0,0,0.9)';
          } else {
            el.style.textShadow = 'none';
          }

          if (layer.hasStroke) {
            el.style.webkitTextStroke = `1px ${layer.strokeColor}`;
          } else {
            el.style.webkitTextStroke = '0px';
          }

          el.innerText = layer.text;
        }

        if (layer.customWidth || layer.width) {
          const wVal = layer.customWidth || layer.width;
          el.style.width = `${wVal}px`;
          el.style.maxWidth = 'none';
          el.style.whiteSpace = 'pre-wrap';
          el.style.overflowWrap = 'break-word';
        } else {
          el.style.width = 'max-content';
          el.style.maxWidth = 'none';
          el.style.whiteSpace = 'pre-wrap';
        }

        if (layer.id === AppState.selectedLayerId) {
          el.classList.add('selected');
        }

        const handleNW = document.createElement('div'); handleNW.className = 'layer-handle handle-nw';
        const handleNE = document.createElement('div'); handleNE.className = 'layer-handle handle-ne';
        const handleSW = document.createElement('div'); handleSW.className = 'layer-handle handle-sw';
        const handleSE = document.createElement('div'); handleSE.className = 'layer-handle handle-se';
        const rotateHandle = document.createElement('div'); rotateHandle.className = 'layer-rotate-handle';

        el.appendChild(handleNW);
        el.appendChild(handleNE);
        el.appendChild(handleSW);
        el.appendChild(handleSE);
        el.appendChild(rotateHandle);

        this.attachLayerEvents(el, layer);
        DOM.textLayersOverlay.appendChild(el);
      });
    },

    attachLayerEvents(el, layer) {
      let hasMoved = false;

      const startDragOrResize = (e, clientX, clientY) => {
        if (el.classList.contains('editing')) return;
        // 2. Desativa abertura automática da gaveta ao iniciar arraste ou redimensionamento
        this.selectLayer(layer.id, false);

        // 2. Início do Resize Horizontal pelas alças laterais
        if (e.target.classList.contains('layer-handle')) {
          e.stopPropagation();
          const isLeft = e.target.classList.contains('handle-nw') || e.target.classList.contains('handle-sw');
          this.resizingLayerId = layer.id;
          this.resizeStartX = clientX;
          this.resizeStartWidth = el.offsetWidth;
          this.resizeDir = isLeft ? -1 : 1;
          return;
        }

        if (e.target.classList.contains('layer-rotate-handle')) return;

        this.draggedLayerId = layer.id;
        const elRect = el.getBoundingClientRect();
        const currentCenterX = elRect.left + elRect.width / 2;
        const currentCenterY = elRect.top + elRect.height / 2;

        this.dragOffset = {
          x: clientX - currentCenterX,
          y: clientY - currentCenterY
        };
      };

      el.addEventListener('mousedown', (e) => {
        hasMoved = false;
        ActionHistory.saveState();
        startDragOrResize(e, e.clientX, e.clientY);
        if (!e.target.classList.contains('layer-handle')) {
          e.stopPropagation();
        }
      });

      el.addEventListener('touchstart', (e) => {
        // Gesto de Pinça Universal (Pinch-to-Zoom): se houver 2 dedos sobre o texto
        if (e.touches && e.touches.length === 2) {
          e.preventDefault();
          ActionHistory.saveState();
          this.initialPinchDist = Math.hypot(
            e.touches[0].pageX - e.touches[1].pageX,
            e.touches[0].pageY - e.touches[1].pageY
          );
          this.initialPinchSize = layer.fontSize || 26;
          this.initialPinchWidth = layer.customWidth || layer.width || el.offsetWidth || 260;
          this.selectLayer(layer.id, false);
          return;
        }

        if (e.touches.length !== 1) return;
        hasMoved = false;
        ActionHistory.saveState();
        const touch = e.touches[0];
        startDragOrResize(e, touch.clientX, touch.clientY);
        if (!e.target.classList.contains('layer-handle')) {
          e.stopPropagation();
        }
      }, { passive: false });

      el.addEventListener('mousemove', () => {
        hasMoved = true;
      });

      el.addEventListener('touchmove', () => {
        hasMoved = true;
      }, { passive: true });

      // 3. Toque simples (tap seco sem arraste): abre o painel do inspetor
      el.addEventListener('mouseup', (e) => {
        if (!hasMoved && !e.target.classList.contains('layer-handle') && !e.target.classList.contains('layer-rotate-handle')) {
          if (window.innerWidth <= 860) {
            openRightDrawer();
          }
        }
      });

      el.addEventListener('touchend', (e) => {
        if (this.initialPinchDist > 0 || (e.touches && e.touches.length > 0)) {
          if (!e.touches || e.touches.length < 2) {
            this.initialPinchDist = 0;
            this.initialPinchSize = 0;
            this.initialPinchWidth = 0;
          }
          return;
        }
        if (!hasMoved && !e.target.classList.contains('layer-handle') && !e.target.classList.contains('layer-rotate-handle')) {
          if (window.innerWidth <= 860) {
            openRightDrawer();
          }
        }
      });

      // Foco por teclado
      el.addEventListener('focus', () => {
        this.selectLayer(layer.id);
      });

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !el.classList.contains('editing')) {
          e.preventDefault();
          ActionHistory.saveState();
          el.contentEditable = 'true';
          el.classList.add('editing');
          el.focus();
          document.execCommand('selectAll', false, null);
        }
      });

      // Duplo clique: Edição in-line
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        ActionHistory.saveState();
        el.contentEditable = 'true';
        el.classList.add('editing');
        el.focus();
        document.execCommand('selectAll', false, null);
      });

      el.addEventListener('blur', () => {
        el.contentEditable = 'false';
        el.classList.remove('editing');
        layer.text = el.innerText;
        el.setAttribute('aria-label', `Camada de texto: ${layer.text}`);
        InspectorController.update();
      });

      el.addEventListener('input', () => {
        layer.text = el.innerText;
        if (DOM.inspectorTextInput) {
          DOM.inspectorTextInput.value = layer.text;
        }
      });
    },

    handleDragMove(e) {
      // 1. Gesto de Pinça Universal Proporcional (Pinch-to-Zoom para Fonte e Largura)
      if (e.touches && e.touches.length === 2 && this.initialPinchDist > 0) {
        e.preventDefault();
        const targetLayer = AppState.textLayers.find(l => l.id === (this.draggedLayerId || AppState.selectedLayerId));
        if (targetLayer) {
          const currentDistance = Math.hypot(
            e.touches[0].pageX - e.touches[1].pageX,
            e.touches[0].pageY - e.touches[1].pageY
          );
          const scale = currentDistance / this.initialPinchDist;
          const newFontSize = Math.max(10, Math.min(160, Math.round(this.initialPinchSize * scale)));
          const newWidth = Math.max(60, Math.min(1200, Math.round(this.initialPinchWidth * scale)));

          targetLayer.fontSize = newFontSize;
          targetLayer.customWidth = newWidth;
          targetLayer.width = newWidth;

          const el = document.querySelector(`.text-layer-item[data-id="${targetLayer.id}"]`);
          if (el) {
            el.style.fontSize = `${newFontSize}px`;
            el.style.width = `${newWidth}px`;
            el.style.maxWidth = 'none';
          }
          if (DOM.fontSizeSlider && AppState.selectedLayerId === targetLayer.id) {
            DOM.fontSizeSlider.value = newFontSize;
            if (DOM.fontSizeValue) DOM.fontSizeValue.textContent = `${newFontSize}px`;
          }
        }
        return;
      }

      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      if (clientX === undefined || clientY === undefined) return;

      // 2. Movimento de Redimensionamento Horizontal da Caixa
      if (this.resizingLayerId) {
        const deltaX = clientX - this.resizeStartX;
        const newWidth = Math.max(60, this.resizeStartWidth + (deltaX * 2 * this.resizeDir));
        const layer = AppState.textLayers.find(l => l.id === this.resizingLayerId);
        if (layer) {
          layer.customWidth = Math.round(newWidth);
          layer.width = Math.round(newWidth);
        }
        const el = document.querySelector(`.text-layer-item[data-id="${this.resizingLayerId}"]`);
        if (el) {
          el.style.width = `${Math.round(newWidth)}px`;
          el.style.maxWidth = 'none';
        }
        return;
      }

      if (!this.draggedLayerId) return;

      const layer = AppState.textLayers.find(l => l.id === this.draggedLayerId);
      if (!layer) return;

      const containerRect = DOM.storyCanvasContainer.getBoundingClientRect();
      const newPxX = clientX - containerRect.left - this.dragOffset.x;
      const newPxY = clientY - containerRect.top - this.dragOffset.y;

      const pctX = Math.round((newPxX / containerRect.width) * 100);
      const pctY = Math.round((newPxY / containerRect.height) * 100);

      layer.x = Math.max(0, Math.min(100, pctX));
      layer.y = Math.max(0, Math.min(100, pctY));

      const el = document.querySelector(`.text-layer-item[data-id="${layer.id}"]`);
      if (el) {
        el.style.left = `${layer.x}%`;
        el.style.top = `${layer.y}%`;
      }
    },

    handleDragEnd() {
      this.draggedLayerId = null;
      this.resizingLayerId = null;
      this.initialPinchDist = 0;
      this.initialPinchSize = 0;
      this.initialPinchWidth = 0;
    },

    applyGlobalTypographyStyle(style) {
      ActionHistory.saveState();
      AppState.textLayers.forEach(l => {
        if (style === 'modern') {
          l.fontFamily = "'Montserrat', sans-serif";
          l.fontWeight = '800';
        } else if (style === 'minimal') {
          l.fontFamily = "'Inter', sans-serif";
          l.fontWeight = '500';
        } else if (style === 'bold') {
          l.fontFamily = "'Anton', sans-serif";
          l.fontWeight = '700';
          l.textTransform = 'uppercase';
        } else if (style === 'luxury') {
          l.fontFamily = "'Playfair Display', serif";
          l.fontWeight = '700';
        }
      });
      this.renderLayers();
      InspectorController.update();
      showToast(`Estilo tipográfico "${style}" aplicado!`);
    }
  };

  /* ==========================================================================
     8. PAINEL INSPETOR DE PROPRIEDADES (Contextual)
     ========================================================================== */
  const InspectorController = {
    init() {
      this.bindEvents();
    },

    bindEvents() {
      const getActiveLayer = () => AppState.textLayers.find(l => l.id === AppState.selectedLayerId);

      // Texto
      if (DOM.inspectorTextInput) {
        DOM.inspectorTextInput.addEventListener('input', (e) => {
          const layer = getActiveLayer();
          if (!layer) return;
          layer.text = e.target.value;
          const el = document.querySelector(`.text-layer-item[data-id="${layer.id}"]`);
          if (el) {
            el.innerText = layer.text;
            el.setAttribute('aria-label', `Camada de texto: ${layer.text}`);
          }
        });
      }

      // Fonte Tipográfica (Carregamento Dinâmico Google Fonts)
      if (DOM.fontFamilySelect) {
        DOM.fontFamilySelect.addEventListener('change', async (e) => {
          ActionHistory.saveState();
          const layer = getActiveLayer();
          if (!layer) return;
          layer.fontFamily = e.target.value;

          const fontMatch = layer.fontFamily.match(/'([^']+)'/);
          const fontName = fontMatch ? fontMatch[1] : layer.fontFamily.split(',')[0].replace(/'/g, '').trim();
          await loadGoogleFontDynamically(fontName);

          TextLayerManager.renderLayers();
        });
      }

      // Upload de Fonte Customizada (.ttf, .otf, .woff)
      if (DOM.customFontFileInput) {
        DOM.customFontFileInput.addEventListener('change', async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            ActionHistory.saveState();
            await loadCustomFontFile(e.target.files[0]);
            e.target.value = '';
          }
        });
      }

      // Tamanho da Fonte
      if (DOM.fontSizeSlider) {
        DOM.fontSizeSlider.addEventListener('change', () => ActionHistory.saveState());
        DOM.fontSizeSlider.addEventListener('input', (e) => {
          const layer = getActiveLayer();
          if (!layer) return;
          layer.fontSize = parseInt(e.target.value, 10);
          if (DOM.fontSizeValue) DOM.fontSizeValue.textContent = `${layer.fontSize}px`;
          const el = document.querySelector(`.text-layer-item[data-id="${layer.id}"]`);
          if (el) el.style.fontSize = `${layer.fontSize}px`;
        });
      }

      // Espaçamento de Letras (Letter Spacing)
      if (DOM.letterSpacingSlider) {
        DOM.letterSpacingSlider.addEventListener('change', () => ActionHistory.saveState());
        DOM.letterSpacingSlider.addEventListener('input', (e) => {
          const layer = getActiveLayer();
          if (!layer) return;
          layer.letterSpacing = parseFloat(e.target.value);
          if (DOM.letterSpacingValue) DOM.letterSpacingValue.textContent = `${layer.letterSpacing}px`;
          const el = document.querySelector(`.text-layer-item[data-id="${layer.id}"]`);
          if (el) el.style.letterSpacing = `${layer.letterSpacing}px`;
        });
      }

      // Altura da Linha (Line Height)
      if (DOM.lineHeightSlider) {
        DOM.lineHeightSlider.addEventListener('change', () => ActionHistory.saveState());
        DOM.lineHeightSlider.addEventListener('input', (e) => {
          const layer = getActiveLayer();
          if (!layer) return;
          layer.lineHeight = parseFloat(e.target.value);
          if (DOM.lineHeightValue) DOM.lineHeightValue.textContent = `${layer.lineHeight}x`;
          const el = document.querySelector(`.text-layer-item[data-id="${layer.id}"]`);
          if (el) el.style.lineHeight = `${layer.lineHeight}`;
        });
      }

      // Formatações
      if (DOM.toggleBoldBtn) {
        DOM.toggleBoldBtn.addEventListener('click', () => {
          ActionHistory.saveState();
          const layer = getActiveLayer();
          if (!layer) return;
          layer.fontWeight = (layer.fontWeight === '800' || layer.fontWeight === 'bold') ? 'normal' : '800';
          DOM.toggleBoldBtn.classList.toggle('active', layer.fontWeight === '800' || layer.fontWeight === 'bold');
          TextLayerManager.renderLayers();
        });
      }

      if (DOM.toggleItalicBtn) {
        DOM.toggleItalicBtn.addEventListener('click', () => {
          ActionHistory.saveState();
          const layer = getActiveLayer();
          if (!layer) return;
          layer.fontStyle = layer.fontStyle === 'italic' ? 'normal' : 'italic';
          DOM.toggleItalicBtn.classList.toggle('active', layer.fontStyle === 'italic');
          TextLayerManager.renderLayers();
        });
      }

      if (DOM.toggleUppercaseBtn) {
        DOM.toggleUppercaseBtn.addEventListener('click', () => {
          ActionHistory.saveState();
          const layer = getActiveLayer();
          if (!layer) return;
          layer.textTransform = layer.textTransform === 'uppercase' ? 'none' : 'uppercase';
          DOM.toggleUppercaseBtn.classList.toggle('active', layer.textTransform === 'uppercase');
          TextLayerManager.renderLayers();
        });
      }

      // Alinhamento
      [DOM.alignLeftBtn, DOM.alignCenterBtn, DOM.alignRightBtn].forEach((btn) => {
        if (!btn) return;
        btn.addEventListener('click', () => {
          ActionHistory.saveState();
          const layer = getActiveLayer();
          if (!layer) return;
          if (btn === DOM.alignLeftBtn) layer.textAlign = 'left';
          if (btn === DOM.alignCenterBtn) layer.textAlign = 'center';
          if (btn === DOM.alignRightBtn) layer.textAlign = 'right';
          this.updateAlignmentButtons(layer.textAlign);
          TextLayerManager.renderLayers();
        });
      });

      // Cor do Texto
      if (DOM.textColorPicker) {
        DOM.textColorPicker.addEventListener('change', () => ActionHistory.saveState());
        DOM.textColorPicker.addEventListener('input', (e) => {
          const layer = getActiveLayer();
          if (!layer) return;
          layer.color = e.target.value;
          if (DOM.textColorHex) DOM.textColorHex.value = e.target.value;
          TextLayerManager.renderLayers();
        });
      }

      if (DOM.quickColorDots) {
        DOM.quickColorDots.forEach(dot => {
          dot.addEventListener('click', () => {
            ActionHistory.saveState();
            const layer = getActiveLayer();
            if (!layer) return;
            const color = dot.getAttribute('data-color');
            layer.color = color;
            if (DOM.textColorPicker) DOM.textColorPicker.value = color;
            if (DOM.textColorHex) DOM.textColorHex.value = color;
            TextLayerManager.renderLayers();
          });
        });
      }

      // Badge / Fundo
      if (DOM.enableBadgeCheck) {
        DOM.enableBadgeCheck.addEventListener('change', (e) => {
          ActionHistory.saveState();
          const layer = getActiveLayer();
          if (!layer) return;
          layer.hasBg = e.target.checked;
          if (DOM.badgeOptionsContainer) DOM.badgeOptionsContainer.style.display = layer.hasBg ? 'block' : 'none';
          TextLayerManager.renderLayers();
        });
      }

      if (DOM.badgeColorPicker) {
        DOM.badgeColorPicker.addEventListener('change', () => ActionHistory.saveState());
        DOM.badgeColorPicker.addEventListener('input', (e) => {
          const layer = getActiveLayer();
          if (!layer) return;
          layer.bgColor = e.target.value;
          if (DOM.badgeColorHex) DOM.badgeColorHex.value = e.target.value;
          TextLayerManager.renderLayers();
        });
      }

      if (DOM.badgeRadiusSlider) {
        DOM.badgeRadiusSlider.addEventListener('change', () => ActionHistory.saveState());
        DOM.badgeRadiusSlider.addEventListener('input', (e) => {
          const layer = getActiveLayer();
          if (!layer) return;
          layer.bgRadius = parseInt(e.target.value, 10);
          if (DOM.badgeRadiusValue) DOM.badgeRadiusValue.textContent = `${layer.bgRadius}px`;
          TextLayerManager.renderLayers();
        });
      }

      if (DOM.badgePaddingSlider) {
        DOM.badgePaddingSlider.addEventListener('change', () => ActionHistory.saveState());
        DOM.badgePaddingSlider.addEventListener('input', (e) => {
          const layer = getActiveLayer();
          if (!layer) return;
          layer.bgPadding = parseInt(e.target.value, 10);
          if (DOM.badgePaddingValue) DOM.badgePaddingValue.textContent = `${layer.bgPadding}px`;
          TextLayerManager.renderLayers();
        });
      }

      // Sombra e Contorno
      if (DOM.enableShadowCheck) {
        DOM.enableShadowCheck.addEventListener('change', (e) => {
          ActionHistory.saveState();
          const layer = getActiveLayer();
          if (!layer) return;
          layer.hasShadow = e.target.checked;
          TextLayerManager.renderLayers();
        });
      }

      if (DOM.enableStrokeCheck) {
        DOM.enableStrokeCheck.addEventListener('change', (e) => {
          ActionHistory.saveState();
          const layer = getActiveLayer();
          if (!layer) return;
          layer.hasStroke = e.target.checked;
          if (DOM.strokeOptionsContainer) DOM.strokeOptionsContainer.style.display = layer.hasStroke ? 'block' : 'none';
          TextLayerManager.renderLayers();
        });
      }

      if (DOM.strokeColorPicker) {
        DOM.strokeColorPicker.addEventListener('change', () => ActionHistory.saveState());
        DOM.strokeColorPicker.addEventListener('input', (e) => {
          const layer = getActiveLayer();
          if (!layer) return;
          layer.strokeColor = e.target.value;
          if (DOM.strokeColorHex) DOM.strokeColorHex.value = e.target.value;
          TextLayerManager.renderLayers();
        });
      }

      // Alinhamento na Tela
      if (DOM.alignCanvasLeftBtn) DOM.alignCanvasLeftBtn.addEventListener('click', () => { ActionHistory.saveState(); const l = getActiveLayer(); if (l) { l.x = 20; TextLayerManager.renderLayers(); } });
      if (DOM.alignCanvasCenterHBtn) DOM.alignCanvasCenterHBtn.addEventListener('click', () => { ActionHistory.saveState(); const l = getActiveLayer(); if (l) { l.x = 50; TextLayerManager.renderLayers(); } });
      if (DOM.alignCanvasRightBtn) DOM.alignCanvasRightBtn.addEventListener('click', () => { ActionHistory.saveState(); const l = getActiveLayer(); if (l) { l.x = 80; TextLayerManager.renderLayers(); } });
      if (DOM.alignCanvasTopBtn) DOM.alignCanvasTopBtn.addEventListener('click', () => { ActionHistory.saveState(); const l = getActiveLayer(); if (l) { l.y = 20; TextLayerManager.renderLayers(); } });
      if (DOM.alignCanvasCenterVBtn) DOM.alignCanvasCenterVBtn.addEventListener('click', () => { ActionHistory.saveState(); const l = getActiveLayer(); if (l) { l.y = 50; TextLayerManager.renderLayers(); } });
      if (DOM.alignCanvasBottomBtn) DOM.alignCanvasBottomBtn.addEventListener('click', () => { ActionHistory.saveState(); const l = getActiveLayer(); if (l) { l.y = 80; TextLayerManager.renderLayers(); } });

      // Ordem de Camada
      if (DOM.bringForwardBtn) {
        DOM.bringForwardBtn.addEventListener('click', () => {
          ActionHistory.saveState();
          const layer = getActiveLayer();
          if (layer) { layer.zIndex += 1; TextLayerManager.renderLayers(); }
        });
      }

      if (DOM.sendBackwardBtn) {
        DOM.sendBackwardBtn.addEventListener('click', () => {
          ActionHistory.saveState();
          const layer = getActiveLayer();
          if (layer && layer.zIndex > 1) { layer.zIndex -= 1; TextLayerManager.renderLayers(); }
        });
      }

      // Duplicar e Excluir
      if (DOM.duplicateLayerBtn) {
        DOM.duplicateLayerBtn.addEventListener('click', () => {
          if (AppState.selectedLayerId) TextLayerManager.duplicateLayer(AppState.selectedLayerId);
        });
      }

      if (DOM.deleteLayerBtn) {
        DOM.deleteLayerBtn.addEventListener('click', () => {
          if (AppState.selectedLayerId) TextLayerManager.deleteLayer(AppState.selectedLayerId);
        });
      }
    },

    updateAlignmentButtons(align) {
      if (DOM.alignLeftBtn) DOM.alignLeftBtn.classList.toggle('active', align === 'left');
      if (DOM.alignCenterBtn) DOM.alignCenterBtn.classList.toggle('active', align === 'center');
      if (DOM.alignRightBtn) DOM.alignRightBtn.classList.toggle('active', align === 'right');
    },

    update() {
      const layer = AppState.textLayers.find(l => l.id === AppState.selectedLayerId);

      if (!layer) {
        if (DOM.noSelectionState) DOM.noSelectionState.style.display = 'flex';
        if (DOM.textInspectorState) DOM.textInspectorState.style.display = 'none';
        return;
      }

      if (DOM.noSelectionState) DOM.noSelectionState.style.display = 'none';
      if (DOM.textInspectorState) DOM.textInspectorState.style.display = 'block';

      if (DOM.selectedLayerTypeName) DOM.selectedLayerTypeName.textContent = layer.text.substring(0, 16) || 'Texto';
      if (DOM.inspectorTextInput) DOM.inspectorTextInput.value = layer.text;
      if (DOM.fontFamilySelect) DOM.fontFamilySelect.value = layer.fontFamily;
      if (DOM.fontSizeSlider) DOM.fontSizeSlider.value = layer.fontSize;
      if (DOM.fontSizeValue) DOM.fontSizeValue.textContent = `${layer.fontSize}px`;

      if (DOM.letterSpacingSlider) {
        DOM.letterSpacingSlider.value = layer.letterSpacing !== undefined ? layer.letterSpacing : 0;
        if (DOM.letterSpacingValue) DOM.letterSpacingValue.textContent = `${DOM.letterSpacingSlider.value}px`;
      }

      if (DOM.lineHeightSlider) {
        DOM.lineHeightSlider.value = layer.lineHeight !== undefined ? layer.lineHeight : 1.25;
        if (DOM.lineHeightValue) DOM.lineHeightValue.textContent = `${DOM.lineHeightSlider.value}x`;
      }

      if (DOM.toggleBoldBtn) DOM.toggleBoldBtn.classList.toggle('active', layer.fontWeight === '800' || layer.fontWeight === 'bold');
      if (DOM.toggleItalicBtn) DOM.toggleItalicBtn.classList.toggle('active', layer.fontStyle === 'italic');
      if (DOM.toggleUppercaseBtn) DOM.toggleUppercaseBtn.classList.toggle('active', layer.textTransform === 'uppercase');

      this.updateAlignmentButtons(layer.textAlign);

      if (DOM.textColorPicker) DOM.textColorPicker.value = layer.color.startsWith('#') ? layer.color : '#ffffff';
      if (DOM.textColorHex) DOM.textColorHex.value = layer.color;

      if (DOM.enableBadgeCheck) DOM.enableBadgeCheck.checked = layer.hasBg;
      if (DOM.badgeOptionsContainer) DOM.badgeOptionsContainer.style.display = layer.hasBg ? 'block' : 'none';
      if (DOM.badgeColorPicker) DOM.badgeColorPicker.value = layer.bgColor.startsWith('#') ? layer.bgColor : '#10b981';
      if (DOM.badgeColorHex) DOM.badgeColorHex.value = layer.bgColor;
      if (DOM.badgeRadiusSlider) DOM.badgeRadiusSlider.value = layer.bgRadius;
      if (DOM.badgeRadiusValue) DOM.badgeRadiusValue.textContent = `${layer.bgRadius}px`;
      if (DOM.badgePaddingSlider) DOM.badgePaddingSlider.value = layer.bgPadding;
      if (DOM.badgePaddingValue) DOM.badgePaddingValue.textContent = `${layer.bgPadding}px`;

      if (DOM.enableShadowCheck) DOM.enableShadowCheck.checked = layer.hasShadow;
      if (DOM.enableStrokeCheck) DOM.enableStrokeCheck.checked = layer.hasStroke;
      if (DOM.strokeOptionsContainer) DOM.strokeOptionsContainer.style.display = layer.hasStroke ? 'block' : 'none';
      if (DOM.strokeColorPicker) DOM.strokeColorPicker.value = layer.strokeColor.startsWith('#') ? layer.strokeColor : '#000000';
      if (DOM.strokeColorHex) DOM.strokeColorHex.value = layer.strokeColor;
    }
  };

  /* ==========================================================================
     9. MOTOR DE EXPORTAÇÃO E RENDERIZAÇÃO HIGH-RES (1080x1920 AUTO-FIT & WORD-WRAP)
     ========================================================================== */
  const CanvasExporter = {
    renderFullResolution() {
      const canvas = DOM.exportCanvas;
      const ctx = canvas.getContext('2d');
      const w = CONFIG.CANVAS_WIDTH;
      const h = CONFIG.CANVAS_HEIGHT;

      ctx.clearRect(0, 0, w, h);

      // 1. Desenha Fundo
      if (AppState.backgroundGradient) {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        if (AppState.backgroundGradient.includes('#4f46e5')) {
          grad.addColorStop(0, '#4f46e5'); grad.addColorStop(1, '#06b6d4');
        } else if (AppState.backgroundGradient.includes('#831843')) {
          grad.addColorStop(0, '#831843'); grad.addColorStop(1, '#be185d');
        } else if (AppState.backgroundGradient.includes('#14532d')) {
          grad.addColorStop(0, '#14532d'); grad.addColorStop(1, '#059669');
        } else if (AppState.backgroundGradient.includes('#78350f')) {
          grad.addColorStop(0, '#78350f'); grad.addColorStop(1, '#d97706');
        } else {
          grad.addColorStop(0, '#1e1b4b'); grad.addColorStop(1, '#0f172a');
        }
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = AppState.backgroundColor;
      }
      ctx.fillRect(0, 0, w, h);

      // 2. Desenha Imagem do Produto (Escala Proporcional Rigorosa sem Distorção)
      if (AppState.bgImage) {
        ctx.save();
        const b = AppState.imageTransform.brightness;
        const c = AppState.imageTransform.contrast;
        const s = AppState.imageTransform.saturation;
        ctx.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;

        const img = AppState.bgImage;
        const naturalW = img.naturalWidth || img.width;
        const naturalH = img.naturalHeight || img.height;

        const baseScale = getBaseScale(img, AppState.currentFitMode);
        const totalScale = baseScale * AppState.imageTransform.zoom;

        const imgW = naturalW * totalScale;
        const imgH = naturalH * totalScale;

        const centerX = (w - imgW) / 2 + AppState.imageTransform.panX;
        const centerY = (h - imgH) / 2 + AppState.imageTransform.panY;

        ctx.drawImage(img, centerX, centerY, imgW, imgH);
        ctx.restore();
      }

      // 3. Vinheta
      if (AppState.overlayDarkness > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${AppState.overlayDarkness / 100})`;
        ctx.fillRect(0, 0, w, h);
      }

      // 4. Desenha Camadas de Texto com Auto-fit, Word-wrap e Contenção Estrita 1080x1920
      const displayW = DOM.storyCanvasContainer.clientWidth || 360;
      const exportScale = CONFIG.CANVAS_WIDTH / displayW;

      const sortedLayers = [...AppState.textLayers].sort((a, b) => a.zIndex - b.zIndex);

      sortedLayers.forEach(layer => {
        ctx.save();

        let realX = (layer.x / 100) * w;
        let realY = (layer.y / 100) * h;

        // Se for Camada de Imagem / Logo
        if (layer.type === 'image') {
          const destW = (layer.width || 120) * exportScale;
          const destH = (layer.height || 120) * exportScale;

          ctx.translate(realX, realY);
          ctx.rotate(((layer.rotation || 0) * Math.PI) / 180);

          if (layer.hasShadow) {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
            ctx.shadowBlur = 10 * exportScale;
            ctx.shadowOffsetY = 4 * exportScale;
          }

          if (layer.imgElement && layer.imgElement.complete) {
            ctx.drawImage(layer.imgElement, -destW / 2, -destH / 2, destW, destH);
          } else if (layer.imgUrl) {
            const fallbackImg = new Image();
            fallbackImg.src = layer.imgUrl;
            ctx.drawImage(fallbackImg, -destW / 2, -destH / 2, destW, destH);
          }

          ctx.restore();
          return;
        }

        const targetFontSize = Math.round(layer.fontSize * exportScale);

        // 2. Fim do Esmagamento Vertical:
        // A largura máxima automática é fixada em w * 0.90 ou layer.customWidth
        let maxAllowedWidth = w * 0.90;
        if (layer.customWidth) {
          maxAllowedWidth = layer.customWidth * exportScale;
        }

        // Executa algoritmo de quebra de linhas e auto-fit de fonte
        const layout = wrapAndFitCanvasText(
          ctx,
          layer.text,
          maxAllowedWidth,
          targetFontSize,
          layer.fontFamily,
          layer.fontWeight,
          layer.fontStyle,
          layer.textTransform,
          layer.hasBg,
          layer.bgPadding * exportScale,
          layer.bgRadius * exportScale,
          14,
          (layer.letterSpacing || 0) * exportScale,
          layer.lineHeight || 1.25
        );

        ctx.translate(realX, realY);
        ctx.rotate((layer.rotation * Math.PI) / 180);

        // Desenha Fundo de Destaque (Badge)
        if (layer.hasBg) {
          ctx.fillStyle = layer.bgColor;
          drawRoundedRect(ctx, -layout.badgeW / 2, -layout.badgeH / 2, layout.badgeW, layout.badgeH, layout.badgeRadius);
          ctx.fill();
        }

        // Aplica Sombra
        if (layer.hasShadow) {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
          ctx.shadowBlur = 10 * exportScale;
          ctx.shadowOffsetY = 4 * exportScale;
        }

        ctx.font = `${layer.fontStyle} ${layer.fontWeight} ${layout.fontSize}px ${layer.fontFamily.replace(/"/g, '')}`;
        if ('letterSpacing' in ctx) {
          ctx.letterSpacing = `${(layer.letterSpacing || 0) * exportScale}px`;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Desenha Linhas de Texto
        const startY = -(layout.totalHeight / 2) + (layout.lineHeight / 2);
        layout.lines.forEach((line, index) => {
          const lineY = startY + (index * layout.lineHeight);

          if (layer.hasStroke) {
            ctx.strokeStyle = layer.strokeColor;
            ctx.lineWidth = Math.max(2, 3 * exportScale);
            ctx.strokeText(line, 0, lineY);
          }

          ctx.fillStyle = layer.color;
          ctx.fillText(line, 0, lineY);
        });

        ctx.restore();
      });

      return canvas;
    },

    exportAsPNG() {
      if (AppState.isExporting) return;
      AppState.isExporting = true;

      const exportButtons = [DOM.exportStoryBtn, DOM.downloadFromPreviewBtn];
      exportButtons.forEach(btn => {
        if (btn) {
          btn.disabled = true;
          const label = btn.querySelector('.btn-label-export');
          if (label) label.textContent = 'Gerando imagem...';
        }
      });

      try {
        let canvas;
        try {
          canvas = this.renderFullResolution();
        } catch (renderErr) {
          console.error('Erro de renderização/memória ao gerar Canvas 1080x1920:', renderErr);
          showToast('Memória insuficiente no dispositivo para exportar em 1080x1920.', 'error');
          this.resetExportButtons(exportButtons);
          return;
        }

        canvas.toBlob(async (blob) => {
          try {
            if (!blob) {
              throw new Error('Falha ao gerar blob de imagem.');
            }

            const fileName = sanitizeFileName(AppState.projectTitle);
            await this.saveCurrentStoryToHistory(canvas);

            // 1. Prioridade: Web Share API nativa para Mobile (Blindagem Estrita de Tipo para Contexto Inseguro)
            if (
              typeof navigator !== 'undefined' &&
              typeof navigator.share === 'function' &&
              typeof navigator.canShare === 'function'
            ) {
              try {
                const file = new File([blob], fileName, { type: 'image/png' });
                if (navigator.canShare({ files: [file] })) {
                  await navigator.share({
                    title: AppState.projectTitle || 'Story do Instagram',
                    text: 'Story criado no StoryCraft 9:16',
                    files: [file]
                  });
                  showToast('Arte compartilhada com sucesso!');
                  return;
                }
              } catch (shareErr) {
                if (shareErr.name === 'AbortError') {
                  showToast('Compartilhamento cancelado.');
                  return;
                }
                console.warn('Web Share falhou ou foi dispensado, prosseguindo com fallback Base64:', shareErr);
              }
            }

            // 2. Fallback: Converte Blob para Base64 (FileReader) e tenta abrir em nova aba ou link de download
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64Data = reader.result;
              try {
                // Tenta abrir em nova aba no mobile para salvar segurando o dedo
                if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
                  const newWindow = window.open();
                  if (newWindow) {
                    newWindow.document.write(`
                      <!DOCTYPE html>
                      <html>
                        <head>
                          <title>${fileName}</title>
                          <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        </head>
                        <body style="margin:0;background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#fff;font-family:sans-serif;">
                          <p style="padding:12px 16px;text-align:center;font-size:14px;color:#94a3b8;">Toque e segure na imagem abaixo para <strong>Salvar no Rolo de Fotos</strong>.</p>
                          <img src="${base64Data}" style="max-width:90vw;max-height:82vh;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.8);" alt="Story Exportado">
                        </body>
                      </html>
                    `);
                    showToast('Imagem pronta! Segure na foto para salvar.');
                    return;
                  }
                }

                // Fallback padrão via tag <a>
                const link = document.createElement('a');
                link.download = fileName;
                link.href = base64Data;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                showToast('Story 1080x1920 exportado com sucesso!');
              } catch (fallbackErr) {
                console.warn('Fallback Base64 falhou, usando blob url:', fallbackErr);
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = fileName;
                link.href = url;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                showToast('Story 1080x1920 exportado com sucesso!');
              }
            };
            reader.onerror = () => {
              throw new Error('Falha ao processar arquivo para download.');
            };
            reader.readAsDataURL(blob);

          } catch (err) {
            console.error('Erro no download:', err);
            showToast('Não foi possível concluir o download da imagem.', 'error');
          } finally {
            this.resetExportButtons(exportButtons);
          }
        }, 'image/png');
      } catch (err) {
        console.error('Erro na exportação PNG:', err);
        showToast('Não foi possível gerar a imagem em alta resolução.', 'error');
        this.resetExportButtons(exportButtons);
      }
    },

    resetExportButtons(buttons) {
      AppState.isExporting = false;
      buttons.forEach(btn => {
        if (btn) {
          btn.disabled = false;
          const label = btn.querySelector('.btn-label-export');
          if (label) {
            label.textContent = btn === DOM.exportStoryBtn ? 'Baixar Story (PNG 1080x1920)' : 'Baixar Imagem PNG';
          }
        }
      });
    },

    async saveCurrentStoryToHistory(canvas) {
      try {
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 200;
        thumbCanvas.height = 355; // 9:16
        const tctx = thumbCanvas.getContext('2d');
        tctx.drawImage(canvas, 0, 0, 200, 355);
        const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.85);

        // 5. Otimização de Payload para Mobile: Removemos bgImageDataUrl pesado do state
        const lightweightState = {
          projectTitle: AppState.projectTitle,
          imageTransform: { ...AppState.imageTransform },
          backgroundColor: AppState.backgroundColor,
          backgroundGradient: AppState.backgroundGradient,
          overlayDarkness: AppState.overlayDarkness,
          textLayers: JSON.parse(JSON.stringify(AppState.textLayers))
        };

        const storyRecord = {
          id: 'story_' + Date.now(),
          timestamp: Date.now(),
          title: AppState.projectTitle,
          dateFormatted: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()),
          thumbnail: thumbnail,
          state: lightweightState
        };

        await DB.saveStory(storyRecord);
        HistoryController.refreshList();
      } catch (err) {
        console.warn('Não foi possível salvar no histórico automático:', err);
      }
    }
  };

  /* ==========================================================================
     10. CONTROLADOR DE HISTÓRICO (IndexedDB Gallery)
     ========================================================================== */
  const HistoryController = {
    async init() {
      try {
        if (DOM.clearAllHistoryBtn) {
          DOM.clearAllHistoryBtn.addEventListener('click', () => this.clearAll());
        }
        await this.refreshList();
      } catch (err) {
        console.error('[HistoryController] Erro no init:', err);
      } finally {
        if (DOM.historyLoadingIndicator) DOM.historyLoadingIndicator.style.display = 'none';
      }
    },

    async refreshList() {
      if (DOM.historyLoadingIndicator) DOM.historyLoadingIndicator.style.display = 'flex';

      try {
        const stories = await DB.getAllStories();
        if (DOM.historyCountBadge) DOM.historyCountBadge.textContent = stories.length;

        if (!stories || stories.length === 0) {
          if (DOM.emptyHistoryMsg) DOM.emptyHistoryMsg.style.display = 'block';
          if (DOM.historyListContainer) DOM.historyListContainer.querySelectorAll('.history-card-item').forEach(el => el.remove());
          return;
        }

        if (DOM.emptyHistoryMsg) DOM.emptyHistoryMsg.style.display = 'none';
        if (DOM.historyListContainer) DOM.historyListContainer.querySelectorAll('.history-card-item').forEach(el => el.remove());

        stories.forEach(story => {
          const item = document.createElement('div');
          item.className = 'history-card-item';

          item.innerHTML = `
            <div class="history-card-thumb" aria-hidden="true">
              <img src="${story.thumbnail}" alt="${story.title}">
            </div>
            <div class="history-card-details">
              <span class="history-card-title">${story.title || 'Arte sem título'}</span>
              <span class="history-card-date">${story.dateFormatted}</span>
              <div class="history-card-actions">
                <button class="btn btn-primary btn-xs btn-restore-history" aria-label="Editar arte ${story.title}">Editar</button>
                <button class="btn btn-outline btn-xs btn-download-history" aria-label="Baixar arte ${story.title}">Baixar</button>
                <button class="btn btn-ghost btn-xs btn-delete-history" aria-label="Excluir arte ${story.title}">✕</button>
              </div>
            </div>
          `;

          item.querySelector('.btn-restore-history').addEventListener('click', () => {
            this.restoreStory(story);
          });

          item.querySelector('.btn-download-history').addEventListener('click', () => {
            this.downloadStoryDirectly(story);
          });

          item.querySelector('.btn-delete-history').addEventListener('click', async () => {
            try {
              await DB.deleteStory(story.id);
              this.refreshList();
              showToast('Arte removida do histórico.');
            } catch (err) {
              console.error('Erro ao excluir arte:', err);
              showToast('Não foi possível excluir o item do histórico.', 'error');
            }
          });

          DOM.historyListContainer.appendChild(item);
        });
      } catch (err) {
        console.error('Erro ao atualizar histórico:', err);
        showToast('Não foi possível carregar o histórico de artes.', 'error');
      } finally {
        DOM.historyLoadingIndicator.style.display = 'none';
      }
    },

    async restoreStory(story) {
      try {
        const state = story.state;
        if (!state) return;

        AppState.projectTitle = state.projectTitle || 'Arte Restaurada';
        DOM.projectTitleInput.value = AppState.projectTitle;

        AppState.imageTransform = state.imageTransform || AppState.imageTransform;
        AppState.backgroundColor = state.backgroundColor || '#0f172a';
        AppState.backgroundGradient = state.backgroundGradient || null;
        AppState.overlayDarkness = state.overlayDarkness || 0;
        AppState.textLayers = state.textLayers || [];

        if (state.bgImageDataUrl) {
          BackgroundController.setImageFromDataUrl(state.bgImageDataUrl, AppState.projectTitle);
        } else {
          AppState.bgImage = null;
          AppState.bgImageDataUrl = null;
          BackgroundController.render();
        }

        TextLayerManager.renderLayers();
        TextLayerManager.selectLayer(AppState.textLayers[0]?.id || null);
        showToast(`Arte "${story.title}" carregada no editor!`);
      } catch (err) {
        console.error('Erro ao restaurar story:', err);
        showToast('Não foi possível restaurar a arte selecionada.', 'error');
      }
    },

    downloadStoryDirectly(story) {
      try {
        const link = document.createElement('a');
        link.download = sanitizeFileName(story.title);
        link.href = story.thumbnail;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        console.error('Erro ao baixar thumbnail:', err);
        showToast('Não foi possível baixar o arquivo.', 'error');
      }
    },

    async clearAll() {
      try {
        if (confirm('Tem certeza de que deseja apagar todo o histórico de artes?')) {
          await DB.clearAll();
          await this.refreshList();
          showToast('Histórico limpo com sucesso.');
        }
      } catch (err) {
        console.error('Erro ao limpar todo histórico:', err);
        showToast('Não foi possível limpar o histórico.', 'error');
      }
    }
  };

  /* ==========================================================================
     11. MODAL DE PRÉ-VISUALIZAÇÃO (SIMULADOR DE INSTAGRAM STORY CONTIDO)
     ========================================================================== */
  const PreviewController = {
    init() {
      this.bindEvents();
    },

    bindEvents() {
      if (DOM.openPreviewModalBtn) DOM.openPreviewModalBtn.addEventListener('click', () => this.open());
      if (DOM.closePreviewModalBtn) DOM.closePreviewModalBtn.addEventListener('click', () => this.close());
      if (DOM.closePreviewBtn2) DOM.closePreviewBtn2.addEventListener('click', () => this.close());
      if (DOM.closePreviewBackdrop) DOM.closePreviewBackdrop.addEventListener('click', () => this.close());

      if (DOM.toggleIgUiCheck) {
        DOM.toggleIgUiCheck.addEventListener('change', (e) => {
          if (DOM.instagramUiOverlay) DOM.instagramUiOverlay.style.display = e.target.checked ? 'flex' : 'none';
        });
      }

      if (DOM.downloadFromPreviewBtn) {
        DOM.downloadFromPreviewBtn.addEventListener('click', () => {
          CanvasExporter.exportAsPNG();
        });
      }
    },

    open() {
      try {
        // 2. Relógio Dinâmico (captura a hora atual do sistema no formato HH:MM)
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const currentTimeStr = `${hours}:${minutes}`;

        if (DOM.previewModal) {
          const igTimeEl = DOM.previewModal.querySelector('.ig-time');
          if (igTimeEl) {
            igTimeEl.textContent = currentTimeStr;
          }
        }

        const canvas = CanvasExporter.renderFullResolution();
        if (DOM.previewRenderedImage && canvas) {
          DOM.previewRenderedImage.src = canvas.toDataURL('image/png');
        }
        if (DOM.previewModal) DOM.previewModal.style.display = 'flex';
      } catch (err) {
        console.error('Erro ao abrir preview:', err);
        showToast('Não foi possível abrir a pré-visualização.', 'error');
      }
    },

    close() {
      if (DOM.previewModal) DOM.previewModal.style.display = 'none';
    }
  };

  /* ==========================================================================
     12. UTILITÁRIOS GLOBAIS, FONTES DINÂMICAS, ESCALA PROPORCIONAL E TOAST
     ========================================================================== */

  /**
   * Mapeamento de famílias do Google Fonts para download dinâmico sob demanda
   */
  const GOOGLE_FONTS_CONFIG = {
    'Montserrat': 'Montserrat:wght@400;600;700;800;900',
    'Poppins': 'Poppins:wght@400;600;700;800;900',
    'Inter': 'Inter:wght@400;500;600;700;800',
    'Outfit': 'Outfit:wght@600;700;800;900',
    'Roboto': 'Roboto:wght@400;500;700;900',
    'Bebas Neue': 'Bebas+Neue',
    'Oswald': 'Oswald:wght@500;600;700',
    'Anton': 'Anton',
    'Playfair Display': 'Playfair+Display:ital,wght@0,700;1,700',
    'Cinzel': 'Cinzel:wght@700;800',
    'Lora': 'Lora:ital,wght@0,600;1,600',
    'Nunito': 'Nunito:wght@700;800;900',
    'Quicksand': 'Quicksand:wght@600;700',
    'Caveat': 'Caveat:wght@700',
    'Pacifico': 'Pacifico',
    'Dancing Script': 'Dancing+Script:wght@700',
    'Great Vibes': 'Great+Vibes'
  };

  const dynamicallyLoadedFonts = new Set(['Montserrat']);

  /**
   * Injeta a tag <link> do Google Fonts apenas quando o usuário seleciona uma fonte
   */
  async function loadGoogleFontDynamically(fontName) {
    if (!fontName || dynamicallyLoadedFonts.has(fontName)) return;
    const fontSpec = GOOGLE_FONTS_CONFIG[fontName];
    if (!fontSpec) return;

    try {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${fontSpec}&display=swap`;
      document.head.appendChild(link);
      dynamicallyLoadedFonts.add(fontName);

      if (document.fonts) {
        await document.fonts.load(`16px "${fontName}"`);
      }
    } catch (e) {
      console.warn('Aviso ao carregar fonte dinamicamente:', fontName, e);
    }
  }

  /**
   * Carrega arquivos de fonte customizada (.ttf, .otf, .woff) via FontFace API
   */
  async function loadCustomFontFile(file) {
    if (!file) return;
    try {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const customFontFamily = `Custom_${cleanName}`;
      const arrayBuffer = await file.arrayBuffer();

      const fontFace = new FontFace(customFontFamily, arrayBuffer);
      const loadedFace = await fontFace.load();
      document.fonts.add(loadedFace);

      let customOptgroup = DOM.fontFamilySelect.querySelector('optgroup[data-custom-group="true"]');
      if (!customOptgroup) {
        customOptgroup = document.createElement('optgroup');
        customOptgroup.label = '📁 Fontes Customizadas';
        customOptgroup.setAttribute('data-custom-group', 'true');
        DOM.fontFamilySelect.insertBefore(customOptgroup, DOM.fontFamilySelect.firstChild);
      }

      const fontVal = `'${customFontFamily}', sans-serif`;
      const opt = document.createElement('option');
      opt.value = fontVal;
      opt.textContent = `${file.name.replace(/\.[^/.]+$/, '')} (Custom)`;
      opt.selected = true;
      customOptgroup.appendChild(opt);

      if (AppState.selectedLayerId) {
        const activeLayer = AppState.textLayers.find(l => l.id === AppState.selectedLayerId);
        if (activeLayer) {
          activeLayer.fontFamily = fontVal;
          TextLayerManager.renderLayers();
        }
      }

      showToast(`Fonte customizada "${file.name}" carregada com sucesso!`);
    } catch (err) {
      console.error('Erro ao processar fonte customizada via FontFace API:', err);
      showToast('Não foi possível carregar o arquivo de fonte.', 'error');
    }
  }

  /**
   * Calcula a escala base proporcional para a foto de fundo (sem distorção)
   * Garante que a foto mantenha a proporção original perfeita (width / height)
   */
  function getBaseScale(img, mode = 'cover') {
    if (!img) return 1;
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;
    if (!imgW || !imgH) return 1;

    const scaleX = CONFIG.CANVAS_WIDTH / imgW;
    const scaleY = CONFIG.CANVAS_HEIGHT / imgH;

    if (mode === 'contain') {
      return Math.min(scaleX, scaleY);
    } else if (mode === 'center') {
      return Math.min(1, Math.min(scaleX, scaleY));
    } else {
      // 'cover' (default) - Preenche toda a tela 9:16 mantendo a proporção exata
      return Math.max(scaleX, scaleY);
    }
  }

  /**
   * Algoritmo de Auto-Fit e Word-Wrapping para Canvas 2D
   * Garante que textos longos quebrem palavras e ajustem o tamanho da fonte
   * para caber 100% dentro dos limites do Story (1080x1920) sem nenhum corte.
   */
  function wrapAndFitCanvasText(
    ctx,
    text,
    maxAllowedWidth,
    initialFontSize,
    fontFamily,
    fontWeight,
    fontStyle,
    textTransform,
    hasBg,
    bgPadding,
    bgRadius,
    minFontSize = 14,
    letterSpacing = 0,
    lineHeightMultiplier = 1.25
  ) {
    let displayText = text || '';
    displayText = displayText.replace(/↻/g, '').trim();
    if (textTransform === 'uppercase') {
      displayText = displayText.toUpperCase();
    }

    const padX = hasBg ? bgPadding * 1.5 : 0;
    const padY = hasBg ? bgPadding : 0;
    const effectiveMaxTextWidth = Math.max(80, maxAllowedWidth - (padX * 2));

    let currentFontSize = initialFontSize;
    let lines = [];
    let longestLineWidth = 0;

    // Aplica letterSpacing no contexto do Canvas se suportado pelo navegador
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = `${letterSpacing || 0}px`;
    }

    const computeLines = (fSize) => {
      ctx.font = `${fontStyle} ${fontWeight} ${fSize}px ${fontFamily.replace(/"/g, '')}`;
      if ('letterSpacing' in ctx) {
        ctx.letterSpacing = `${letterSpacing || 0}px`;
      }
      const rawParagraphs = displayText.split('\n');
      const resultLines = [];

      for (const para of rawParagraphs) {
        if (!para.trim()) {
          resultLines.push('');
          continue;
        }

        const words = para.split(/\s+/);
        let currentLine = words[0] || '';

        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          const testLine = currentLine + ' ' + word;
          const metrics = ctx.measureText(testLine);

          if (metrics.width <= effectiveMaxTextWidth) {
            currentLine = testLine;
          } else {
            resultLines.push(currentLine);
            currentLine = word;
          }
        }
        if (currentLine) {
          resultLines.push(currentLine);
        }
      }
      return resultLines;
    };

    // Ajuste iterativo: se qualquer linha for maior que effectiveMaxTextWidth, reduz a fonte
    let attempts = 0;
    while (attempts < 15) {
      lines = computeLines(currentFontSize);
      longestLineWidth = 0;

      for (const line of lines) {
        const w = ctx.measureText(line).width;
        if (w > longestLineWidth) {
          longestLineWidth = w;
        }
      }

      if (longestLineWidth <= effectiveMaxTextWidth || currentFontSize <= minFontSize) {
        break;
      }

      // Reduz proporcionalmente
      const ratio = effectiveMaxTextWidth / longestLineWidth;
      currentFontSize = Math.max(minFontSize, Math.floor(currentFontSize * Math.min(0.92, ratio)));
      attempts++;
    }

    const lineHeight = currentFontSize * (lineHeightMultiplier || 1.25);
    const totalHeight = lines.length * lineHeight;
    const badgeW = longestLineWidth + (padX * 2);
    const badgeH = totalHeight + (padY * 2);

    return {
      lines,
      fontSize: currentFontSize,
      lineHeight,
      maxLineWidth: longestLineWidth,
      totalHeight,
      badgeW,
      badgeH,
      padX,
      padY,
      badgeRadius: bgRadius
    };
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    radius = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function debounce(fn, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function sanitizeFileName(title) {
    const raw = title || 'story-produto';
    const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const slug = normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .substring(0, 40) || 'story';
    
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    return `story-${slug}-${dateStr}.png`;
  }

  let toastTimer = null;
  function showToast(msg, type = 'success') {
    DOM.toastMessage.textContent = msg;

    if (type === 'error') {
      DOM.toastNotification.classList.add('toast-error');
      DOM.toastIcon.textContent = '✕';
    } else {
      DOM.toastNotification.classList.remove('toast-error');
      DOM.toastIcon.textContent = '✓';
    }

    DOM.toastNotification.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      DOM.toastNotification.classList.remove('show');
    }, 3200);
  }

  /* ==========================================================================
     SISTEMA DE GAVETAS LATERAIS MOBILE (SIDE DRAWERS & BACKDROP)
     ========================================================================== */
  function getOrCreateMobileBackdrop() {
    let backdrop = document.querySelector('.mobile-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'mobile-backdrop';
      document.body.appendChild(backdrop);

      backdrop.addEventListener('click', () => {
        closeAllDrawers();
      });
    }
    return backdrop;
  }

  function openLeftDrawer() {
    const sidebarTools = document.querySelector('.sidebar-tools');
    const inspectorPanel = document.querySelector('.inspector-panel');
    const backdrop = getOrCreateMobileBackdrop();

    if (sidebarTools) sidebarTools.classList.add('drawer-left-open');
    if (inspectorPanel) inspectorPanel.classList.remove('drawer-right-open');
    if (backdrop) backdrop.classList.add('backdrop-visible');
  }

  function openRightDrawer() {
    const sidebarTools = document.querySelector('.sidebar-tools');
    const inspectorPanel = document.querySelector('.inspector-panel');
    const backdrop = getOrCreateMobileBackdrop();

    if (inspectorPanel) inspectorPanel.classList.add('drawer-right-open');
    if (sidebarTools) sidebarTools.classList.remove('drawer-left-open');
    if (backdrop) backdrop.classList.add('backdrop-visible');
  }

  function closeAllDrawers() {
    const sidebarTools = document.querySelector('.sidebar-tools');
    const inspectorPanel = document.querySelector('.inspector-panel');
    const backdrop = document.querySelector('.mobile-backdrop');

    if (sidebarTools) sidebarTools.classList.remove('drawer-left-open');
    if (inspectorPanel) inspectorPanel.classList.remove('drawer-right-open');
    if (backdrop) backdrop.classList.remove('backdrop-visible');
  }

  function setupMobileDrawerActions() {
    const mobileActionsContainer = document.getElementById('mobileDrawerActions');
    if (mobileActionsContainer && !mobileActionsContainer.hasChildNodes()) {
      const btnExport = document.createElement('button');
      btnExport.className = 'btn btn-primary btn-block';
      btnExport.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        <span>Baixar Story (PNG 1080x1920)</span>
      `;
      btnExport.addEventListener('click', () => {
        closeAllDrawers();
        CanvasExporter.exportAsPNG();
      });

      const btnSaveProfile = document.createElement('button');
      btnSaveProfile.className = 'btn btn-accent-outline btn-block';
      btnSaveProfile.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        <span>Salvar Textos no Perfil</span>
      `;
      btnSaveProfile.addEventListener('click', () => {
        ProfileManager.createProfileFromCurrentState();
      });

      mobileActionsContainer.appendChild(btnExport);
      mobileActionsContainer.appendChild(btnSaveProfile);
    }
  }

  function switchToTab(tabId) {
    DOM.navTabs.forEach(t => {
      const isTarget = t.getAttribute('data-tab') === tabId;
      t.classList.toggle('active', isTarget);
      t.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    });
    DOM.tabPanels.forEach(p => {
      p.classList.toggle('active', p.id === tabId);
    });
  }

  function setupGeneralUI() {
    DOM.navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTabId = tab.getAttribute('data-tab');
        switchToTab(targetTabId);
      });
    });

    // 1. Logo transformada em botão de Menu Hamburger no mobile
    const logoArea = document.querySelector('.logo-area');
    if (logoArea) {
      logoArea.addEventListener('click', (e) => {
        if (window.innerWidth <= 860) {
          e.preventDefault();
          openLeftDrawer();
        }
      });
    }

    // 2. Botões de fechar gavetas (✕)
    const closeLeftDrawerBtn = document.getElementById('closeLeftDrawerBtn');
    if (closeLeftDrawerBtn) {
      closeLeftDrawerBtn.addEventListener('click', () => closeAllDrawers());
    }

    const closeRightDrawerBtn = document.getElementById('closeRightDrawerBtn');
    if (closeRightDrawerBtn) {
      closeRightDrawerBtn.addEventListener('click', () => closeAllDrawers());
    }

    // 3. Inicializa Backdrop e Ações da Gaveta
    getOrCreateMobileBackdrop();
    setupMobileDrawerActions();
    window.addEventListener('resize', () => setupMobileDrawerActions());

    // 4. Barra de Ações Rápidas Mobile (Quick Actions Bar)
    const quickAddTextBtn = document.getElementById('quickAddTextBtn');
    if (quickAddTextBtn) {
      quickAddTextBtn.addEventListener('click', () => {
        TextLayerManager.addLayer({ text: 'Novo Texto', fontSize: 26, y: 50 });
      });
    }

    const quickOpenStickersBtn = document.getElementById('quickOpenStickersBtn');
    if (quickOpenStickersBtn) {
      quickOpenStickersBtn.addEventListener('click', () => {
        switchToTab('tab-stickers');
        openLeftDrawer();
      });
    }

    const quickOpenProfilesBtn = document.getElementById('quickOpenProfilesBtn');
    if (quickOpenProfilesBtn) {
      quickOpenProfilesBtn.addEventListener('click', () => {
        switchToTab('tab-profiles');
        openLeftDrawer();
      });
    }

    const quickOpenHistoryBtn = document.getElementById('quickOpenHistoryBtn');
    if (quickOpenHistoryBtn) {
      quickOpenHistoryBtn.addEventListener('click', () => {
        switchToTab('tab-history');
        openLeftDrawer();
      });
    }

    const quickOpenRightBtn = document.getElementById('quickOpenRightBtn');
    if (quickOpenRightBtn) {
      quickOpenRightBtn.addEventListener('click', () => {
        openRightDrawer();
      });
    }

    // 5. Botão Flutuante (FAB) para Adicionar Foto no Mobile
    const fabAddPhoto = document.getElementById('fabAddPhoto');
    if (fabAddPhoto) {
      fabAddPhoto.addEventListener('click', () => {
        const imageFileInput = document.getElementById('imageFileInput');
        if (imageFileInput) imageFileInput.click();
      });
    }

    // 6. Alternador das Áreas Seguras do Instagram (Desktop e Mobile)
    const btnToggleSafeZone = document.getElementById('btnToggleSafeZone');
    const updateSafeZonesUI = () => {
      const guide = document.getElementById('safeZonesGuide') || document.querySelector('.safe-zones-guide') || document.querySelector('.safe-zone-guides');
      if (guide) {
        const isHidden = guide.classList.toggle('hidden');
        if (btnToggleSafeZone) {
          btnToggleSafeZone.textContent = isHidden ? 'Mostrar Guias' : 'Ocultar Guias';
        }
        AppState.showSafeZones = !isHidden;
        if (DOM.toggleSafeZoneBtn) {
          DOM.toggleSafeZoneBtn.classList.toggle('active', !isHidden);
        }
      }
    };

    if (btnToggleSafeZone) {
      btnToggleSafeZone.addEventListener('click', updateSafeZonesUI);
    }

    if (DOM.toggleSafeZoneBtn) {
      DOM.toggleSafeZoneBtn.addEventListener('click', updateSafeZonesUI);
    }

    // 7. Botão de Desfazer (Undo)
    if (DOM.btnUndo) {
      DOM.btnUndo.addEventListener('click', () => ActionHistory.undo());
    }
    if (DOM.mobileUndoBtn) {
      DOM.mobileUndoBtn.addEventListener('click', () => ActionHistory.undo());
    }

    // Atalho global de teclado para Desfazer (Ctrl+Z ou Cmd+Z)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
          e.preventDefault();
          ActionHistory.undo();
        }
      }
    });

    ActionHistory.updateUI();

    if (DOM.resetCanvasBtn) {
      DOM.resetCanvasBtn.addEventListener('click', () => {
        if (confirm('Deseja limpar todos os elementos e recomeçar a arte?')) {
          ActionHistory.saveState();
          AppState.bgImage = null;
          AppState.bgImageDataUrl = null;
          AppState.textLayers = [];
          AppState.selectedLayerId = null;
          if (DOM.canvasEmptyState) DOM.canvasEmptyState.classList.remove('hidden');
          BackgroundController.resetTransform();
          TextLayerManager.renderLayers();
          InspectorController.update();
          showToast('Canvas limpo com sucesso.');
        }
      });
    }

    if (DOM.exportStoryBtn) {
      DOM.exportStoryBtn.addEventListener('click', () => {
        CanvasExporter.exportAsPNG();
      });
    }

    if (DOM.projectTitleInput) {
      DOM.projectTitleInput.addEventListener('input', (e) => {
        AppState.projectTitle = e.target.value.trim();
      });
    }

    let currentWorkspaceZoom = 100;
    const updateWorkspaceZoom = (newZoom) => {
      currentWorkspaceZoom = Math.min(Math.max(50, newZoom), 180);
      if (DOM.smartphoneFrame) DOM.smartphoneFrame.style.transform = `scale(${currentWorkspaceZoom / 100})`;
      if (DOM.workspaceZoomPercent) DOM.workspaceZoomPercent.textContent = `${currentWorkspaceZoom}%`;
    };

    if (DOM.zoomInWorkspaceBtn) DOM.zoomInWorkspaceBtn.addEventListener('click', () => updateWorkspaceZoom(currentWorkspaceZoom + 10));
    if (DOM.zoomOutWorkspaceBtn) DOM.zoomOutWorkspaceBtn.addEventListener('click', () => updateWorkspaceZoom(currentWorkspaceZoom - 10));
    if (DOM.fitScreenBtn) DOM.fitScreenBtn.addEventListener('click', () => updateWorkspaceZoom(100));
  }

  // --- CAPTURA GLOBAL DE ERROS E REJEIÇÕES NÃO TRATADAS ---
  window.addEventListener('error', (event) => {
    console.error('Erro global capturado:', event.error || event.message);
    showToast('Ocorreu um erro inesperado na aplicação.', 'error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('Rejeição assíncrona não tratada:', event.reason);
    showToast('Falha em uma operação assíncrona.', 'error');
  });

  // --- BOOTSTRAP RESILIENTE (SAFE BOOT PROTOCOL) ---
  window.addEventListener('DOMContentLoaded', async () => {
    // 2. Destravamento Forçado (Safe Boot Timeout - Kill Switch de 2.5s)
    setTimeout(() => {
      const histEl = document.getElementById('historyLoadingIndicator');
      const profEl = document.getElementById('profilesLoadingIndicator');
      const emptyEl = document.getElementById('canvasEmptyState');
      if (histEl) histEl.style.display = 'none';
      if (profEl) profEl.style.display = 'none';
      if (emptyEl && !AppState.bgImage && (!AppState.textLayers || AppState.textLayers.length === 0)) {
        emptyEl.classList.remove('hidden');
      }
    }, 2500);

    try {
      // 1. Inicialização UI-First (Canvas e Controles imediatos sem bloqueio de rede)
      try {
        BackgroundController.init();
      } catch (bgErr) {
        console.error('[Bootstrap] BackgroundController.init:', bgErr);
      }

      try {
        TextLayerManager.init();
      } catch (tlErr) {
        console.error('[Bootstrap] TextLayerManager.init:', tlErr);
      }

      try {
        InspectorController.init();
      } catch (inspErr) {
        console.error('[Bootstrap] InspectorController.init:', inspErr);
      }

      try {
        PreviewController.init();
      } catch (prevErr) {
        console.error('[Bootstrap] PreviewController.init:', prevErr);
      }

      try {
        setupGeneralUI();
      } catch (uiErr) {
        console.error('[Bootstrap] setupGeneralUI:', uiErr);
      }

      // Carrega o produto de amostra padrão inicial
      try {
        BackgroundController.loadSampleProduct('smartphone');
      } catch (sampleErr) {
        console.warn('[Bootstrap] loadSampleProduct:', sampleErr);
      }

      // 2. Inicialização dos Subsistemas Assíncronos / Storage
      try {
        await ProfileManager.init();
      } catch (profErr) {
        console.warn('[Bootstrap] ProfileManager.init:', profErr);
      }

      try {
        await DB.init();
      } catch (dbErr) {
        console.warn('[Bootstrap] DB.init:', dbErr);
      }

      try {
        await HistoryController.init();
      } catch (histErr) {
        console.warn('[Bootstrap] HistoryController.init:', histErr);
      }

      console.log('StoryCraft inicializado com sucesso (Safe Boot Ativo).');
      showToast('Bem-vindo de volta, João! Pronto para criar?', 'success');
      closeAllDrawers();
    } catch (err) {
      alert('Erro na inicialização: ' + (err && err.message ? err.message : err));
      console.error('Erro crítico na inicialização do StoryCraft:', err);
    } finally {
      // 3. Destravamento Imediato no final do bootstrap
      const histEl = document.getElementById('historyLoadingIndicator');
      const profEl = document.getElementById('profilesLoadingIndicator');
      const emptyEl = document.getElementById('canvasEmptyState');
      if (histEl) histEl.style.display = 'none';
      if (profEl) profEl.style.display = 'none';
      if (emptyEl && !AppState.bgImage && (!AppState.textLayers || AppState.textLayers.length === 0)) {
        emptyEl.classList.remove('hidden');
      }
    }
  });

})();
