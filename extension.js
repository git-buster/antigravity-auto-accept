// =============================================================================
// Auto Accept for Antigravity v17
// 文件 Accept → 编辑器（切换 tab + chatEditing）
// 终端 Run   → Agent Manager CDP
// v17: 底部设置面板 + 细分开关 + 黑名单 Reject/Stop
// =============================================================================

const vscode = require('vscode');
const http = require('http');

let WebSocket;
try { WebSocket = require('ws'); } catch (_) { WebSocket = null; }

let statusBarItem;
let enabled = false;
let autoAcceptFiles = true;
let autoRunTerminal = true;
let blacklistAction = 'reject'; // 'reject' | 'pause'
let language = 'en'; // 'zh' | 'en'
let outputChannel;
let cdpConnections = new Map(); // url -> ws
let cdpReconnectTimer = null;
let cdpHealthTimer = null;
let pauseCheckTimer = null;
let docChangeListener = null;
let pendingFiles = new Set();
let extContext = null;
let settingsPanel = null;

// i18n
const I18N = {
  zh: {
    masterSwitch: '总开关', masterTip: '控制插件整体启停',
    autoFiles: '自动接受文件改动', autoFilesTip: 'Agent 修改文件时自动 Accept',
    autoTerminal: '自动执行终端命令', autoTerminalTip: 'Agent 运行命令时自动点击 Run/Allow',
    blBehavior: '黑名单行为', blTip: '检测到高危命令时的处理方式',
    blReject: '主动拒绝 (Reject)', blStop: '停止插件 (Stop)',
    blSettings: '黑名单设置', showStatus: '显示连接状态', diagnose: '诊断',
    langLabel: '语言 / Language',
    close: '关闭',
    sbOff: '已关闭\n点击打开设置',
    sbRunning: '运行中',
    sbFileAccept: '文件 Accept', sbTermRun: '终端 Run',
    sbBlacklist: '黑名单', sbBlReject: '主动拒绝', sbBlStop: '停止插件',
    sbCdpConn: '已连接', sbCdpTargets: '个目标',
    sbClickSettings: '点击打开设置',
    sbCdpDisconn: '未连接（重连中...）',
    warnStopped: '⚠️ Auto Accept 检测到高危命令，已自动停止插件。请在状态栏重新开启。',
  },
  en: {
    masterSwitch: 'Master Switch', masterTip: 'Toggle plugin on/off',
    autoFiles: 'Auto Accept Files', autoFilesTip: 'Auto accept when Agent modifies files',
    autoTerminal: 'Auto Run Terminal', autoTerminalTip: 'Auto click Run/Allow for Agent commands',
    blBehavior: 'Blacklist Action', blTip: 'Action when dangerous command detected',
    blReject: 'Reject', blStop: 'Stop Plugin',
    blSettings: 'Blacklist Settings', showStatus: 'Connection Status', diagnose: 'Diagnose',
    langLabel: 'Language / 语言',
    close: 'Close',
    sbOff: 'Disabled\nClick to open settings',
    sbRunning: 'Running',
    sbFileAccept: 'File Accept', sbTermRun: 'Terminal Run',
    sbBlacklist: 'Blacklist', sbBlReject: 'Reject', sbBlStop: 'Stop Plugin',
    sbCdpConn: 'Connected', sbCdpTargets: 'target(s)',
    sbClickSettings: 'Click to open settings',
    sbCdpDisconn: 'Disconnected (reconnecting...)',
    warnStopped: '⚠️ Auto Accept detected a dangerous command and stopped. Re-enable from the status bar.',
  }
};
function t(key) { return (I18N[language] || I18N.zh)[key] || key; }

const ACCEPT_COMMANDS = [
  'chatEditing.acceptAllFiles',
  'chatEditing.acceptFile',
  'antigravity.prioritized.agentAcceptAllInFile',
];

// ---------------------------------------------------------------------------
// 激活
// ---------------------------------------------------------------------------
function activate(context) {
  extContext = context;
  outputChannel = vscode.window.createOutputChannel('Auto Accept');
  log('v17 loaded (dialog settings + reject/stop)');

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'autoAccept.showPanel';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('autoAccept.showPanel', showSettingsPanel),
    vscode.commands.registerCommand('autoAccept.toggle', toggleAutoAccept),
    vscode.commands.registerCommand('autoAccept.openBlacklist', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'autoAccept.blacklist')),
    vscode.commands.registerCommand('autoAccept.showStatus', showStatus),
    vscode.commands.registerCommand('autoAccept.diagnose', runDiagnostic)
  );

  // 从 globalState 读取各项设置
  enabled = context.globalState.get('enabled', true);
  autoAcceptFiles = context.globalState.get('autoAcceptFiles', true);
  autoRunTerminal = context.globalState.get('autoRunTerminal', true);
  blacklistAction = context.globalState.get('blacklistAction', 'reject');
  language = context.globalState.get('language', 'en');

  if (enabled) start();

  updateStatusBar();
  statusBarItem.show();
}

