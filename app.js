/* ============================================================
   AI Debate Studio - 核心逻辑
   ============================================================ */

// ---------- 常量 ----------
const LS_KEYS = {
  models: 'debate_models',
  topic: 'debate_topic',
  rounds: 'debate_rounds',
  corsProxy: 'debate_cors_proxy'
};

// 模型颜色调色板（循环分配）
const MODEL_COLORS = [
  '#4a6cf7', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#f43f5e', '#84cc16', '#6366f1', '#14b8a6',
  '#d946ef', '#eab308', '#3b82f6', '#22c55e', '#a855f7'
];

// 辩论状态机
const DEBATE_STATE = { IDLE: 'idle', RUNNING: 'running', STOPPED: 'stopped' };

// ---------- 全局状态 ----------
let state = {
  models: [],            // 模型配置数组
  topic: '',
  rounds: 3,
  corsProxy: '',
  debateState: DEBATE_STATE.IDLE,
  currentModelIndex: 0,  // 当前正在发言的模型索引
  currentRound: 0,       // 当前轮数
  abortController: null, // 用于停止 fetch
  history: [],           // 发言历史 [{modelIndex, modelName, color, content, thinking, timestamp}]
  activeMessageEl: null, // 当前正在流式输出的消息 DOM 元素
  activeThinkingEl: null,
  expandedCards: new Set(), // 展开了详情的模型卡片索引集合
  historyRecords: [],    // 辩论历史记录（内存，刷新消失）
  historyExpanded: false // 历史记录区域是否展开
};

// ---------- DOM 引用 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOM = {
  topicInput: $('#topicInput'),
  roundsInput: $('#roundsInput'),
  corsProxyInput: $('#corsProxyInput'),
  modelList: $('#modelList'),
  addModelBtn: $('#addModelBtn'),
  startBtn: $('#startBtn'),
  stopBtn: $('#stopBtn'),
  exportBtn: $('#exportBtn'),
  exportConfigBtn: $('#exportConfigBtn'),
  importConfigBtn: $('#importConfigBtn'),
  importConfigFile: $('#importConfigFile'),
  newDebateBtn: $('#newDebateBtn'),
  chatContainer: $('#chatContainer'),
  chatEmpty: $('#chatEmpty'),
  chatMessages: $('#chatMessages'),
  statusIndicator: $('#statusIndicator'),
  statusText: $('#statusText'),
  statusRounds: $('#statusRounds'),
  historySection: $('#historySection'),
  historyToggle: $('#historyToggle'),
  historyList: $('#historyList'),
  historyCount: $('#historyCount'),
  clearHistoryBtn: $('#clearHistoryBtn')
};

// ---------- 工具函数 ----------

/** 格式化时间 */
function formatTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

/** 获取模型的颜色 */
function getModelColor(index) {
  return MODEL_COLORS[index % MODEL_COLORS.length];
}

