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

- **💾 Armazenamento 100% Client-Side (IndexedDB & LocalStorage)**:
  - Sistema de banco de dados no navegador com IndexedDB (e fallback em LocalStorage).
  - Sem necessidade de backend, sem latência e funcionamento offline garantido.

- **🛡️ Guias de Margem Segura do Instagram (Safe Zones)**:
  - Marcadores de topo (stories/perfil) e rodapé (área de resposta e mensagens) com botão de alternância rápida.

---

## 🚀 Como Rodar Localmente / Deploy

### Deploy na Vercel (1 Clique):
A aplicação é 100% estática (SPA). Basta conectar o repositório no dashboard da [Vercel](https://vercel.com) e o deploy será realizado instantaneamente.

### Rodar Localmente:
1. **Clone o repositório**:
   ```bash
   git clone https://github.com/gabritfarias/story-craft.git
   cd story-craft
   ```

2. **Inicie qualquer servidor estático** (ou use `npx serve`):
   ```bash
   npx serve .
   ```

3. **Abra no seu navegador**:
   - Computador: `http://localhost:3000` (ou a porta indicada pelo serve)
   - Celular (na mesma rede Wi-Fi): `http://SEU_IP_LOCAL:3000`

---

## 📂 Estrutura do Projeto

```text
├── index.html          # Ponto de entrada da aplicação (PWA & Desktop)
├── style.css           # Estilos Glassmorphism, animações e aceleração gráfica
├── script.js           # Lógica do Canvas, Camadas, Touch/Pinch, Undo e IndexedDB
├── manifest.json       # Manifesto PWA (Tela Cheia, Ícones e Tema)
├── icon-192.png        # Ícone PWA 192x192
├── icon-512.png        # Ícone PWA 512x512
├── vercel.json         # Configuração de rotas estáticas e cache da Vercel
└── package.json        # Metadados do projeto
```