function deactivate() { stop(); }

// ---------------------------------------------------------------------------
// 启动 / 停止
// ---------------------------------------------------------------------------
function start() {
  log('Starting...');
  startFileChangeWatcher();
  connectCDP();
  startCDPHealthCheck();
  startPauseCheck();
  updateStatusBar();
}

function stop() {
  log('Stopping...');
  if (docChangeListener) { docChangeListener.dispose(); docChangeListener = null; }
  pendingFiles.clear();
  if (cdpReconnectTimer) { clearTimeout(cdpReconnectTimer); cdpReconnectTimer = null; }
  if (cdpHealthTimer) { clearInterval(cdpHealthTimer); cdpHealthTimer = null; }
  if (pauseCheckTimer) { clearInterval(pauseCheckTimer); pauseCheckTimer = null; }

  const connectionsToClose = [...cdpConnections.entries()];
  const cleanupExpr = 'window.__aaActive=false;if(window.__aaTimer){clearInterval(window.__aaTimer);window.__aaTimer=null;}if(window.__aaObserver){window.__aaObserver.disconnect();window.__aaObserver=null;}if(window.__aaCleanup)window.__aaCleanup();';

  // 发送 3 次清理命令（间隔 500ms），确保送达
  function sendCleanup() {
    for (const [url, ws] of connectionsToClose) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            id: 99999, method: 'Runtime.evaluate',
            params: { expression: cleanupExpr }
          }));
        }
      } catch (_) { }
    }
  }

  sendCleanup();
  setTimeout(sendCleanup, 500);
  setTimeout(sendCleanup, 1000);

  // 1.5 秒后断开连接
  setTimeout(() => {
    for (const [url, ws] of connectionsToClose) {
      try { ws.close(); } catch (_) { }
    }
    cdpConnections.clear();
    updateStatusBar();
  }, 1500);

  updateStatusBar();
  log('Stopped');
}

// ===========================================================================
// 部分A: 文件 Accept（编辑器方式，按需触发）
// ===========================================================================
function startFileChangeWatcher() {
  if (docChangeListener) docChangeListener.dispose();

  docChangeListener = vscode.workspace.onDidChangeTextDocument(async (e) => {
    if (!enabled || !autoAcceptFiles) return;
    if (e.document.uri.scheme !== 'file') return;
    if (e.contentChanges.length === 0) return;

    const changedUri = e.document.uri.toString();

    // 防抖：同一个文件 5 秒内只处理一次
    if (pendingFiles.has(changedUri)) return;
    pendingFiles.add(changedUri);
    setTimeout(() => pendingFiles.delete(changedUri), 5000);

    log('File change: ' + e.document.fileName);

    // 非当前文件 → 先切换 tab
    const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
    if (activeUri !== changedUri) {
      try {
        await vscode.window.showTextDocument(e.document, { preview: true, preserveFocus: false });
      } catch (_) { }
    }

    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (!enabled || !autoAcceptFiles) return;
      try { await vscode.commands.executeCommand('chatEditing.viewChanges'); } catch (_) { }
      for (const cmd of ACCEPT_COMMANDS) {
        try { await vscode.commands.executeCommand(cmd); } catch (_) { }
      }
    }
  });

  log('File Accept: on-demand watcher started');
}

// ===========================================================================
// CDP 健康检查：定期重新检查 Agent Manager 目标，面板切换后自动重连
// ===========================================================================
function startCDPHealthCheck() {
  if (cdpHealthTimer) clearInterval(cdpHealthTimer);
  let reinjectCounter = 0;

  cdpHealthTimer = setInterval(() => {
    if (!enabled) return;
    reinjectCounter++;

    const port = vscode.workspace.getConfiguration('autoAccept').get('cdpPort', 9222);
    fetchJSON(`http://127.0.0.1:${port}/json/list`)
      .then(targets => {
        const jetskiTargets = targets.filter(t =>
          t.type === 'page' && t.url && t.url.includes('jetski') && t.webSocketDebuggerUrl
        );
        if (jetskiTargets.length === 0) return;

        // 检查是否有新目标需要连接
        for (const target of jetskiTargets) {
          if (!cdpConnections.has(target.webSocketDebuggerUrl)) {
            log('★ Found new jetski target, connecting...');
            connectOneTarget(target);
          }
        }

        // 清理已不存在的目标
        const validUrls = new Set(jetskiTargets.map(t => t.webSocketDebuggerUrl));
        for (const [url, ws] of cdpConnections) {
          if (!validUrls.has(url)) {
            log('★ Stale target removed: ' + url.substring(0, 60));
            try { ws.close(); } catch (_) { }
            cdpConnections.delete(url);
          }
        }

        // 定期重新注入脚本
        if (reinjectCounter % 4 === 0) {
          for (const [url, ws] of cdpConnections) {
            if (ws.readyState === WebSocket.OPEN) {
              injectScriptTo(ws);
            }
          }
        }
      })
      .catch(() => { });
  }, 15000);

  log('CDP health check started (15s interval)');
}