/** 创建 Toast 容器（单例） */
function ensureToastContainer() {
  let container = $('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

/** 显示 Toast 通知 */
function showToast(message, type = '') {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  toast.addEventListener('animationend', (e) => {
    if (e.animationName === 'toastOut') {
      toast.remove();
    }
  });
}

// ---------- 持久化 ----------

/** 保存所有配置到 localStorage */
function saveConfig() {
  try {
    localStorage.setItem(LS_KEYS.models, JSON.stringify(state.models));
    localStorage.setItem(LS_KEYS.topic, state.topic);
    localStorage.setItem(LS_KEYS.rounds, String(state.rounds));
    localStorage.setItem(LS_KEYS.corsProxy, state.corsProxy);
  } catch (e) {
    console.warn('localStorage 写入失败:', e);
  }
}

/** 从 localStorage 加载配置 */
function loadConfig() {
  try {
    const models = localStorage.getItem(LS_KEYS.models);
    if (models) {
      state.models = JSON.parse(models);
    }
    state.topic = localStorage.getItem(LS_KEYS.topic) || '';
    const rounds = localStorage.getItem(LS_KEYS.rounds);
    state.rounds = rounds ? parseInt(rounds, 10) : 3;
    state.corsProxy = localStorage.getItem(LS_KEYS.corsProxy) || '';
  } catch (e) {
    console.warn('localStorage 读取失败:', e);
  }
}

// ---------- 模型管理 ----------

/** 创建默认模型配置 */
function createDefaultModel() {
  return {
    name: '',
    apiType: 'deepseek',     // 'deepseek' | 'openai'
    apiKey: '',
    baseUrl: '',
    modelName: '',
    systemPrompt: ''
  };
}

/** 获取模型的 Base URL（处理默认值） */
function getEffectiveBaseUrl(model) {
  if (model.baseUrl && model.baseUrl.trim()) {
    return model.baseUrl.trim().replace(/\/+$/, '');
  }
  if (model.apiType === 'deepseek') {
    return 'https://api.deepseek.com/v1';
  }
  return 'https://api.openai.com/v1';
}

/** 获取模型的 API 端点 */
function getApiEndpoint(model) {
  const base = getEffectiveBaseUrl(model);
  return `${base}/chat/completions`;
}

/** 渲染模型列表 */
function renderModelList() {
  if (state.models.length === 0) {
    DOM.modelList.innerHTML = `
      <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.82rem;">
        尚未添加模型，点击「+ 添加」
      </div>`;
    return;
  }

  DOM.modelList.innerHTML = state.models.map((m, i) => {
    const color = getModelColor(i);
    const expanded = state.expandedCards.has(i);
    const isDragging = DOM.modelList.dataset.draggingIndex === String(i);
    return `
      <div class="model-card ${expanded ? 'expanded' : ''} ${isDragging ? 'dragging' : ''}"
           draggable="true"
           data-index="${i}"
           id="modelCard${i}">
        <div class="model-card-header">
          <span class="model-drag-handle">&#9776;</span>
          <span class="model-name-display">
            <span class="model-color-dot" style="background:${color}"></span>
            ${escHtml(m.name) || '未命名模型'}
          </span>
          <div class="model-actions">
            <button class="btn-icon toggle-card" data-index="${i}" title="展开/折叠">${expanded ? '&#9650;' : '&#9660;'}</button>
            <button class="btn-icon delete" data-index="${i}" title="删除">&#10005;</button>
          </div>
        </div>
        <div class="model-card-body">
          <div class="form-group">
            <label>名称</label>
            <input type="text" class="model-name" data-index="${i}" value="${escAttr(m.name)}" placeholder="例如: 激进派辩手">
          </div>
          <div class="form-group">
            <label>API 类型</label>
            <select class="model-api-type" data-index="${i}">
              <option value="deepseek" ${m.apiType === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
              <option value="openai" ${m.apiType === 'openai' ? 'selected' : ''}>OpenAI 兼容</option>
            </select>
          </div>
          <div class="form-group">
            <label>API Key</label>
            <input type="password" class="model-api-key" data-index="${i}" value="${escAttr(m.apiKey)}" placeholder="sk-...">
          </div>
          <div class="form-group">
            <label>Base URL</label>
            <input type="text" class="model-base-url" data-index="${i}" value="${escAttr(m.baseUrl)}" placeholder="留空使用默认">
          </div>
          <div class="form-group">
            <label>模型名</label>
            <input type="text" class="model-model-name" data-index="${i}" value="${escAttr(m.modelName)}" placeholder="deepseek-chat / gpt-4o">
          </div>
          <div class="form-group">
            <label>系统提示词（角色/立场/人格）</label>
            <textarea class="model-system-prompt" data-index="${i}" rows="2" placeholder="你是一位...">${escHtml(m.systemPrompt)}</textarea>
          </div>
        </div>
      </div>`;
  }).join('');

  // 绑定拖拽事件
  bindDragEvents();
  // 绑定卡片内输入事件
  bindCardInputEvents();
  // 绑定卡片操作按钮
  bindCardActionEvents();
}

/** 绑定拖拽事件 */
function bindDragEvents() {
  const cards = $$('.model-card');
  cards.forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragend', handleDragEnd);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('dragleave', handleDragLeave);
    card.addEventListener('drop', handleDrop);
  });
}

