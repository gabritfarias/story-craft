# StoryCraft 🎨📱
> Editor profissional de Stories para Instagram (9:16 / 1080x1920) focado em lojistas, criadores de conteúdo e e-commerce.

---

## ✨ Recursos Principais

- **📱 Progressive Web App (PWA) para iOS & Android**:
  - Instalável na Tela de Início do iPhone via Safari (`Adicionar à Tela de Início`).
  - Execução em tela cheia (*standalone*) sem barras de navegação do browser.
  - Ícones em alta definição (`icon-192.png` e `icon-512.png`) e suporte a tema escuro.

- **🤏 Gestos Touch Avançados & Pinça Proporcional (Pinch-to-Zoom)**:
  - Redimensionamento natural com dois dedos ajustando tamanho de fonte e largura da caixa proporcionalmente.
  - Trava de largura lateral (evita que o texto quebre na vertical ao encostar nas bordas).
  - Alças de rotação e redimensionamento lateral intuitivas.

- **↩️ Sistema de Histórico de Ações (Undo / Desfazer)**:
  - Botão de desfazer na barra superior e na barra de ações rápidas mobile.
  - Pilha de estados (*deep clone*) com limite de 20 passos e atalho de teclado `Ctrl + Z` / `Cmd + Z`.
  - Estados visuais dinâmicos (ativo/desabilitado).

- **🔤 Tipografia Rica & Google Fonts Assíncrono**:
  - Catálogo com mais de 16 famílias (Modernas, Serifadas, Impacto, Cursivas e Manuscritas).
  - Carregamento de fontes sob demanda (*non-blocking*) e suporte a upload de fontes customizadas (`.ttf`, `.otf`, `.woff`).

- **⚡ Alta Performance Gráfica (GPU)**:
  - Renderização acelerada por hardware via CSS (`transform: translateZ(0)` e `will-change: transform`).
  - Suavização anti-serrilhado (*subpixel antialiasing*) para 60 FPS fluidos no mobile.

- **🗄️ Backend Node.js com Prisma ORM (SQLite / PostgreSQL)**:
  - Servidor Express estruturado com rotas REST completas (`/api/stories`, `/api/profiles`, `/api/health`).
  - Suporte nativo a SQLite em disco com transição transparente para PostgreSQL (Supabase, Neon, Railway) via `DATABASE_URL`.
  - Resiliência offline: Fallback automático e transparente para IndexedDB/LocalStorage caso o cliente esteja offline.

- **🛡️ Guias de Margem Segura do Instagram (Safe Zones)**:
  - Marcadores de topo (stories/perfil) e rodapé (área de resposta e mensagens) com botão de alternância rápida.

---

## 🚀 Como Rodar Localmente

1. **Clone o repositório**:
   ```bash
   git clone https://github.com/gabritfarias/story-craft.git
   cd story-craft
   ```

2. **Instale as dependências**:
   ```bash
   npm install
   ```

3. **Configure as variáveis de ambiente** (opcional, já vem com `.env.example` pronto):
   ```bash
   cp .env.example .env
   ```
   > Padrão: `PORT=3000` e `DATABASE_URL="file:./dev.db"`

4. **Gere e sincronize o banco de dados Prisma**:
   ```bash
   npx prisma db push
   ```

5. **Inicie o servidor**:
   ```bash
   npm start
   ```

6. **Abra no seu navegador**:
   - Computador: `http://localhost:3000`
   - Celular (na mesma rede Wi-Fi): `http://SEU_IP_LOCAL:3000`

---

## 🌐 Endpoints da API REST

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/health` | Status de integridade do servidor e conexão com o banco |
| `GET` | `/api/stories` | Lista todas as artes salvas (mais recentes primeiro) |
| `POST` | `/api/stories` | Cria ou atualiza uma arte no banco de dados |
| `DELETE` | `/api/stories/:id` | Remove uma arte pelo ID |
| `DELETE` | `/api/stories` | Limpa todo o histórico de artes |
| `GET` | `/api/profiles` | Lista todos os perfis de texto e estilização |
| `POST` | `/api/profiles` | Salva um novo perfil de blocos de texto |
| `PUT` | `/api/profiles/:id` | Atualiza/renomeia um perfil existente |
| `DELETE` | `/api/profiles/:id` | Remove um perfil pelo ID |

---

## 📂 Estrutura do Projeto

```text
story-craft/
├── server.js             # Servidor Node.js / Express & API REST
├── lib/
│   └── prisma.js         # Singleton de conexão do Prisma Client
├── prisma/
│   └── schema.prisma     # Modelos do banco de dados (Story, Profile)
├── index.html            # Interface SPA (PWA & Desktop)
├── style.css             # Glassmorphism, aceleração de GPU e responsividade
├── script.js             # Lógica do Canvas, Camadas, Touch/Pinch, Undo e API Client
├── manifest.json         # Manifesto PWA (Tela Cheia, Ícones e Tema)
├── icon-192.png          # Ícone PWA (192x192 px)
├── icon-512.png          # Ícone PWA (512x512 px)
├── .env.example          # Exemplo de variáveis de ambiente
├── package.json          # Dependências do projeto (Express, Prisma, CORS, Dotenv)
├── .gitignore            # Regras de exclusão do git
└── README.md             # Documentação completa do projeto
```