// ===========================================================================
// 部分B: 终端 Run（Agent Manager CDP，不调 Runtime.enable 避免崩溃）
// ===========================================================================
function connectCDP() {
  if (!WebSocket) { log('CDP: ws not available'); return; }
  const port = vscode.workspace.getConfiguration('autoAccept').get('cdpPort', 9222);

  fetchJSON(`http://127.0.0.1:${port}/json/list`)
    .then(targets => {
      // ★ 连接所有 jetski 目标（侧边 agent + Agent Manager 都要）★
      const jetskiTargets = targets.filter(t =>
        t.type === 'page' && t.url && t.url.includes('jetski') && t.webSocketDebuggerUrl
      );
      if (jetskiTargets.length > 0) {
        log('CDP: Found ' + jetskiTargets.length + ' jetski target(s)');
        for (const target of jetskiTargets) {
          if (!cdpConnections.has(target.webSocketDebuggerUrl)) {
            connectOneTarget(target);
          }
        }
      } else {
        log('CDP: No jetski targets found');
        scheduleRetry();
      }
    })
    .catch(err => { log('CDP: ' + err.message); scheduleRetry(); });
}

function connectOneTarget(target) {
  const wsUrl = target.webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    log('✅ Connected to jetski: ' + (target.title || target.url).substring(0, 60));
    cdpConnections.set(wsUrl, ws);
    setTimeout(() => injectScriptTo(ws), 2000);
    updateStatusBar();
  });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.id === 60 && msg.result && msg.result.result) {
        try {
          const items = JSON.parse(msg.result.result.value);
          log('=== BUTTON SCAN ===');
          for (const b of items) log('  <' + b.tag + '> text="' + b.text + '" aria="' + b.aria + '"');
          log('===================');
        } catch (e) { log('Parse: ' + e.message); }
      }
    } catch (_) { }
  });

  ws.on('close', () => {
    log('Jetski disconnected: ' + wsUrl.substring(0, 60));
    cdpConnections.delete(wsUrl);
    updateStatusBar();
  });

  ws.on('error', () => { });
}