function handleDragStart(e) {
  if (state.debateState === DEBATE_STATE.RUNNING) {
    e.preventDefault();
    return;
  }
  const index = parseInt(e.currentTarget.dataset.index, 10);
  e.dataTransfer.setData('text/plain', String(index));
  e.dataTransfer.effectAllowed = 'move';
  DOM.modelList.dataset.draggingIndex = String(index);
  // 延迟添加 dragging 类，让浏览器截图先完成
  requestAnimationFrame(() => {
    e.currentTarget.classList.add('dragging');
  });
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  DOM.modelList.dataset.draggingIndex = '';
  $$('.model-card').forEach(c => c.classList.remove('drag-over'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
  const toIndex = parseInt(e.currentTarget.dataset.index, 10);
  if (fromIndex === toIndex || isNaN(fromIndex) || isNaN(toIndex)) return;

  // 重新排序
  const [moved] = state.models.splice(fromIndex, 1);
  state.models.splice(toIndex, 0, moved);
  saveConfig();
  renderModelList();
  showToast('模型排序已更新', 'success');
}

/** 绑定卡片输入事件 */
function bindCardInputEvents() {
  const inputs = $$('.model-card input[type="text"], .model-card input[type="password"], .model-card textarea, .model-card select');
  inputs.forEach(input => {
    input.addEventListener('input', handleCardInput);
    input.addEventListener('change', handleCardInput);
  });
}

function handleCardInput(e) {
  const index = parseInt(e.target.dataset.index, 10);
  if (isNaN(index) || index >= state.models.length) return;

  const fieldMap = {
    'model-name': 'name',
    'model-api-type': 'apiType',
    'model-api-key': 'apiKey',
    'model-base-url': 'baseUrl',
    'model-model-name': 'modelName',
    'model-system-prompt': 'systemPrompt'
  };

  const field = fieldMap[e.target.className];
  if (field) {
    state.models[index][field] = e.target.value;
    saveConfig();

    // 更新卡片标题
    if (field === 'name') {
      const card = document.getElementById(`modelCard${index}`);
      if (card) {
        const nameDisplay = card.querySelector('.model-name-display');
        const dot = nameDisplay.querySelector('.model-color-dot').outerHTML;
        nameDisplay.innerHTML = dot + (escHtml(e.target.value) || '未命名模型');
      }
    }
  }
}

/** 绑定卡片操作按钮事件 */
function bindCardActionEvents() {
  // 展开/折叠
  $$('.toggle-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index, 10);
      if (state.expandedCards.has(index)) {
        state.expandedCards.delete(index);
      } else {
        state.expandedCards.add(index);
      }
      renderModelList();
    });
  });

  // 删除
  $$('.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.index, 10);
      removeModel(index);
    });
  });

  // 点击卡片头部切换展开
  $$('.model-card-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // 如果点击的是操作按钮则不触发
      if (e.target.closest('button')) return;
      const card = header.closest('.model-card');
      const index = parseInt(card.dataset.index, 10);
      if (state.expandedCards.has(index)) {
        state.expandedCards.delete(index);
      } else {
        state.expandedCards.add(index);
      }
      renderModelList();
    });
  });
}

/** 添加模型 */
function addModel() {
  const m = createDefaultModel();
  state.models.push(m);
  state.expandedCards.add(state.models.length - 1); // 新卡片默认展开
  saveConfig();
  renderModelList();
  // 滚动到底部
  setTimeout(() => {
    DOM.modelList.scrollTop = DOM.modelList.scrollHeight;
  }, 50);
}

/** 删除模型 */
function removeModel(index) {
  if (index < 0 || index >= state.models.length) return;
  const name = state.models[index].name || `模型 #${index + 1}`;
  state.models.splice(index, 1);
  // 更新 expandedCards 中的索引
  const newSet = new Set();
  for (const i of state.expandedCards) {
    if (i < index) newSet.add(i);
    else if (i > index) newSet.add(i - 1);
  }
  state.expandedCards = newSet;
  saveConfig();
  renderModelList();
  showToast(`已删除: ${name}`);
}

// ---------- HTML 转义 ----------
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- 辩论核心 ----------

/** 验证配置是否齐全 */
function validateConfig() {
  if (!state.topic.trim()) {
    showToast('请先设置辩论/协作主题', 'error');
    return false;
  }
  if (state.models.length === 0) {
    showToast('请至少添加一个模型', 'error');
    return false;
  }
  for (let i = 0; i < state.models.length; i++) {
    const m = state.models[i];
    const label = m.name || `模型 #${i + 1}`;
    if (!m.apiKey.trim()) {
      showToast(`${label}: 请填写 API Key`, 'error');
      return false;
    }
    if (!m.modelName.trim()) {
      showToast(`${label}: 请填写模型名`, 'error');
      return false;
    }
  }
  return true;
}

/** 开始辩论 */
async function startDebate() {
  if (!validateConfig()) return;

  // 重置状态
  state.debateState = DEBATE_STATE.RUNNING;
  state.currentModelIndex = 0;
  state.currentRound = 1;
  state.history = [];
  state.abortController = new AbortController();
  state.activeMessageEl = null;
  state.activeThinkingEl = null;

  // 清空聊天区
  DOM.chatMessages.innerHTML = '';
  DOM.chatEmpty.style.display = 'none';

  // 更新 UI
  updateUIState();
  updateStatusBar();

  // 启动发言循环
  await debateLoop();
}

/** 辩论主循环 */
async function debateLoop() {
  while (state.debateState === DEBATE_STATE.RUNNING) {
    // 检查是否达到轮数限制
    if (state.rounds > 0 && state.currentRound > state.rounds) {
      finishDebate('已完成所有轮数');
      return;
    }

    // 当前模型发言
    const model = state.models[state.currentModelIndex];
    if (!model) {
      finishDebate('模型列表为空，辩论终止');
      return;
    }

    updateStatusBar();

    const success = await speakModel(model, state.currentModelIndex);
    if (!success && state.debateState === DEBATE_STATE.RUNNING) {
      // API 调用失败但未被用户停止
      finishDebate('API 调用出错，辩论中断');
      return;
    }

    if (state.debateState !== DEBATE_STATE.RUNNING) break;

    // 推进到下一个模型
    state.currentModelIndex++;
    if (state.currentModelIndex >= state.models.length) {
      state.currentModelIndex = 0;
      state.currentRound++;
    }
  }
}

