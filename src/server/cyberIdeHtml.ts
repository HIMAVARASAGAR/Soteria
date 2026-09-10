export function getCyberIdeHtml(workspacePath: string, workspaceName: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Soteria CyberIDE — ${workspaceName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            cyber: {
              bg: '#0a0d14',
              sidebar: '#0e131f',
              panel: '#121826',
              border: '#1e293b',
              accent: '#00f0ff',
              emerald: '#00ff9d',
              danger: '#ff3366',
              warning: '#ffb800',
              purple: '#b026ff'
            }
          },
          fontFamily: {
            mono: ['"Fira Code"', 'monospace'],
            sans: ['Inter', 'sans-serif']
          }
        }
      }
    }
  </script>
  <style>
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #0a0d14; }
    ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #334155; }
    .glow-cyan { box-shadow: 0 0 15px rgba(0, 240, 255, 0.25); }
    .glow-crimson { box-shadow: 0 0 15px rgba(255, 51, 102, 0.3); }
    .glow-emerald { box-shadow: 0 0 15px rgba(0, 255, 157, 0.25); }
  </style>
</head>
<body class="bg-cyber-bg text-slate-200 h-screen flex flex-col font-sans overflow-hidden select-none">

  <!-- Top Navigation Header -->
  <header class="h-12 border-b border-cyber-border bg-cyber-sidebar flex items-center justify-between px-4 z-20">
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2">
        <span class="text-xl">🛡️</span>
        <span class="font-bold text-base tracking-wider bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
          SOTERIA <span class="text-xs px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 font-mono uppercase tracking-normal">CyberIDE</span>
        </span>
      </div>
      <div class="h-4 w-px bg-cyber-border mx-1"></div>
      <div class="flex items-center gap-1.5 text-xs text-slate-400 bg-cyber-panel px-2.5 py-1 rounded border border-cyber-border">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="font-mono truncate max-w-xs" id="workspaceLabel">${workspaceName}</span>
      </div>
    </div>

    <!-- Center: File Tabs -->
    <div class="flex-1 flex items-center px-4 overflow-x-auto gap-1" id="tabBar">
      <!-- Tabs injected dynamically -->
    </div>

    <!-- Right Controls -->
    <div class="flex items-center gap-2">
      <div id="securityPill" class="flex items-center gap-2 px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-400 text-xs font-semibold cursor-pointer hover:bg-emerald-900/40 transition" onclick="toggleBottomDrawer()">
        <span>🛡️</span>
        <span id="securityPillText">Score: Calculating...</span>
      </div>
      <button onclick="runWorkspaceAudit()" class="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs transition flex items-center gap-1.5 shadow-sm">
        <span>⚡</span> Audit Project
      </button>
      <button onclick="saveActiveFile()" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-cyber-border text-xs transition flex items-center gap-1">
        <span>💾</span> Save
      </button>
      <button onclick="toggleAgentChat()" class="px-2.5 py-1 rounded bg-purple-600/80 hover:bg-purple-600 text-white text-xs font-medium transition flex items-center gap-1.5">
        <span>🤖</span> Soteria AI
      </button>
    </div>
  </header>

  <!-- Main Body Area -->
  <div class="flex-1 flex overflow-hidden relative">

    <!-- Left Sidebar: File Tree -->
    <aside class="w-64 border-r border-cyber-border bg-cyber-sidebar flex flex-col z-10 transition-all duration-200" id="fileSidebar">
      <div class="p-3 border-b border-cyber-border flex items-center justify-between">
        <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Explorer</span>
        <div class="flex items-center gap-1">
          <button onclick="refreshFileTree()" title="Refresh" class="p-1 hover:bg-cyber-panel rounded text-slate-400 hover:text-slate-200 text-xs">🔄</button>
        </div>
      </div>
      <div class="p-2">
        <input type="text" id="fileFilter" placeholder="Filter files..." oninput="filterFiles()" class="w-full bg-cyber-panel border border-cyber-border rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500" />
      </div>
      <div class="flex-1 overflow-y-auto p-2 space-y-0.5 text-xs font-mono" id="fileTreeContainer">
        <div class="text-slate-500 text-center py-4">Loading workspace files...</div>
      </div>
    </aside>

    <!-- Center Workspace (Editor + Bottom Drawer) -->
    <main class="flex-1 flex flex-col min-w-0 bg-cyber-bg relative">
      <!-- Monaco Editor Container -->
      <div class="flex-1 relative" id="editorContainer">
        <div id="monacoEditor" class="absolute inset-0"></div>
        <div id="noFileOpen" class="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-3">
          <div class="text-5xl">🛡️</div>
          <div class="text-lg font-medium text-slate-400">Soteria CyberIDE</div>
          <div class="text-xs max-w-sm text-center text-slate-600">
            Open any file from the explorer on the left to start code editing with real-time cybersecurity diagnostics, or run a project-wide security audit.
          </div>
          <div class="flex gap-2 mt-2">
            <button onclick="runWorkspaceAudit()" class="px-3 py-1.5 rounded bg-cyan-600/20 text-cyan-400 border border-cyan-500/40 text-xs hover:bg-cyan-600/30">Run Security Audit</button>
            <button onclick="exportSbom('cyclonedx')" class="px-3 py-1.5 rounded bg-slate-800 text-slate-300 border border-cyber-border text-xs hover:bg-slate-700">Export CycloneDX SBOM</button>
          </div>
        </div>
      </div>

      <!-- Bottom Security Drawer (SOC Panel) -->
      <div id="bottomDrawer" class="h-64 border-t border-cyber-border bg-cyber-panel flex flex-col transition-all duration-300 z-10">
        <div class="h-9 border-b border-cyber-border bg-cyber-sidebar px-3 flex items-center justify-between">
          <div class="flex items-center gap-2" id="drawerTabs">
            <button class="drawer-tab active px-2.5 py-1 text-xs font-medium rounded text-cyan-400 bg-cyber-panel border border-cyber-border" onclick="switchDrawerTab('overview')">Overview</button>
            <button class="drawer-tab px-2.5 py-1 text-xs font-medium rounded text-slate-400 hover:text-slate-200" onclick="switchDrawerTab('sast')">SAST (<span id="sastCount">0</span>)</button>
            <button class="drawer-tab px-2.5 py-1 text-xs font-medium rounded text-slate-400 hover:text-slate-200" onclick="switchDrawerTab('secrets')">Secrets (<span id="secretsCount">0</span>)</button>
            <button class="drawer-tab px-2.5 py-1 text-xs font-medium rounded text-slate-400 hover:text-slate-200" onclick="switchDrawerTab('taint')">Taint Flows (<span id="taintCount">0</span>)</button>
            <button class="drawer-tab px-2.5 py-1 text-xs font-medium rounded text-slate-400 hover:text-slate-200" onclick="switchDrawerTab('containers')">Containers (<span id="containerCount">0</span>)</button>
            <button class="drawer-tab px-2.5 py-1 text-xs font-medium rounded text-slate-400 hover:text-slate-200" onclick="switchDrawerTab('sbom')">SBOM / SCA</button>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="toggleBottomDrawer()" class="text-slate-400 hover:text-slate-200 text-xs">✕</button>
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-4 text-xs font-sans" id="drawerContent">
          <!-- Populated dynamically -->
        </div>
      </div>
    </main>

    <!-- Right Sidebar: Soteria AI Copilot Chat -->
    <aside class="w-80 border-l border-cyber-border bg-cyber-sidebar flex flex-col z-10 transition-all duration-200" id="agentSidebar">
      <div class="p-3 border-b border-cyber-border flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-base">🤖</span>
          <span class="text-xs font-bold text-purple-400 uppercase tracking-wider">Soteria AI Copilot</span>
        </div>
        <button onclick="toggleAgentChat()" class="text-slate-400 hover:text-slate-200 text-xs">✕</button>
      </div>

      <!-- Chat Messages Container -->
      <div class="flex-1 overflow-y-auto p-3 space-y-3" id="chatMessages">
        <div class="p-3 rounded bg-cyber-panel border border-cyber-border text-xs text-slate-300">
          <div class="font-semibold text-cyan-400 mb-1">🛡️ Soteria Cyber Assistant Ready</div>
          I have full context on your codebase and real-time security diagnostics. You can ask me to remediate vulnerabilities, analyze taint flows, explain CWEs, or generate hardened code.
        </div>
      </div>

      <!-- Quick Action Chips -->
      <div class="px-3 py-2 border-t border-cyber-border bg-cyber-panel/50 flex flex-wrap gap-1.5 text-[11px]">
        <button onclick="sendQuickPrompt('Audit and fix vulnerabilities in the active file')" class="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 border border-cyan-800/40 hover:bg-cyan-950">Fix Active File</button>
        <button onclick="sendQuickPrompt('Explain the dataflow and remediation for detected taint flows')" class="px-2 py-0.5 rounded bg-slate-800 text-purple-300 border border-purple-800/40 hover:bg-purple-950">Explain Taint</button>
        <button onclick="sendQuickPrompt('Generate hardened production Dockerfile with non-root user')" class="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-emerald-800/40 hover:bg-emerald-950">Harden Docker</button>
      </div>

      <!-- Chat Input Box -->
      <div class="p-3 border-t border-cyber-border bg-cyber-sidebar">
        <form onsubmit="handleChatSubmit(event)" class="flex gap-2">
          <input type="text" id="chatInput" placeholder="Ask Soteria AI..." class="flex-1 bg-cyber-panel border border-cyber-border rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500" />
          <button type="submit" class="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition">Send</button>
        </form>
      </div>
    </aside>

  </div>

  <!-- Monaco Editor Loader -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js"></script>

  <script>
    // State management
    let editor = null;
    let activeFile = null;
    let openTabs = [];
    let workspaceAudit = null;
    let fileTreeData = [];
    let isDrawerOpen = true;
    let isAgentOpen = true;

    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });

    require(['vs/editor/editor.main'], function() {
      // Define Cyberpunk dark theme
      monaco.editor.defineTheme('soteriaDark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
          { token: 'keyword', foreground: '00f0ff', fontStyle: 'bold' },
          { token: 'string', foreground: '00ff9d' },
          { token: 'number', foreground: 'ffb800' },
          { token: 'type', foreground: 'b026ff' },
        ],
        colors: {
          'editor.background': '#0a0d14',
          'editor.foreground': '#e2e8f0',
          'editorLineNumber.foreground': '#334155',
          'editorLineNumber.activeForeground': '#00f0ff',
          'editorCursor.foreground': '#00f0ff',
          'editor.lineHighlightBackground': '#121826',
          'editor.selectionBackground': '#1e293b',
        }
      });

      editor = monaco.editor.create(document.getElementById('monacoEditor'), {
        theme: 'soteriaDark',
        fontSize: 13,
        fontFamily: '"Fira Code", monospace',
        fontLigatures: true,
        automaticLayout: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        renderWhitespace: 'selection',
      });

      editor.onDidChangeModelContent(() => {
        if (activeFile) {
          triggerSecurityScanDebounced(activeFile, editor.getValue());
        }
      });

      // Keyboard shortcuts
      window.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          saveActiveFile();
        }
      });

      // Initial load
      refreshFileTree();
      runWorkspaceAudit();
    });

    // File tree fetching
    async function refreshFileTree() {
      try {
        const res = await fetch('/api/files/tree');
        const data = await res.json();
        fileTreeData = data.tree || [];
        renderFileTree(fileTreeData);
      } catch (err) {
        console.error('Failed to load file tree', err);
      }
    }

    function renderFileTree(tree, filter = '') {
      const container = document.getElementById('fileTreeContainer');
      container.innerHTML = '';

      function buildNodes(items, level = 0) {
        const ul = document.createElement('div');
        for (const item of items) {
          if (filter && item.type === 'file' && !item.name.toLowerCase().includes(filter.toLowerCase())) {
            continue;
          }
          const el = document.createElement('div');
          el.className = \`flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-cyber-panel cursor-pointer text-slate-300 hover:text-slate-100 transition pl-\${Math.min(level * 3, 12)}\`;

          const icon = item.type === 'dir' ? '📁' : getFileIcon(item.name);
          el.innerHTML = \`<span>\${icon}</span><span class="truncate">\${item.name}</span>\`;

          if (item.type === 'file') {
            el.onclick = () => openFile(item.path);
          } else if (item.children) {
            el.onclick = (e) => {
              const sub = el.nextElementSibling;
              if (sub) sub.classList.toggle('hidden');
            };
          }
          ul.appendChild(el);

          if (item.children && item.children.length > 0) {
            const subContainer = document.createElement('div');
            subContainer.appendChild(buildNodes(item.children, level + 1));
            ul.appendChild(subContainer);
          }
        }
        return ul;
      }

      container.appendChild(buildNodes(tree));
    }

    function filterFiles() {
      const q = document.getElementById('fileFilter').value;
      renderFileTree(fileTreeData, q);
    }

    function getFileIcon(name) {
      if (name.endsWith('.ts') || name.endsWith('.tsx')) return '🟦';
      if (name.endsWith('.js') || name.endsWith('.jsx')) return '🟨';
      if (name.endsWith('.json')) return '🟧';
      if (name.endsWith('.py')) return '🐍';
      if (name.endsWith('.md')) return '📝';
      if (name.toLowerCase().includes('docker')) return '🐳';
      return '📄';
    }

    // Tab and File handling
    async function openFile(filePath) {
      try {
        const res = await fetch('/api/files/read?path=' + encodeURIComponent(filePath));
        const data = await res.json();
        if (data.error) {
          alert('Error: ' + data.error);
          return;
        }

        activeFile = filePath;
        document.getElementById('noFileOpen').style.display = 'none';

        if (!openTabs.includes(filePath)) {
          openTabs.push(filePath);
        }
        renderTabs();

        const model = monaco.editor.createModel(
          data.content,
          getLanguageFromPath(filePath),
          monaco.Uri.parse('file:///' + filePath)
        );
        editor.setModel(model);

        // Run security scan on newly opened file
        triggerSecurityScan(filePath, data.content);
      } catch (err) {
        console.error('Failed to open file', err);
      }
    }

    function renderTabs() {
      const bar = document.getElementById('tabBar');
      bar.innerHTML = '';
      for (const tab of openTabs) {
        const isActive = tab === activeFile;
        const div = document.createElement('div');
        div.className = \`flex items-center gap-1.5 px-3 py-1 text-xs rounded border cursor-pointer font-mono \${
          isActive
            ? 'bg-cyber-panel text-cyan-400 border-cyan-500/40 shadow-sm'
            : 'bg-cyber-sidebar text-slate-400 border-cyber-border hover:bg-cyber-panel'
        }\`;
        const fileName = tab.split('/').pop();
        div.innerHTML = \`<span>\${getFileIcon(fileName)}</span><span>\${fileName}</span><span class="hover:text-red-400 ml-1">✕</span>\`;
        div.onclick = (e) => {
          if (e.target.textContent === '✕') {
            closeTab(tab);
          } else {
            openFile(tab);
          }
        };
        bar.appendChild(div);
      }
    }

    function closeTab(path) {
      openTabs = openTabs.filter(t => t !== path);
      if (activeFile === path) {
        activeFile = openTabs[0] || null;
        if (activeFile) openFile(activeFile);
        else {
          document.getElementById('noFileOpen').style.display = 'flex';
          editor.setModel(null);
        }
      }
      renderTabs();
    }

    async function saveActiveFile() {
      if (!activeFile || !editor) return;
      const content = editor.getValue();
      try {
        const res = await fetch('/api/files/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: activeFile, content })
        });
        const data = await res.json();
        if (data.success) {
          triggerSecurityScan(activeFile, content);
          runWorkspaceAudit();
        }
      } catch (err) {
        alert('Save failed: ' + err.message);
      }
    }

    let scanTimer = null;
    function triggerSecurityScanDebounced(path, content) {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => triggerSecurityScan(path, content), 400);
    }

    async function triggerSecurityScan(path, content) {
      try {
        const res = await fetch('/api/security/scan-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content })
        });
        const data = await res.json();
        if (data.markers && editor) {
          const model = editor.getModel();
          if (model) {
            monaco.editor.setModelMarkers(model, 'soteria', data.markers);
          }
        }
      } catch (err) {
        console.error('Scan failed', err);
      }
    }

    function getLanguageFromPath(path) {
      if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
      if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
      if (path.endsWith('.py')) return 'python';
      if (path.endsWith('.json')) return 'json';
      if (path.endsWith('.html')) return 'html';
      if (path.endsWith('.css')) return 'css';
      if (path.endsWith('.md')) return 'markdown';
      if (path.toLowerCase().includes('dockerfile')) return 'dockerfile';
      if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
      return 'plaintext';
    }

    // Workspace Audit
    async function runWorkspaceAudit() {
      try {
        document.getElementById('securityPillText').textContent = 'Auditing...';
        const res = await fetch('/api/security/audit', { method: 'POST' });
        workspaceAudit = await res.json();

        // Update Header Pill
        const pill = document.getElementById('securityPill');
        const pillText = document.getElementById('securityPillText');
        pillText.textContent = \`Score: \${workspaceAudit.score}/100 (\${workspaceAudit.grade})\`;

        if (workspaceAudit.score >= 85) {
          pill.className = 'flex items-center gap-2 px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-950/30 text-emerald-400 text-xs font-semibold cursor-pointer hover:bg-emerald-900/40 transition';
        } else if (workspaceAudit.score >= 70) {
          pill.className = 'flex items-center gap-2 px-2.5 py-1 rounded border border-yellow-500/40 bg-yellow-950/30 text-yellow-400 text-xs font-semibold cursor-pointer hover:bg-yellow-900/40 transition';
        } else {
          pill.className = 'flex items-center gap-2 px-2.5 py-1 rounded border border-red-500/40 bg-red-950/30 text-red-400 text-xs font-semibold cursor-pointer hover:bg-red-900/40 transition';
        }

        // Update counts
        document.getElementById('sastCount').textContent = workspaceAudit.sast?.length || 0;
        document.getElementById('secretsCount').textContent = workspaceAudit.secrets?.length || 0;
        document.getElementById('taintCount').textContent = workspaceAudit.taint?.length || 0;
        document.getElementById('containerCount').textContent = workspaceAudit.containers?.length || 0;

        renderDrawerOverview();
      } catch (err) {
        console.error('Audit failed', err);
      }
    }

    function toggleBottomDrawer() {
      const drawer = document.getElementById('bottomDrawer');
      isDrawerOpen = !isDrawerOpen;
      drawer.style.display = isDrawerOpen ? 'flex' : 'none';
    }

    function toggleAgentChat() {
      const sidebar = document.getElementById('agentSidebar');
      isAgentOpen = !isAgentOpen;
      sidebar.style.display = isAgentOpen ? 'flex' : 'none';
    }

    function switchDrawerTab(tab) {
      document.querySelectorAll('.drawer-tab').forEach(b => {
        b.className = 'drawer-tab px-2.5 py-1 text-xs font-medium rounded text-slate-400 hover:text-slate-200';
      });
      event.target.className = 'drawer-tab active px-2.5 py-1 text-xs font-medium rounded text-cyan-400 bg-cyber-panel border border-cyber-border';

      if (tab === 'overview') renderDrawerOverview();
      else if (tab === 'sast') renderDrawerSAST();
      else if (tab === 'secrets') renderDrawerSecrets();
      else if (tab === 'taint') renderDrawerTaint();
      else if (tab === 'containers') renderDrawerContainers();
      else if (tab === 'sbom') renderDrawerSBOM();
    }

    function renderDrawerOverview() {
      if (!workspaceAudit) return;
      const c = document.getElementById('drawerContent');
      c.innerHTML = \`
        <div class="grid grid-cols-5 gap-4">
          <div class="p-3 bg-cyber-sidebar rounded border border-cyber-border flex flex-col items-center justify-center">
            <div class="text-3xl font-bold \${workspaceAudit.score >= 80 ? 'text-emerald-400' : 'text-red-400'}">\${workspaceAudit.score}/100</div>
            <div class="text-[11px] text-slate-400 mt-1 uppercase tracking-wider font-semibold">Security Grade: \${workspaceAudit.grade}</div>
          </div>
          <div class="p-3 bg-cyber-sidebar rounded border border-red-900/40 flex flex-col items-center justify-center">
            <div class="text-2xl font-bold text-red-400">\${workspaceAudit.criticalCount || 0}</div>
            <div class="text-[11px] text-red-300 mt-1">Critical Flaws</div>
          </div>
          <div class="p-3 bg-cyber-sidebar rounded border border-yellow-900/40 flex flex-col items-center justify-center">
            <div class="text-2xl font-bold text-yellow-400">\${workspaceAudit.highCount || 0}</div>
            <div class="text-[11px] text-yellow-300 mt-1">High Severity</div>
          </div>
          <div class="p-3 bg-cyber-sidebar rounded border border-cyber-border flex flex-col items-center justify-center">
            <div class="text-2xl font-bold text-cyan-400">\${workspaceAudit.mediumCount || 0}</div>
            <div class="text-[11px] text-slate-400 mt-1">Medium Severity</div>
          </div>
          <div class="p-3 bg-cyber-sidebar rounded border border-cyber-border flex flex-col items-center justify-center">
            <div class="text-2xl font-bold text-purple-400">\${workspaceAudit.components?.length || 0}</div>
            <div class="text-[11px] text-slate-400 mt-1">SBOM Packages</div>
          </div>
        </div>
      \`;
    }

    function renderDrawerSAST() {
      const c = document.getElementById('drawerContent');
      const items = workspaceAudit?.sast || [];
      if (items.length === 0) {
        c.innerHTML = '<div class="text-emerald-400 py-4">✅ No SAST vulnerabilities detected in workspace.</div>';
        return;
      }
      let html = '<table class="w-full text-left font-mono text-[11px]"><thead><tr class="text-slate-400 border-b border-cyber-border pb-1"><th>Severity</th><th>Rule / CWE</th><th>File:Line</th><th>Snippet</th><th>Action</th></tr></thead><tbody>';
      for (const item of items) {
        html += \`<tr class="border-b border-cyber-border/40 hover:bg-cyber-sidebar/60">
          <td class="\${item.severity === 'CRITICAL' ? 'text-red-400 font-bold' : 'text-yellow-400'} py-1">\${item.severity}</td>
          <td class="text-slate-200">\${item.title} (\${item.cwe})</td>
          <td class="text-cyan-400 cursor-pointer" onclick="openFileAndJump('\${item.file}', \${item.line})">\${item.file}:\${item.line}</td>
          <td class="text-slate-400 truncate max-w-xs">\${item.snippet}</td>
          <td><button onclick="askCopilotFix('\${item.title} in \${item.file} line \${item.line}')" class="px-2 py-0.5 rounded bg-purple-900/60 text-purple-300 hover:bg-purple-800 text-[10px]">Fix with AI</button></td>
        </tr>\`;
      }
      html += '</tbody></table>';
      c.innerHTML = html;
    }

    function renderDrawerSecrets() {
      const c = document.getElementById('drawerContent');
      const items = workspaceAudit?.secrets || [];
      if (items.length === 0) {
        c.innerHTML = '<div class="text-emerald-400 py-4">✅ No leaked secrets or exposed credentials detected.</div>';
        return;
      }
      let html = '<table class="w-full text-left font-mono text-[11px]"><thead><tr class="text-slate-400 border-b border-cyber-border pb-1"><th>Severity</th><th>Secret Type</th><th>Location</th><th>Masked Secret</th><th>Preview</th></tr></thead><tbody>';
      for (const item of items) {
        html += \`<tr class="border-b border-cyber-border/40 hover:bg-cyber-sidebar/60">
          <td class="text-red-400 font-bold py-1">\${item.severity}</td>
          <td class="text-slate-200">\${item.secretType}</td>
          <td class="text-cyan-400 cursor-pointer" onclick="openFileAndJump('\${item.file}', \${item.line})">\${item.file}:\${item.line}</td>
          <td class="text-amber-400">\${item.maskedSecret}</td>
          <td class="text-slate-400 truncate max-w-xs">\${item.contextSnippet}</td>
        </tr>\`;
      }
      html += '</tbody></table>';
      c.innerHTML = html;
    }

    function renderDrawerTaint() {
      const c = document.getElementById('drawerContent');
      const items = workspaceAudit?.taint || [];
      if (items.length === 0) {
        c.innerHTML = '<div class="text-emerald-400 py-4">✅ No unvalidated source-to-sink dataflow taint traces detected.</div>';
        return;
      }
      let html = '<div class="space-y-3 font-mono text-xs">';
      for (const item of items) {
        html += \`<div class="p-3 bg-cyber-sidebar rounded border border-red-900/40">
          <div class="flex items-center justify-between text-red-400 font-bold">
            <span>🌊 \${item.sinkType} (Source: Line \${item.sourceLine} ──> Sink: Line \${item.sinkLine})</span>
            <button onclick="openFileAndJump('\${item.file}', \${item.sinkLine})" class="text-cyan-400 hover:underline">\${item.file}:\${item.sinkLine}</button>
          </div>
          <div class="text-slate-400 text-[11px] mt-1">\${item.remediation}</div>
          <div class="mt-2 space-y-1">
            \${item.trace.map(s => \`<div class="text-[11px] text-slate-300 pl-2 border-l-2 border-purple-500/60">Step \${s.stepNumber} (Line \${s.line}): \${s.description}</div>\`).join('')}
          </div>
        </div>\`;
      }
      html += '</div>';
      c.innerHTML = html;
    }

    function renderDrawerContainers() {
      const c = document.getElementById('drawerContent');
      const items = workspaceAudit?.containers || [];
      if (items.length === 0) {
        c.innerHTML = '<div class="text-emerald-400 py-4">✅ No container or Dockerfile misconfigurations detected.</div>';
        return;
      }
      let html = '<table class="w-full text-left font-mono text-[11px]"><thead><tr class="text-slate-400 border-b border-cyber-border pb-1"><th>Severity</th><th>Rule</th><th>Location</th><th>Remediation</th></tr></thead><tbody>';
      for (const item of items) {
        html += \`<tr class="border-b border-cyber-border/40 hover:bg-cyber-sidebar/60">
          <td class="text-yellow-400 font-bold py-1">\${item.severity}</td>
          <td class="text-slate-200">\${item.title}</td>
          <td class="text-cyan-400 cursor-pointer" onclick="openFileAndJump('\${item.file}', \${item.line})">\${item.file}:\${item.line}</td>
          <td class="text-emerald-400 truncate max-w-sm">\${item.recommendation}</td>
        </tr>\`;
      }
      html += '</tbody></table>';
      c.innerHTML = html;
    }

    function renderDrawerSBOM() {
      const c = document.getElementById('drawerContent');
      const items = workspaceAudit?.components || [];
      let html = \`
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs text-slate-300 font-semibold">Total Dependencies: \${items.length}</div>
          <div class="flex gap-2">
            <button onclick="exportSbom('cyclonedx')" class="px-2.5 py-1 rounded bg-cyan-900/50 text-cyan-300 border border-cyan-700/50 hover:bg-cyan-800/60 text-xs">Download CycloneDX 1.5</button>
            <button onclick="exportSbom('spdx')" class="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-cyber-border hover:bg-slate-700 text-xs">Download SPDX 2.3</button>
          </div>
        </div>
        <table class="w-full text-left font-mono text-[11px]"><thead><tr class="text-slate-400 border-b border-cyber-border pb-1"><th>Component</th><th>Version</th><th>Ecosystem</th><th>Package URL (purl)</th></tr></thead><tbody>
      \`;
      for (const item of items) {
        html += \`<tr class="border-b border-cyber-border/40 hover:bg-cyber-sidebar/60">
          <td class="text-slate-200 font-bold py-1">\${item.name}</td>
          <td class="text-slate-400">\${item.version}</td>
          <td class="text-purple-400">\${item.ecosystem}</td>
          <td class="text-cyan-400 truncate max-w-xs">\${item.purl}</td>
        </tr>\`;
      }
      html += '</tbody></table>';
      c.innerHTML = html;
    }

    async function openFileAndJump(filePath, line) {
      await openFile(filePath);
      if (editor && line) {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
      }
    }

    function exportSbom(format) {
      window.open('/api/sbom/download?format=' + format, '_blank');
    }

    // Copilot AI Chat
    async function handleChatSubmit(e) {
      e.preventDefault();
      const input = document.getElementById('chatInput');
      const msg = input.value.trim();
      if (!msg) return;
      input.value = '';

      appendChatMessage('user', msg);

      const activeContent = editor ? editor.getValue() : '';
      try {
        const res = await fetch('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            activeFile,
            activeFileContent: activeContent,
          })
        });
        const data = await res.json();
        appendChatMessage('assistant', data.reply, data.codeSnippet);
      } catch (err) {
        appendChatMessage('assistant', 'Error contacting Soteria AI: ' + err.message);
      }
    }

    function sendQuickPrompt(prompt) {
      document.getElementById('chatInput').value = prompt;
      handleChatSubmit(new Event('submit'));
    }

    function askCopilotFix(issue) {
      sendQuickPrompt('Fix: ' + issue + ' in the current editor file');
    }

    function appendChatMessage(role, text, codeSnippet) {
      const container = document.getElementById('chatMessages');
      const div = document.createElement('div');
      div.className = \`p-3 rounded text-xs leading-relaxed \${
        role === 'user'
          ? 'bg-purple-950/40 border border-purple-800/50 text-slate-200 ml-4'
          : 'bg-cyber-panel border border-cyber-border text-slate-300 mr-2'
      }\`;

      const roleHeader = role === 'user' ? '👤 You' : '🤖 Soteria AI';
      div.innerHTML = \`<div class="font-semibold text-slate-400 mb-1 text-[11px]">\${roleHeader}</div><div class="whitespace-pre-wrap">\${escapeHtml(text)}</div>\`;

      if (codeSnippet) {
        const codeBox = document.createElement('div');
        codeBox.className = 'mt-2 p-2 bg-slate-950 rounded border border-cyber-border font-mono text-[11px] text-cyan-300 relative';
        codeBox.innerHTML = \`<pre><code>\${escapeHtml(codeSnippet)}</code></pre><button onclick="applyCodeToEditor(this)" data-code="\${encodeURIComponent(codeSnippet)}" class="absolute top-1.5 right-1.5 px-2 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-[10px]">Apply to Editor</button>\`;
        div.appendChild(codeBox);
      }

      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }

    function applyCodeToEditor(btn) {
      const code = decodeURIComponent(btn.getAttribute('data-code'));
      if (editor) {
        editor.setValue(code);
        saveActiveFile();
      }
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  </script>
</body>
</html>`;
}