// ★ Agent Manager 全页面扫描（安全，不影响编辑器）★
function injectScriptTo(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const config = vscode.workspace.getConfiguration('autoAccept');
  const scanInterval = config.get('scanIntervalMs', 800);
  const buttonTexts = config.get('acceptButtonTexts', []);
  const blacklist = config.get('blacklist', []);
  const blacklistRegex = config.get('blacklistRegex', []);

  const script = `
(function() {
  if (window.__aaTimer) clearInterval(window.__aaTimer);
  if (window.__aaObserver) window.__aaObserver.disconnect();
  window.__aaActive = true;
  // ★ 不清除 __aaPauseRequested，避免重注入覆盖未被轮询的停止信号
  if (typeof window.__aaPauseRequested === 'undefined') window.__aaPauseRequested = false;

  const INTERVAL = ${scanInterval};
  const TEXTS = ${JSON.stringify(buttonTexts)};
  const AUTO_RUN = ${autoRunTerminal ? 'true' : 'false'};
  const BL_ACTION = '${blacklistAction}';
  const BL = ${JSON.stringify(blacklist)};
  const BL_RE = ${JSON.stringify(blacklistRegex)}.map(p => {
    try { return new RegExp(p, 'i'); } catch(e) { return null; }
  }).filter(Boolean);

  const REJECT_TEXTS = ['reject', 'deny', 'dismiss', "don't allow", 'decline'];

  function checkBL(cmd) {
    if (!cmd) return false;
    const lc = cmd.toLowerCase();
    for (const p of BL) { if (lc.includes(p.toLowerCase())) return p; }
    for (const r of BL_RE) { if (r.test(cmd)) return r.source; }
    return false;
  }

  function isRunType(text) {
    return ['run','allow','allow once','allow this conversation'].includes(text.toLowerCase());
  }

  function isAcceptType(text) {
    return ['accept all','accept changes'].includes(text.toLowerCase());
  }

  function getCommandText(btn) {
    // 策略1: pre/code/terminal 元素
    let p = btn;
    for (let i = 0; i < 20 && p; i++) {
      try {
        const blocks = p.querySelectorAll && p.querySelectorAll(
          'pre, code, [class*="terminal"], [class*="command"], [class*="code-block"], [class*="codeblock"], [class*="snippet"], [class*="shell"]'
        );
        if (blocks) for (const b of blocks) {
          const t = b.textContent.trim();
          if (t.length > 2 && t.length < 5000 && t !== btn.textContent.trim()) {
            window.__aaDebugLog.push('  => CMD found: strategy=1 layer=' + i + ' tag=' + b.tagName);
            return t;
          }
        }
      } catch(_) {}
      p = p.parentElement;
    }

    // 策略2: 找父容器去掉按钮本身文本
    try {
      const parent = btn.closest('[class*="action"], [class*="step"], [class*="message"], [class*="block"], [class*="container"], [class*="content"]');
      if (parent) {
        const allText = parent.textContent.trim();
        const btnText = btn.textContent.trim();
        const cmdText = allText.replace(btnText, '').trim();
        if (cmdText.length > 2 && cmdText.length < 5000) {
          window.__aaDebugLog.push('  => CMD found: strategy=2 (parent container)');
          return cmdText;
        }
      }
    } catch(_) {}

    // 策略3: 兄弟元素
    try {
      let sibling = btn.previousElementSibling;
      for (let i = 0; i < 5 && sibling; i++) {
        const t = sibling.textContent.trim();
        if (t.length > 2 && t.length < 5000) {
          window.__aaDebugLog.push('  => CMD found: strategy=3 (sibling)');
          return t;
        }
        sibling = sibling.previousElementSibling;
      }
    } catch(_) {}

    window.__aaDebugLog.push('  => CMD not found');
    return '';
  }

  // 查找 Reject / Deny 按钮（同级 + 向上 5 层搜索）
  function findRejectButton(runBtn) {
    function matchesReject(el) {
      if (el === runBtn) return false;
      const t = (el.textContent || '').trim().toLowerCase();
      const a = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      const tt = (el.getAttribute('title') || '').trim().toLowerCase();
      for (const rt of REJECT_TEXTS) {
        if (t.includes(rt) || a.includes(rt) || tt.includes(rt)) return true;
      }
      return false;
    }
    const BTN_SEL = 'button, [role="button"], a[class*="action"], [class*="action-label"], [class*="monaco-button"]';

    // 策略1: 同级搜索
    try {
      const parent = runBtn.parentElement;
      if (parent) {
        for (const sib of parent.querySelectorAll(BTN_SEL)) {
          if (matchesReject(sib)) {
            window.__aaDebugLog.push('  => Reject found: sibling text="' + (sib.textContent||'').trim().substring(0,30) + '"');
            return sib;
          }
        }
      }
    } catch(_) {}

    // 策略2: 向上 5 层祖先搜索
    try {
      let ancestor = runBtn.parentElement;
      for (let i = 0; i < 5 && ancestor; i++) {
        ancestor = ancestor.parentElement;
        if (!ancestor) break;
        for (const el of ancestor.querySelectorAll(BTN_SEL)) {
          if (matchesReject(el)) {
            window.__aaDebugLog.push('  => Reject found: ancestor layer=' + (i+1) + ' text="' + (el.textContent||'').trim().substring(0,30) + '"');
            return el;
          }
        }
      }
    } catch(_) {}

    window.__aaDebugLog.push('  => Reject NOT found');
    return null;
  }

  function clickButton(el) {
    el.click();
    el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
    el.dispatchEvent(new PointerEvent('pointerup', {bubbles:true}));
    el.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
  }

  // Agent Manager 是独立页面 → 全页面扫描安全
  window.__aaDebugLog = window.__aaDebugLog || [];

  function collectButtons(root, results) {
    if (!root) return;
    const sel = 'button, [role="button"], a[class*="action"], [class*="action-label"], [class*="monaco-button"], [class*="monaco-link"]';
    try {
      root.querySelectorAll(sel).forEach(el => {
        if (!el.dataset.aaProcessed) results.push(el);
      });
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) collectButtons(el.shadowRoot, results);
      });
    } catch(_) {}
  }

  function scan() {
    if (!window.__aaActive) {
      if (window.__aaTimer) clearInterval(window.__aaTimer);
      if (window.__aaObserver) window.__aaObserver.disconnect();
      return;
    }
    const buttons = [];
    collectButtons(document.body, buttons);

    for (const el of buttons) {
      if (!window.__aaActive) return;
      const text = (el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      const ttl = (el.getAttribute('title') || '').trim();
      let matched = null;
      for (const t of TEXTS) {
        const lt = t.toLowerCase();
        if (text.toLowerCase() === lt || aria.toLowerCase() === lt || ttl.toLowerCase() === lt) {
          matched = t; break;
        }
      }
      if (!matched) continue;

      // 如果是 Run/Allow 类按钮
      if (isRunType(matched)) {
        // 终端自动 Run 关闭 → 跳过
        if (!AUTO_RUN) {
          try { el.dataset.aaProcessed = 'skipped-disabled'; } catch(_) {}
          continue;
        }

        const cmd = getCommandText(el);

        // ★ 防竞态：命令文本为空时，DOM 可能还没渲染完 → 跳过，等下次扫描重试
        if (!cmd) {
          const retries = parseInt(el.dataset.aaRetry || '0', 10);
          if (retries < 5) {
            el.dataset.aaRetry = String(retries + 1);
            window.__aaDebugLog.push('[' + new Date().toLocaleTimeString() + '] btn="' + matched + '" cmd=<EMPTY> retry=' + (retries + 1) + '/5 (waiting for DOM)');
            if (window.__aaDebugLog.length > 50) window.__aaDebugLog.shift();
            continue; // 跳过，下次扫描重试
          }
          // 超过 5 次仍为空 → 当作安全命令放行
          window.__aaDebugLog.push('[' + new Date().toLocaleTimeString() + '] btn="' + matched + '" cmd=<EMPTY> retries exhausted, allowing');
          if (window.__aaDebugLog.length > 50) window.__aaDebugLog.shift();
        }

        if (cmd) {
          const debugEntry = '[' + new Date().toLocaleTimeString() + '] btn="' + matched + '" cmd="' + cmd.substring(0, 200) + '"';
          window.__aaDebugLog.push(debugEntry);
          if (window.__aaDebugLog.length > 50) window.__aaDebugLog.shift();
        }
        const blocked = checkBL(cmd);
        if (blocked) {
          window.__aaDebugLog.push('  => BLOCKED by: ' + blocked + ' | action: ' + BL_ACTION);
          try { el.dataset.aaProcessed = 'blocked'; } catch(_) {}
          if (BL_ACTION === 'reject') {
            // 主动拒绝：点击 Reject 按钮，之后继续正常运行
            const rejectBtn = findRejectButton(el);
            if (rejectBtn) {
              clickButton(rejectBtn);
              rejectBtn.dataset.aaProcessed = 'rejected';
              console.log('[AA-REJECTED] ' + blocked + ' (clicked reject button)');
              window.__aaDebugLog.push('  => REJECTED via button');
            } else {
              console.log('[AA-BLOCKED] ' + blocked + ' (no reject button found, skipped)');
              window.__aaDebugLog.push('  => No reject button found, skipped');
            }
          } else {
            // 停止模式：不点击任何按钮，停止扫描，通知插件自动关闭
            console.log('[AA-STOPPED] ' + blocked + ' (stop mode, stopping plugin)');
            window.__aaDebugLog.push('  => PAUSED: plugin will auto-disable');
            window.__aaPauseRequested = true;
            window.__aaActive = false;
            if (window.__aaTimer) { clearInterval(window.__aaTimer); window.__aaTimer = null; }
            if (window.__aaObserver) { window.__aaObserver.disconnect(); window.__aaObserver = null; }
            return; // 立即停止扫描
          }
          continue;
        }
      }

      // Accept 类按钮 — 由 Accept 开关控制（CDP 侧一般不触发文件 Accept，但保留逻辑）
      // Run/Allow 类或其他按钮 → 正常点击
      try {
        el.dataset.aaProcessed = 'accepted';
        clickButton(el);
        console.log('[AA-ACCEPTED] ' + matched + ' (text: ' + text.substring(0, 40) + ')');
      } catch (err) {
        console.log('[AA-ERROR] ' + err.message);
      }
    }
  }

  // ★ scan 防抖：防止 MutationObserver 短时间内多次触发
  let _scanPending = false;
  function debouncedScan() {
    if (_scanPending || !window.__aaActive) return;
    _scanPending = true;
    setTimeout(() => { _scanPending = false; scan(); }, 300);
  }

  window.__aaTimer = setInterval(scan, INTERVAL);
  console.log('[AA-INIT] v17: jetski page scan (all targets) | autoRun=' + AUTO_RUN + ' | blAction=' + BL_ACTION);
  try {
    window.__aaObserver = new MutationObserver(() => {
      if (window.__aaActive) debouncedScan();
    });
    if (document.body) window.__aaObserver.observe(document.body, {childList:true, subtree:true});
  } catch(_) {}
  window.__aaCleanup = () => {
    window.__aaActive = false;
    if (window.__aaTimer) { clearInterval(window.__aaTimer); window.__aaTimer = null; }
    if (window.__aaObserver) { window.__aaObserver.disconnect(); window.__aaObserver = null; }
  };
})();
`;

  ws.send(JSON.stringify({
    id: 5, method: 'Runtime.evaluate',
    params: { expression: script, awaitPromise: false }
  }));
  log('Script injected (autoRun=' + autoRunTerminal + ', blAction=' + blacklistAction + ')');
}