/** 单个模型发言 */
async function speakModel(model, modelIndex) {
  const color = getModelColor(modelIndex);
  const speakerName = model.name || `模型 #${modelIndex + 1}`;

  // 创建发言消息 DOM
  const messageEl = createMessageBubble(speakerName, color, true);
  DOM.chatMessages.appendChild(messageEl);
  scrollToBottom();

  const contentEl = messageEl.querySelector('.message-content');
  const thinkingToggle = messageEl.querySelector('.thinking-toggle');
  const thinkingContent = messageEl.querySelector('.thinking-content');

  // 构建消息历史（只包含正式回复，不包含系统提示词和思考过程）
  const messages = buildMessages(model);

  // 流式调用 API
  try {
    await streamChat(model, messages, {
      onThinking(chunk) {
        // 首次收到思考内容时，自动展开
        if (!thinkingContent.classList.contains('visible')) {
          thinkingContent.classList.add('visible');
          thinkingToggle.classList.add('expanded');
          thinkingToggle.querySelector('.arrow').innerHTML = '&#9660;';
          thinkingToggle.querySelector('.label').textContent = '思考中...';
        }
        thinkingContent.textContent += chunk;
        scrollToBottom();
      },
      onContent(chunk) {
        contentEl.textContent += chunk;
        scrollToBottom();
      },
      onDone() {
        contentEl.classList.remove('streaming');
        messageEl.classList.remove('speaking');

        // 标记思考过程完成 — 默认折叠
        if (thinkingContent.textContent.trim()) {
          thinkingContent.classList.remove('visible');
          thinkingToggle.classList.remove('expanded');
          thinkingToggle.querySelector('.arrow').innerHTML = '&#9654;';
          thinkingToggle.querySelector('.label').textContent = '思考过程';
        } else {
          // 无思考内容则隐藏整个区域
          thinkingToggle.classList.add('hidden');
          thinkingContent.classList.add('hidden');
        }
      },
      onError(err) {
        contentEl.classList.remove('streaming');
        messageEl.classList.remove('speaking');
        contentEl.textContent += `\n\n[错误] ${err}`;
      },
      signal: state.abortController.signal
    });

    // 记录到历史
    state.history.push({
      modelIndex,
      modelName: speakerName,
      color,
      content: contentEl.textContent,
      thinking: thinkingContent.textContent,
      timestamp: formatTime()
    });

    return true;
  } catch (err) {
    if (err.name === 'AbortError') {
      contentEl.textContent += '\n\n[已停止]';
      contentEl.classList.remove('streaming');
      messageEl.classList.remove('speaking');
      return false;
    }
    contentEl.classList.remove('streaming');
    messageEl.classList.remove('speaking');
    contentEl.textContent += `\n\n[网络错误] ${err.message}`;
    return false;
  }
}

/** 构建 API 消息数组 */
function buildMessages(currentModel) {
  const messages = [];

  // 系统提示词
  if (currentModel.systemPrompt && currentModel.systemPrompt.trim()) {
    messages.push({ role: 'system', content: currentModel.systemPrompt.trim() });
  }

  // 用户消息：全局主题 + 发言历史
  let userContent = `## 辩论/协作主题\n${state.topic}\n\n`;

  if (state.history.length > 0) {
    userContent += `## 此前发言记录\n\n`;
    state.history.forEach((h, i) => {
      userContent += `### ${h.modelName} (发言 #${i + 1})\n${h.content}\n\n`;
    });
  } else {
    userContent += `本轮为第一轮发言，请就主题发表你的观点。`;
  }

  messages.push({ role: 'user', content: userContent });
  return messages;
}