// ===========================================================================
// 设置弹窗 (WebviewPanel)
// ===========================================================================
function showSettingsPanel() {
  // 如果已打开，直接聚焦
  if (settingsPanel) {
    settingsPanel.reveal();
    refreshSettingsPanel();
    return;
  }

  settingsPanel = vscode.window.createWebviewPanel(
    'autoAcceptSettings',
    'Auto Accept Settings',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: false }
  );

  refreshSettingsPanel();

  settingsPanel.webview.onDidReceiveMessage(msg => {
    switch (msg.type) {
      case 'close':
        settingsPanel.dispose();
        break;
      case 'toggle':
        toggleAutoAccept();
        refreshSettingsPanel();
        break;
      case 'toggleFiles':
        autoAcceptFiles = !autoAcceptFiles;
        if (extContext) extContext.globalState.update('autoAcceptFiles', autoAcceptFiles);
        log('Auto Accept Files: ' + (autoAcceptFiles ? 'ON' : 'OFF'));
        updateStatusBar();
        reinjectAllTargets();
        refreshSettingsPanel();
        break;
      case 'toggleTerminal':
        autoRunTerminal = !autoRunTerminal;
        if (extContext) extContext.globalState.update('autoRunTerminal', autoRunTerminal);
        log('Auto Run Terminal: ' + (autoRunTerminal ? 'ON' : 'OFF'));
        updateStatusBar();
        reinjectAllTargets();
        refreshSettingsPanel();
        break;
      case 'setBlAction':
        blacklistAction = msg.value;
        if (extContext) extContext.globalState.update('blacklistAction', blacklistAction);
        log('Blacklist action: ' + blacklistAction);
        updateStatusBar();
        reinjectAllTargets();
        refreshSettingsPanel();
        break;
      case 'setLang':
        language = msg.value;
        if (extContext) extContext.globalState.update('language', language);
        log('Language: ' + language);
        updateStatusBar();
        refreshSettingsPanel();
        break;
      case 'openBlacklist':
        vscode.commands.executeCommand('workbench.action.openSettings', 'autoAccept.blacklist');
        break;
      case 'showStatus':
        showStatus();
        break;
      case 'diagnose':
        runDiagnostic();
        break;
    }
  });

  settingsPanel.onDidDispose(() => { settingsPanel = null; });
}