/** 流式调用 API */
async function streamChat(model, messages, callbacks) {
  const { onThinking, onContent, onDone, onError, signal } = callbacks;
  const endpoint = state.corsProxy
    ? state.corsProxy.replace(/\/+$/, '') + '/' + getApiEndpoint(model).replace(/^https?:\/\//, '')
    : getApiEndpoint(model);

  const body = {
    model: model.modelName.trim(),
    messages: messages,
    stream: true
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${model.apiKey.trim()}`
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const errBody = await response.text();
      errMsg += `: ${errBody.substring(0, 200)}`;
    } catch (_) {}
    onError(errMsg);
    throw new Error(errMsg);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          onDone();
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
          if (delta) {
            // DeepSeek 思考过程
            if (delta.reasoning_content) {
              onThinking(delta.reasoning_content);
            }
            // 正式回复
            if (delta.content) {
              onContent(delta.content);
            }
          }
        } catch (_) {
          // 忽略解析错误的行
        }
      }
    }
  }

  onDone();
}

/** 停止辩论 */
function stopDebate() {
  if (state.debateState !== DEBATE_STATE.RUNNING) return;
  state.debateState = DEBATE_STATE.STOPPED;
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }
  // 如果有发言历史则保存记录
  if (state.history.length > 0) {
    saveDebateRecord();
  }
  updateUIState();
  updateStatusBar();
}

/** 完成辩论 */
function finishDebate(reason) {
  state.debateState = DEBATE_STATE.IDLE;
  state.abortController = null;
  saveDebateRecord();
  updateUIState();
  updateStatusBar();
  showToast(reason, 'success');
}

/** 创建发言气泡 DOM */
function createMessageBubble(name, color, isActive) {
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isActive ? 'speaking' : ''}`;

  const initial = name.charAt(0).toUpperCase();
  bubble.innerHTML = `
    <div class="message-avatar" style="background:${color}">${escHtml(initial)}</div>
    <div class="message-body">
      <div class="message-header">
        <span class="message-sender" style="color:${color}">${escHtml(name)}</span>
        <span class="message-time">${formatTime()}</span>
      </div>
      <button class="thinking-toggle">
        <span class="arrow">&#9654;</span>
        <span class="label">思考过程</span>
      </button>
      <div class="thinking-content"></div>
      <div class="message-content streaming">${isActive ? '<span class="cursor-blink"></span>' : ''}</div>
    </div>
  `;

  // 绑定思考过程折叠/展开
  const toggle = bubble.querySelector('.thinking-toggle');
  const thinkingContent = bubble.querySelector('.thinking-content');
  toggle.addEventListener('click', () => {
    const isOpen = !thinkingContent.classList.contains('visible');
    if (isOpen) {
      thinkingContent.classList.add('visible');
      toggle.classList.add('expanded');
      toggle.querySelector('.arrow').innerHTML = '&#9660;';
    } else {
      thinkingContent.classList.remove('visible');
      toggle.classList.remove('expanded');
      toggle.querySelector('.arrow').innerHTML = '&#9654;';
    }
  });

  return bubble;
}

// ---------- UI 状态 ----------

/** 更新 UI 状态（按钮启用/禁用） */
function updateUIState() {
  const running = state.debateState === DEBATE_STATE.RUNNING;

  DOM.startBtn.disabled = running;
  DOM.stopBtn.disabled = !running;
  DOM.topicInput.disabled = running;
  DOM.roundsInput.disabled = running;
  DOM.corsProxyInput.disabled = running;
  DOM.addModelBtn.disabled = running;
  DOM.newDebateBtn.disabled = false; // 新建辩论始终可用

  // 更新状态指示器
  DOM.statusIndicator.className = 'status-indicator';
  if (running) {
    DOM.statusIndicator.classList.add('status-running');
  } else {
    DOM.statusIndicator.classList.add('status-idle');
  }
}

/** 更新状态栏文本 */
function updateStatusBar() {
  if (state.debateState === DEBATE_STATE.IDLE) {
    DOM.statusText.textContent = '就绪';
    DOM.statusRounds.textContent = '';
  } else if (state.debateState === DEBATE_STATE.RUNNING) {
    const model = state.models[state.currentModelIndex];
    const name = model ? (model.name || `模型 #${state.currentModelIndex + 1}`) : '未知';
    DOM.statusText.textContent = `发言中: ${name}`;
    const roundInfo = state.rounds > 0
      ? `第 ${state.currentRound} / ${state.rounds} 轮`
      : `第 ${state.currentRound} 轮 (无限)`;
    DOM.statusRounds.textContent = roundInfo;
  } else if (state.debateState === DEBATE_STATE.STOPPED) {
    DOM.statusText.textContent = '已停止';
  }
}

/** 滚动聊天区到底部 */
function scrollToBottom() {
  DOM.chatContainer.scrollTop = DOM.chatContainer.scrollHeight;
}

/** 导出对话为文本文件 */
function exportDebate() {
  if (state.history.length === 0) {
    showToast('尚无发言记录可导出', 'error');
    return;
  }

  const topic = state.topic.trim() || '未命名主题';
  const safeTopic = topic.replace(/[\\/:*?"<>|]/g, '_').substring(0, 50);
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const filename = `debate-${safeTopic}-${ts}.txt`;

  const sep = '='.repeat(60);
  let text = `${sep}\n`;
  text += `  AI Debate Studio - 对话导出\n`;
  text += `  主题: ${topic}\n`;
  text += `  导出时间: ${now.toLocaleString('zh-CN')}\n`;
  text += `  总发言数: ${state.history.length}\n`;
  text += `${sep}\n\n`;

  state.history.forEach((h, i) => {
    text += `【发言 #${i + 1}】${h.modelName}  —  ${h.timestamp}\n`;
    text += `${'-'.repeat(50)}\n`;

    if (h.thinking && h.thinking.trim()) {
      text += `[思考过程]\n${h.thinking.trim()}\n\n`;
    }

    text += `[发言内容]\n${h.content.trim()}\n\n`;
    text += `${sep}\n\n`;
  });

  const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`已导出: ${filename}`, 'success');
}

// ---------- 配置导出/导入 ----------

/** 导出配置为纯文本文档 */
function exportConfig() {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  let text = '=== AI Debate Studio 配置文件 ===\n';
  text += '版本: 1.0\n';
  text += `导出时间: ${timeStr}\n\n`;
  text += '[全局设置]\n';
  text += `辩论主题: ${state.topic}\n`;
  text += `发言轮数: ${state.rounds}\n`;
  text += `CORS代理: ${state.corsProxy}\n`;

  state.models.forEach((m, i) => {
    text += '\n' + '='.repeat(40) + '\n';
    text += `[模型 ${i + 1}]\n`;
    text += `名称: ${m.name}\n`;
    text += `API类型: ${m.apiType === 'openai' ? 'OpenAI' : 'DeepSeek'}\n`;
    text += `Base URL: ${m.baseUrl}\n`;
    text += `模型名: ${m.modelName}\n`;
    text += `API Key: ${m.apiKey}\n`;
    if (m.systemPrompt && m.systemPrompt.trim()) {
      // 系统提示词可能跨行，用双引号包裹并保留原始换行
      text += `系统提示词: "${m.systemPrompt}"\n`;
    } else {
      text += '系统提示词: \n';
    }
  });

  const filename = `debate-config-${ts}.txt`;
  const blob = new Blob(['\uFEFF' + text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`配置已导出: ${filename}`, 'success');
}

/** 触发导入配置文件选择器 */
function importConfig() {
  DOM.importConfigFile.click();
}

/** 处理导入配置文件（纯文本格式） */
function handleImportFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const text = evt.target.result;
      const lines = text.split(/\r?\n/);

      const result = {
        topic: '',
        rounds: 3,
        corsProxy: '',
        models: []
      };

      let currentSection = null; // 'global' | modelIndex
      let currentModel = null;
      let pendingKey = null;     // 上一行是 "系统提示词:" 且值跨行

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // 跳过空行和分隔线（= 组成）
        if (!trimmed || /^={3,}$/.test(trimmed)) continue;

        // 跳过文件头部（版本/导出时间等元信息直到遇到 [全局设置]）
        if (!currentSection && !trimmed.startsWith('[')) continue;

        // 段落切换
        if (trimmed === '[全局设置]') {
          currentSection = 'global';
          currentModel = null;
          pendingKey = null;
          continue;
        }

        const modelMatch = trimmed.match(/^\[模型\s+(\d+)\]$/);
        if (modelMatch) {
          // 保存上一个模型
          if (currentModel && currentSection === 'model') {
            result.models.push(currentModel);
          }
          currentSection = 'model';
          currentModel = {
            name: '',
            apiType: 'deepseek',
            apiKey: '',
            baseUrl: '',
            modelName: '',
            systemPrompt: ''
          };
          pendingKey = null;
          continue;
        }

        // 解析键值对
        const kvMatch = trimmed.match(/^(.+?)\s*:\s*(.*)$/);
        if (!kvMatch) {
          // 可能是跨行的系统提示词续行
          if (pendingKey === 'systemPrompt' && currentModel) {
            currentModel.systemPrompt += '\n' + trimmed;
          }
          continue;
        }

        const key = kvMatch[1].trim();
        let value = kvMatch[2];

        // 系统提示词特殊处理：去掉首尾引号
        if (key === '系统提示词') {
          const quoted = value.match(/^"(.*)"$/s);
          if (quoted) {
            value = quoted[1];
          }
        }

        if (currentSection === 'global') {
          if (key === '辩论主题') result.topic = value;
          else if (key === '发言轮数') result.rounds = parseInt(value, 10) || 0;
          else if (key === 'CORS代理') result.corsProxy = value;
        } else if (currentSection === 'model' && currentModel) {
          if (key === '名称') currentModel.name = value;
          else if (key === 'API类型') {
            currentModel.apiType = value.toLowerCase() === 'openai' ? 'openai' : 'deepseek';
          }
          else if (key === 'Base URL') currentModel.baseUrl = value;
          else if (key === '模型名') currentModel.modelName = value;
          else if (key === 'API Key') currentModel.apiKey = value;
          else if (key === '系统提示词') {
            currentModel.systemPrompt = value;
            pendingKey = 'systemPrompt';
            continue; // 不重置 pendingKey
          }
        }
        pendingKey = null;
      }

      // 保存最后一个模型
      if (currentModel && currentSection === 'model') {
        result.models.push(currentModel);
      }

      // 校验
      if (result.models.length === 0) {
        throw new Error('配置文件中未找到任何模型定义');
      }

      // 覆盖当前配置
      state.topic = result.topic;
      state.rounds = result.rounds;
      state.corsProxy = result.corsProxy;
      state.models = result.models;

      // 刷新 UI
      DOM.topicInput.value = state.topic;
      DOM.roundsInput.value = state.rounds;
      DOM.corsProxyInput.value = state.corsProxy;
      state.expandedCards.clear();
      renderModelList();
      saveConfig();
      showToast('配置导入成功', 'success');
    } catch (err) {
      showToast(`导入失败: ${err.message}`, 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');

  // 重置文件选择器以允许重复导入同一文件
  DOM.importConfigFile.value = '';
}

// ---------- 新建辩论 ----------

/** 新建辩论：清空发言、重置状态 */
function newDebate() {
  if (state.debateState === DEBATE_STATE.RUNNING) {
    // 先设状态为 STOPPED，防止 debateLoop 误调 finishDebate
    state.debateState = DEBATE_STATE.STOPPED;
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
  }

  state.debateState = DEBATE_STATE.IDLE;
  state.currentModelIndex = 0;
  state.currentRound = 0;
  state.history = [];
  state.activeMessageEl = null;
  state.activeThinkingEl = null;
  // 主题保留不清空
  // 模型配置保留不清空
  // 轮数重置为当前输入框的值
  state.rounds = parseInt(DOM.roundsInput.value, 10) || 0;
  saveConfig();

  // 清空聊天区
  DOM.chatMessages.innerHTML = '';
  DOM.chatEmpty.style.display = '';

  updateUIState();
  updateStatusBar();
  showToast('已新建辩论，当前发言已清除', 'success');
}

// ---------- 辩论历史记录 ----------

/** 保存当前辩论到历史记录（内存） */
function saveDebateRecord() {
  if (state.history.length === 0) return;

  const record = {
    id: Date.now(),
    topic: state.topic || '未命名主题',
    startTime: new Date().toISOString(),
    modelsSummary: state.models.map(m => m.name || '未命名').join(', '),
    messageCount: state.history.length,
    // 深拷贝历史数据以便恢复
    messages: state.history.map(h => ({
      modelIndex: h.modelIndex,
      modelName: h.modelName,
      color: h.color,
      content: h.content,
      thinking: h.thinking,
      timestamp: h.timestamp
    }))
  };

  state.historyRecords.unshift(record);

  renderHistoryList();
}

/** 渲染历史记录列表 */
function renderHistoryList() {
  const count = state.historyRecords.length;
  DOM.historyCount.textContent = count;
  DOM.clearHistoryBtn.style.display = count > 0 ? 'block' : 'none';

  if (count === 0) {
    DOM.historyList.innerHTML = '<div class="history-empty">暂无历史记录（刷新后消失）</div>';
    return;
  }

  DOM.historyList.innerHTML = state.historyRecords.map(r => {
    const time = new Date(r.startTime);
    const timeStr = `${String(time.getMonth()+1).padStart(2,'0')}-${String(time.getDate()).padStart(2,'0')} ${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}`;
    return `
      <div class="history-item" data-id="${r.id}">
        <div class="history-item-info">
          <div class="history-item-topic">${escHtml(r.topic)}</div>
          <div class="history-item-meta">
            <span>${timeStr}</span>
            <span>${r.messageCount} 条发言</span>
          </div>
        </div>
        <button class="history-item-del" data-id="${r.id}" title="删除">&times;</button>
      </div>`;
  }).join('');

  // 绑定事件
  DOM.historyList.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // 如果点击的是删除按钮则不触发
      if (e.target.closest('.history-item-del')) return;
      const id = parseInt(item.dataset.id, 10);
      restoreHistoryRecord(id);
    });
  });

  DOM.historyList.querySelectorAll('.history-item-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id, 10);
      deleteHistoryRecord(id);
    });
  });
}

/** 恢复历史记录到主区域查看 */
function restoreHistoryRecord(id) {
  const record = state.historyRecords.find(r => r.id === id);
  if (!record) return;

  // 恢复发言历史到 state（仅用于显示，不影响运行状态）
  state.history = record.messages.map(m => ({
    modelIndex: m.modelIndex,
    modelName: m.modelName,
    color: m.color,
    content: m.content,
    thinking: m.thinking,
    timestamp: m.timestamp
  }));

  // 渲染到聊天区
  DOM.chatMessages.innerHTML = '';
  DOM.chatEmpty.style.display = 'none';

  state.history.forEach(h => {
    const bubble = createMessageBubble(h.modelName, h.color, false);
    const contentEl = bubble.querySelector('.message-content');
    const thinkingToggle = bubble.querySelector('.thinking-toggle');
    const thinkingContent = bubble.querySelector('.thinking-content');

    contentEl.textContent = h.content;
    contentEl.classList.remove('streaming');

    if (h.thinking && h.thinking.trim()) {
      thinkingContent.textContent = h.thinking;
      // 默认折叠
    } else {
      thinkingToggle.classList.add('hidden');
      thinkingContent.classList.add('hidden');
    }

    DOM.chatMessages.appendChild(bubble);
  });

  scrollToBottom();
  showToast(`已恢复查看: ${escHtml(record.topic)}`);
}