function refreshSettingsPanel() {
  if (!settingsPanel) return;
  const connCount = [...cdpConnections.values()].filter(ws => ws.readyState === WebSocket.OPEN).length;
  settingsPanel.webview.html = getSettingsHtml(connCount);
}

function getSettingsHtml(connCount) {
  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 40px;
    min-height: 100vh;
  }
  .dialog {
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    border: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.12));
    border-radius: 8px;
    width: 380px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    overflow: hidden;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
  }
  .dialog-title {
    font-weight: 600;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    font-size: 18px;
    cursor: pointer;
    opacity: 0.6;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
  }
  .close-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1));
  }
  .dialog-body {
    padding: 12px 16px;
  }
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 0;
    min-height: 32px;
  }
  .setting-label {
    color: var(--vscode-foreground);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .info {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    cursor: help;
    opacity: 0.5;
  }
  select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    outline: none;
    min-width: 110px;
  }
  select:hover { border-color: var(--vscode-focusBorder); }
  select:focus { border-color: var(--vscode-focusBorder); }
  select:disabled { opacity: 0.4; cursor: not-allowed; }
  .divider {
    border: none;
    border-top: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.08));
    margin: 6px 0;
  }
  .link-row { padding: 5px 0; }
  .link {
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    font-size: 13px;
    text-decoration: none;
  }
  .link:hover { text-decoration: underline; }
  .badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
    display: inline-block;
  }
  .badge-on { background: rgba(40,167,69,0.2); color: #4ec96b; }
  .badge-off { background: rgba(220,53,69,0.2); color: #f56c6c; }
  .badge-cdp { background: rgba(0,123,255,0.15); color: var(--vscode-textLink-foreground); margin-left: 6px; }
</style>
</head>
<body>
  <div class="dialog">
    <div class="dialog-header">
      <span class="dialog-title">
        Auto Accept
        ${enabled ? '<span class="badge badge-on">✓ ON</span>' : '<span class="badge badge-off">✕ OFF</span>'}
        ${enabled && connCount > 0 ? '<span class="badge badge-cdp">CDP x' + connCount + '</span>' : ''}
        ${enabled && connCount === 0 ? '<span class="badge badge-off">CDP ✕</span>' : ''}
      </span>
      <button class="close-btn" onclick="send('close')" title="${t('close')}">✕</button>
    </div>
    <div class="dialog-body">
      <div class="setting-row">
        <span class="setting-label">${t('masterSwitch')} <span class="info" title="${t('masterTip')}">ⓘ</span></span>
        <select onchange="send('toggle')">
          <option ${enabled ? 'selected' : ''}>On</option>
          <option ${!enabled ? 'selected' : ''}>Off</option>
        </select>
      </div>
      <div class="setting-row">
        <span class="setting-label">${t('autoFiles')} <span class="info" title="${t('autoFilesTip')}">ⓘ</span></span>
        <select onchange="send('toggleFiles')" ${!enabled ? 'disabled' : ''}>
          <option ${autoAcceptFiles ? 'selected' : ''}>On</option>
          <option ${!autoAcceptFiles ? 'selected' : ''}>Off</option>
        </select>
      </div>
      <div class="setting-row">
        <span class="setting-label">${t('autoTerminal')} <span class="info" title="${t('autoTerminalTip')}">ⓘ</span></span>
        <select onchange="send('toggleTerminal')" ${!enabled ? 'disabled' : ''}>
          <option ${autoRunTerminal ? 'selected' : ''}>On</option>
          <option ${!autoRunTerminal ? 'selected' : ''}>Off</option>
        </select>
      </div>
      <div class="setting-row">
        <span class="setting-label">${t('blBehavior')} <span class="info" title="${t('blTip')}">ⓘ</span></span>
        <select onchange="send('setBlAction', this.value)" ${!enabled ? 'disabled' : ''}>
          <option value="reject" ${blacklistAction === 'reject' ? 'selected' : ''}>${t('blReject')}</option>
          <option value="pause" ${blacklistAction !== 'reject' ? 'selected' : ''}>${t('blStop')}</option>
        </select>
      </div>
      <div class="setting-row">
        <span class="setting-label">${t('langLabel')}</span>
        <select onchange="send('setLang', this.value)">
          <option value="zh" ${language === 'zh' ? 'selected' : ''}>中文</option>
          <option value="en" ${language === 'en' ? 'selected' : ''}>English</option>
        </select>
      </div>
      <hr class="divider">
      <div class="link-row"><a class="link" onclick="send('openBlacklist')">${t('blSettings')}</a></div>
      <div class="link-row"><a class="link" onclick="send('showStatus')">${t('showStatus')}</a></div>
      <div class="link-row"><a class="link" onclick="send('diagnose')">${t('diagnose')}</a></div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const autoAcceptFiles = ${autoAcceptFiles};
    const autoRunTerminal = ${autoRunTerminal};
    const blacklistAction = '${blacklistAction}';
    function send(type, value) { vscode.postMessage({ type, value }); }
  </script>
</body>
</html>`;
}

// 重新注入所有已连接目标的脚本（设置变更后立即生效）
function reinjectAllTargets() {
  for (const [url, ws] of cdpConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      injectScriptTo(ws);
    }
  }
}

// ===========================================================================
// 暂停检测：轮询注入脚本的 __aaPauseRequested 信号
// ===========================================================================
function startPauseCheck() {
  if (pauseCheckTimer) clearInterval(pauseCheckTimer);
  let pauseCheckMsgId = 30000;

  pauseCheckTimer = setInterval(() => {
    if (!enabled) return;

    for (const [url, ws] of cdpConnections) {
      if (ws.readyState !== WebSocket.OPEN) continue;

      const checkId = pauseCheckMsgId++;
      ws.send(JSON.stringify({
        id: checkId, method: 'Runtime.evaluate',
        params: {
          expression: '(function(){ if(window.__aaPauseRequested){window.__aaPauseRequested=false;return "PAUSE";}return "OK";})()',
          returnByValue: true
        }
      }));

      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.id === checkId && msg.result && msg.result.result) {
            if (msg.result.result.value === 'PAUSE') {
              log('⚠️ Blacklist triggered stop!');
              vscode.window.showWarningMessage(t('warnStopped'));
              if (enabled) toggleAutoAccept();
            }
            ws.removeListener('message', handler);
          }
        } catch (_) { }
      };
      ws.on('message', handler);
      setTimeout(() => ws.removeListener('message', handler), 5000);
    }
  }, 3000);

  log('Pause check started (3s interval)');
}

// ===========================================================================
// 通用
// ===========================================================================

let _isToggling = false;
function toggleAutoAccept() {
  if (_isToggling) return; // 防止多个 CDP 连接同时触发
  _isToggling = true;
  enabled = !enabled;
  if (extContext) extContext.globalState.update('enabled', enabled);
  if (enabled) { log('ON'); start(); } else { log('OFF'); stop(); }
  updateStatusBar();
  _isToggling = false;
}

function showStatus() {
  outputChannel.show();
  const connCount = [...cdpConnections.values()].filter(ws => ws.readyState === WebSocket.OPEN).length;
  log('Status: ' + (enabled ? 'ON' : 'OFF')
    + ' | Files: ' + (autoAcceptFiles ? 'ON' : 'OFF')
    + ' | Terminal: ' + (autoRunTerminal ? 'ON' : 'OFF')
    + ' | BL: ' + blacklistAction
    + ' | CDP: x' + connCount);
}

async function runDiagnostic() {
  outputChannel.show();
  log('=== DIAGNOSTIC ===');
  log('CDP connections: ' + cdpConnections.size);
  log('Settings: enabled=' + enabled + ' files=' + autoAcceptFiles + ' terminal=' + autoRunTerminal + ' blAction=' + blacklistAction);

  let diagnosed = false;
  let msgId = 60;
  for (const [url, ws] of cdpConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      // 读取调试日志
      const debugId = msgId++;
      ws.send(JSON.stringify({
        id: debugId, method: 'Runtime.evaluate',
        params: {
          expression: 'JSON.stringify(window.__aaDebugLog || [])',
          returnByValue: true
        }
      }));

      // 一次性监听回复
      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.id === debugId && msg.result && msg.result.result) {
            const logs = JSON.parse(msg.result.result.value);
            log('--- Debug log from: ' + url.substring(0, 50) + ' ---');
            if (logs.length === 0) {
              log('  (no Run buttons detected yet)');
            } else {
              for (const entry of logs) log('  ' + entry);
            }
            log('---');
            ws.removeListener('message', handler);
          }
        } catch (_) { }
      };
      ws.on('message', handler);
      setTimeout(() => ws.removeListener('message', handler), 5000);

      diagnosed = true;
    }
  }
  if (!diagnosed) { log('No CDP connections available'); }
  log('=== END ===');
}

function scheduleRetry() {
  if (!enabled) return;
  if (cdpReconnectTimer) clearTimeout(cdpReconnectTimer);
  cdpReconnectTimer = setTimeout(() => { if (enabled) connectCDP(); }, 10000);
}

function updateStatusBar() {
  if (!statusBarItem) return;
  const connCount = [...cdpConnections.values()].filter(ws => ws.readyState === WebSocket.OPEN).length;
  if (!enabled) {
    statusBarItem.text = '$(x) Auto Accept: OFF';
    statusBarItem.tooltip = 'Antigravity Auto Accept: ' + t('sbOff');
  } else if (connCount > 0) {
    statusBarItem.text = '$(check) Auto Accept: ON | CDP x' + connCount;
    statusBarItem.tooltip = 'Antigravity Auto Accept: ' + t('sbRunning') + '\n\n'
      + t('sbFileAccept') + ': ' + (autoAcceptFiles ? 'ON' : 'OFF') + '\n'
      + t('sbTermRun') + ': ' + (autoRunTerminal ? 'ON' : 'OFF') + '\n'
      + t('sbBlacklist') + ': ' + (blacklistAction === 'reject' ? t('sbBlReject') : t('sbBlStop')) + '\n'
      + 'CDP: ' + t('sbCdpConn') + ' ' + connCount + ' ' + t('sbCdpTargets') + '\n\n'
      + t('sbClickSettings');
  } else {
    statusBarItem.text = '$(warning) Auto Accept: ON | CDP Disconnected';
    statusBarItem.tooltip = 'Antigravity Auto Accept: ' + t('sbRunning') + '\n\nCDP: ' + t('sbCdpDisconn') + '\n\n' + t('sbClickSettings');
  }
  // sync settings panel
  refreshSettingsPanel();
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function log(msg) {
  outputChannel.appendLine('[' + new Date().toLocaleTimeString() + '] ' + msg);
}

module.exports = { activate, deactivate };