/** 删除单条历史记录 */
function deleteHistoryRecord(id) {
  state.historyRecords = state.historyRecords.filter(r => r.id !== id);
  renderHistoryList();
}

/** 清空全部历史记录 */
function clearAllHistory() {
  if (state.historyRecords.length === 0) return;
  state.historyRecords = [];
  renderHistoryList();
  showToast('历史记录已清空');
}

/** 切换历史记录区域展开/折叠 */
function toggleHistory() {
  state.historyExpanded = !state.historyExpanded;
  if (state.historyExpanded) {
    DOM.historySection.classList.add('expanded');
    DOM.historyToggle.classList.add('expanded');
  } else {
    DOM.historySection.classList.remove('expanded');
    DOM.historyToggle.classList.remove('expanded');
  }
}

// ---------- 全局事件绑定 ----------

/** 初始化所有事件监听 */
function initEvents() {
  // 全局设置输入
  DOM.topicInput.addEventListener('input', () => {
    state.topic = DOM.topicInput.value;
    saveConfig();
  });
  DOM.roundsInput.addEventListener('input', () => {
    state.rounds = parseInt(DOM.roundsInput.value, 10) || 0;
    saveConfig();
  });
  DOM.corsProxyInput.addEventListener('input', () => {
    state.corsProxy = DOM.corsProxyInput.value;
    saveConfig();
  });

  // 添加模型
  DOM.addModelBtn.addEventListener('click', addModel);

  // 开始/停止
  DOM.startBtn.addEventListener('click', () => {
    if (state.debateState === DEBATE_STATE.IDLE) {
      startDebate();
    }
  });
  DOM.stopBtn.addEventListener('click', stopDebate);

  // 导出对话
  DOM.exportBtn.addEventListener('click', exportDebate);

  // 导出配置（确认对话框含隐私提醒）
  DOM.exportConfigBtn.addEventListener('click', () => {
    if (confirm('即将导出配置为 TXT 文件。\n\n⚠️ 注意：导出的文件包含所有模型的 API Key，请妥善保管，不要分享给他人。\n\n确定导出？')) {
      exportConfig();
    }
  });

  // 导入配置
  DOM.importConfigBtn.addEventListener('click', () => {
    if (confirm('将导入并覆盖当前全部配置（含API Key）。确定继续？')) {
      importConfig();
    }
  });
  DOM.importConfigFile.addEventListener('change', handleImportFile);

  // 新建辩论
  DOM.newDebateBtn.addEventListener('click', () => {
    if (state.debateState === DEBATE_STATE.RUNNING) {
      if (!confirm('当前正在进行辩论，新建将中断并清除所有发言记录。\n\n确定新建？')) return;
    } else if (state.history.length > 0) {
      if (!confirm('新建辩论将清除当前发言记录。\n\n确定新建？')) return;
    }
    newDebate();
  });

  // 历史记录展开/折叠
  DOM.historyToggle.addEventListener('click', toggleHistory);

  // 清空全部历史
  DOM.clearHistoryBtn.addEventListener('click', () => {
    if (confirm('确定清空全部历史记录？')) {
      clearAllHistory();
    }
  });

  // 快捷键：Ctrl+Enter 开始，Escape 停止
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (state.debateState === DEBATE_STATE.IDLE) {
        startDebate();
      }
    }
    if (e.key === 'Escape') {
      if (state.debateState === DEBATE_STATE.RUNNING) {
        stopDebate();
      }
    }
  });
}

// ---------- 初始化 ----------
function init() {
  loadConfig();
  // 恢复 UI
  DOM.topicInput.value = state.topic;
  DOM.roundsInput.value = state.rounds;
  DOM.corsProxyInput.value = state.corsProxy;
  renderModelList();
  updateUIState();
  updateStatusBar();
  initEvents();
}

// 启动
document.addEventListener('DOMContentLoaded', init);
