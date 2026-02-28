// ==UserScript==
// @name         我讨厌花式跳绳
// @namespace    http://tampermonkey.net/
// @version      3.1415926
// @description  录制多优先级请求序列，循环发送并通过条件脚本控制优先级切换（返回1继续/0切换/−1停止）
// @author       SkyRain
// @match        *://xsxk.ysu.edu.cn/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        defaultInterval: 500,  // 每轮请求间隔(ms)
        requestDelay: 100,     // 同一轮内请求间延迟(ms)
        enableDebug: true
    };

    // ==================== 状态 ====================
    const State = {
        isRecording: false,
        isPlaying: false,
        recordingPriority: 0,      // 当前录制到哪个优先级(索引)
        priorities: [              // 优先级组列表
            { name: '优先级 1', requests: [] },
            { name: '优先级 2', requests: [] }
        ],
        currentPriorityIndex: 0,   // 执行时当前优先级索引
        loopCount: 0,              // 当前优先级已循环次数
        logs: [],
        conditionFunc: null
    };

    // 保存原始方法
    const Originals = {
        fetch: unsafeWindow.fetch,
        XHR: {
            open: unsafeWindow.XMLHttpRequest.prototype.open,
            send: unsafeWindow.XMLHttpRequest.prototype.send,
            setRequestHeader: unsafeWindow.XMLHttpRequest.prototype.setRequestHeader
        }
    };

    // ==================== 工具 ====================
    const Utils = {
        generateId: () => 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),

        formatBytes: (bytes) => {
            if (!bytes) return '';
            const k = 1024, sizes = ['B', 'KB', 'MB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
        },

        clone: (obj) => {
            try { return JSON.parse(JSON.stringify(obj)); } catch { return {}; }
        },

        log: (type, message) => {
            const entry = { time: new Date().toLocaleTimeString('zh-CN'), type, message };
            State.logs.unshift(entry);
            if (State.logs.length > 80) State.logs.pop();
            UI.updateLogs();
            if (CONFIG.enableDebug) console.log(`[抢课脚本] ${message}`);
        },

        // 编译条件函数，脚本需 return 1 / 0 / -1
        compileCondition: (scriptText) => {
            try {
                return new Function('ctx', `with(ctx){ try{ ${scriptText} }catch(e){ throw new Error('条件脚本错误: '+e.message); } }`);
            } catch (e) {
                Utils.log('error', '条件脚本编译失败: ' + e.message);
                return null;
            }
        },

        // 执行条件脚本，返回 1(继续) / 0(切换) / -1(停止)，出错返回 1
        runCondition: (request, response) => {
            if (!State.conditionFunc) return 1;
            const ctx = {
                request, response,
                method: request.method,
                url: request.url,
                status: response.status,
                responseText: response.responseText || '',
                currentPriority: State.currentPriorityIndex + 1,
                loopCount: State.loopCount,
                log: (msg) => Utils.log('info', `[条件] ${msg}`),
                contains: (text) => (response.responseText || '').includes(text),
                json: () => { try { return JSON.parse(response.responseText || '{}'); } catch { return null; } }
            };
            try {
                const result = State.conditionFunc(ctx);
                const r = parseInt(result);
                if (r === 1 || r === 0 || r === -1) return r;
                Utils.log('warning', `条件脚本返回非法值: ${result}，视为继续(1)`);
                return 1;
            } catch (e) {
                Utils.log('error', '条件脚本执行失败: ' + e.message);
                return 1;
            }
        }
    };

    // 浏览器自动管理的请求头，导出时过滤掉
    const BROWSER_HEADERS = new Set([
        'cookie', 'cookie2', 'host', 'content-length',
        'connection', 'keep-alive', 'transfer-encoding',
        'te', 'trailer', 'upgrade', 'via',
        'accept-encoding', 'accept-charset',
        'access-control-request-headers', 'access-control-request-method',
        'origin', 'dnt', 'expect'
    ]);

    const ConfigIO = {
        // 过滤掉浏览器托管的头
        _cleanHeaders(headers) {
            const out = {};
            for (const [k, v] of Object.entries(headers || {})) {
                if (!BROWSER_HEADERS.has(k.toLowerCase())) out[k] = v;
            }
            return out;
        },

        export() {
            const data = {
                version: 1,
                interval: parseInt(UI.elements.intervalInput?.value) || 500,
                conditionScript: UI.elements.conditionInput?.value || '',
                priorities: State.priorities.map(p => ({
                    name: p.name,
                    requests: p.requests.map(r => ({
                        method: r.method,
                        url: r.url,
                        headers: this._cleanHeaders(r.headers),
                        body: r.body || null
                    }))
                }))
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `course-grabber-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
            Utils.log('success', `已导出配置（Cookie 等浏览器托管头已自动排除）`);
        },

        import(jsonText) {
            let data;
            try {
                data = JSON.parse(jsonText);
            } catch {
                Utils.log('error', '导入失败：JSON 格式错误');
                return;
            }
            if (!data.priorities || !Array.isArray(data.priorities)) {
                Utils.log('error', '导入失败：缺少 priorities 字段');
                return;
            }
            State.priorities = data.priorities.map(p => ({
                name: p.name || '未命名',
                requests: (p.requests || []).map(r => ({
                    id: Utils.generateId(),
                    method: r.method || 'GET',
                    url: r.url || '',
                    headers: r.headers || {},
                    body: r.body || null,
                    timestamp: Date.now()
                }))
            }));
            State.recordingPriority = 0;
            if (data.interval && UI.elements.intervalInput)
                UI.elements.intervalInput.value = data.interval;
            if (data.conditionScript && UI.elements.conditionInput)
                UI.elements.conditionInput.value = data.conditionScript;
            UI.updatePriorityTabs();
            UI.updatePriorityList();
            UI.updateStartPrioritySelect();
            const total = State.priorities.reduce((s, p) => s + p.requests.length, 0);
            Utils.log('success', `导入成功：${State.priorities.length} 个优先级，共 ${total} 条请求`);
        }
    };

    // ==================== 请求拦截器 ====================
    const Interceptor = {
        init() {
            this.interceptFetch();
            this.interceptXHR();
        },

        _record(method, url, headers, body) {
            if (!State.isRecording) return;
            const p = State.priorities[State.recordingPriority];
            if (!p) return;
            p.requests.push({
                id: Utils.generateId(),
                method: method.toUpperCase(),
                url, headers, body,
                timestamp: Date.now()
            });
            UI.updatePriorityList();
            Utils.log('info', `[P${State.recordingPriority + 1}] 录制: ${method.toUpperCase()} ${url}`);
        },

        interceptFetch() {
            unsafeWindow.fetch = async (...args) => {
                const [resource, config = {}] = args;
                const url = typeof resource === 'string' ? resource : resource.url;
                this._record(config.method || 'GET', url, Utils.clone(config.headers || {}), config.body || null);
                const p = State.isRecording ? State.priorities[State.recordingPriority] : null;
                const record = p ? p.requests[p.requests.length - 1] : null;
                try {
                    const resp = await Originals.fetch.apply(unsafeWindow, args);
                    if (record) {
                        const clone = resp.clone();
                        record.status = clone.status;
                        record.responseHeaders = {};
                        clone.headers.forEach((v, k) => { record.responseHeaders[k] = v; });
                        clone.text().then(t => { record.responseText = t; });
                    }
                    return resp;
                } catch (e) {
                    throw e;
                }
            };
        },

        interceptXHR() {
            unsafeWindow.XMLHttpRequest.prototype.setRequestHeader = function (h, v) {
                this._headers = this._headers || {};
                this._headers[h] = v;
                return Originals.XHR.setRequestHeader.call(this, h, v);
            };
            unsafeWindow.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                this._method = method; this._url = url; this._headers = {};
                return Originals.XHR.open.call(this, method, url, ...rest);
            };
            unsafeWindow.XMLHttpRequest.prototype.send = function (body) {
                Interceptor._record(this._method || 'GET', this._url, Utils.clone(this._headers || {}), body || null);
                const p = State.isRecording ? State.priorities[State.recordingPriority] : null;
                const record = p ? p.requests[p.requests.length - 1] : null;
                if (record) {
                    this.addEventListener('load', function () {
                        record.status = this.status;
                        record.responseText = this.responseText;
                        record.responseHeaders = {};
                        const raw = this.getAllResponseHeaders();
                        if (raw) raw.split('\r\n').forEach(line => {
                            const sep = line.indexOf(': ');
                            if (sep > 0) record.responseHeaders[line.slice(0, sep)] = line.slice(sep + 2);
                        });
                    });
                }
                return Originals.XHR.send.call(this, body);
            };
        }
    };

    // ==================== UI ====================
    const UI = {
        elements: {},

        init() {
            this.createStyles();
            this.createPanel();
            this.bindEvents();
            this.updatePriorityTabs();
            this.updatePriorityList();
        },

        createStyles() {
            const style = document.createElement('style');
            style.textContent = `
                #cg-panel {
                    position: fixed; bottom: 20px; right: 20px; width: 560px;
                    max-height: 82vh; background: #ffffff;
                    border: 1px solid #e2e5ea; border-radius: 10px; color: #1f2937;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    font-size: 13px; z-index: 2147483647;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
                    display: flex; flex-direction: column; overflow: hidden;
                }
                #cg-panel.collapsed {
                    width: 44px; height: 44px; border-radius: 22px;
                    cursor: pointer; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.15);
                }
                .cg-header {
                    background: #f8f9fb; padding: 10px 14px;
                    border-bottom: 1px solid #e8eaed;
                    display: flex; justify-content: space-between; align-items: center;
                    user-select: none; flex-shrink: 0;
                }
                .cg-title {
                    font-weight: 600; font-size: 13px; color: #111827;
                    display: flex; align-items: center; gap: 7px;
                }
                .cg-dot { width: 7px; height: 7px; border-radius: 50%; background: #d1d5db; display: inline-block; flex-shrink:0; }
                .cg-dot.recording { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,.5); animation: cgpulse 1.2s infinite; }
                .cg-dot.playing   { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,.5);  animation: cgpulse 1.2s infinite; }
                @keyframes cgpulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
                .cg-body { flex:1; overflow-y:auto; padding:10px 12px; display:flex; flex-direction:column; gap:8px; }
                .cg-body::-webkit-scrollbar { width:5px; }
                .cg-body::-webkit-scrollbar-track { background:transparent; }
                .cg-body::-webkit-scrollbar-thumb { background:#d1d5db; border-radius:3px; }
                .cg-section {
                    background: #fafafa; border: 1px solid #e8eaed;
                    border-radius: 7px; padding: 10px 12px;
                }
                .cg-section-title {
                    font-size: 10px; color: #9ca3af; text-transform: uppercase;
                    font-weight: 700; margin-bottom: 9px; letter-spacing: .6px;
                }
                /* 按钮 */
                .btn {
                    padding: 5px 11px; border: 1px solid #e2e5ea; border-radius: 5px;
                    cursor: pointer; font-size: 12px; font-weight: 500;
                    background: #fff; color: #374151; transition: all .15s;
                    white-space: nowrap;
                }
                .btn:hover { background: #f3f4f6; border-color: #d1d5db; }
                .btn:disabled { opacity: .4; cursor: not-allowed; }
                .btn.rec { background: #fef2f2; border-color: #fca5a5; color: #dc2626; }
                .btn.rec:hover { background: #fee2e2; }
                .btn.rec.active-rec { background: #dc2626; border-color: #dc2626; color: #fff; }
                .btn.go  { background: #f0fdf4; border-color: #86efac; color: #16a34a; }
                .btn.go:hover  { background: #dcfce7; }
                .btn.stop { background: #fff7ed; border-color: #fdba74; color: #ea580c; }
                .btn.stop:hover { background: #ffedd5; }
                .btn.add { background: #eff6ff; border-color: #93c5fd; color: #2563eb; }
                .btn.add:hover { background: #dbeafe; }
                .btn.del { background: #fff; border-color: #fca5a5; color: #dc2626; }
                .btn.del:hover { background: #fef2f2; }
                /* 优先级标签 */
                .cg-tabs { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px; }
                .cg-tab {
                    padding: 3px 10px; border-radius: 5px; cursor: pointer; font-size: 12px;
                    background: #fff; border: 1px solid #e2e5ea; color: #6b7280; transition: all .15s;
                }
                .cg-tab:hover { border-color: #93c5fd; color: #2563eb; }
                .cg-tab.active { background: #eff6ff; border-color: #3b82f6; color: #1d4ed8; font-weight:600; }
                .cg-tab.playing-tab { border-color: #22c55e; color: #15803d; background:#f0fdf4; }
                /* 请求列表 */
                .cg-req-list {
                    max-height: 150px; overflow-y: auto;
                    border: 1px solid #e8eaed; border-radius: 5px; background: #fff;
                }
                .cg-req-list::-webkit-scrollbar { width:4px; }
                .cg-req-list::-webkit-scrollbar-thumb { background:#e2e5ea; border-radius:2px; }
                .cg-req-item {
                    padding: 5px 10px; border-bottom: 1px solid #f3f4f6;
                    display: flex; align-items: center; gap: 8px;
                }
                .cg-req-item:last-child { border-bottom: none; }
                .cg-req-item:hover { background: #f9fafb; }
                .cg-method {
                    font-weight: 700; font-size: 10px; padding: 2px 5px;
                    border-radius: 3px; min-width: 38px; text-align: center; flex-shrink:0;
                }
                .m-GET    { background:#dbeafe; color:#1d4ed8; }
                .m-POST   { background:#dcfce7; color:#15803d; }
                .m-PUT    { background:#fef9c3; color:#a16207; }
                .m-DELETE { background:#fee2e2; color:#b91c1c; }
                .m-PATCH  { background:#cffafe; color:#0e7490; }
                .cg-url { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#4b5563; font-size:12px; }
                .cg-req-del { color:#d1d5db; cursor:pointer; font-size:13px; padding:0 3px; flex-shrink:0; }
                .cg-req-del:hover { color:#ef4444; }
                /* 输入 */
                .cg-row { display:flex; gap:8px; align-items:center; margin-bottom:7px; }
                .cg-row:last-child { margin-bottom:0; }
                .cg-label { min-width:68px; color:#6b7280; font-size:12px; flex-shrink:0; }
                .cg-input {
                    flex:1; background:#fff; border:1px solid #e2e5ea; color:#111827;
                    padding:5px 8px; border-radius:5px; font-family:monospace; font-size:12px;
                }
                .cg-input:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 2px rgba(59,130,246,.1); }
                textarea.cg-input { min-height:100px; resize:vertical; line-height:1.6; font-size:11.5px; }
                .cg-hint { font-size:11px; color:#9ca3af; margin-top:4px; line-height:1.5; }
                /* 操作区 */
                .cg-action-row { display:flex; gap:8px; align-items:center; }
                /* 状态栏 */
                .cg-status-bar {
                    background: #f0f9ff; border: 1px solid #bae6fd;
                    border-radius: 5px; padding: 5px 10px;
                    font-family: monospace; font-size: 12px; color: #0369a1;
                    margin-top: 8px;
                }
                /* 日志 */
                .cg-log {
                    max-height: 120px; overflow-y: auto;
                    background: #f9fafb; border: 1px solid #e8eaed;
                    border-radius: 5px; padding: 6px 8px;
                    font-family: monospace; font-size: 11px;
                }
                .cg-log::-webkit-scrollbar { width:4px; }
                .cg-log::-webkit-scrollbar-thumb { background:#e2e5ea; border-radius:2px; }
                .cg-log-entry { padding:2px 0; border-bottom:1px solid #f3f4f6; line-height:1.5; }
                .cg-log-entry:last-child { border-bottom:none; }
                .cg-log-time { color:#9ca3af; margin-right:5px; }
                .log-info    { color:#16a34a; }
                .log-error   { color:#dc2626; }
                .log-warning { color:#d97706; }
                .log-success { color:#2563eb; }
                .collapsed .cg-body { display:none; }
                .cg-toggle {
                    background: transparent; border: none; color: #9ca3af;
                    cursor: pointer; font-size: 15px; padding: 0 3px; line-height:1;
                }
                .cg-toggle:hover { color: #374151; }
                .cg-priority-badge {
                    display:inline-block; padding:1px 7px; border-radius:10px; font-size:10px; font-weight:600;
                    background:#dbeafe; color:#1d4ed8; margin-left:4px;
                }
                .cg-priority-badge.active-exec { background:#dcfce7; color:#15803d; }
                .cg-btn-group { display:flex; gap:5px; flex-wrap:wrap; margin-bottom:8px; }
                /* 弹出检查窗口 */
                .cg-modal-overlay {
                    position: fixed; inset: 0; background: rgba(0,0,0,0.35);
                    z-index: 2147483648; display: flex; align-items: center; justify-content: center;
                }
                .cg-modal {
                    background: #fff; border-radius: 10px; width: 580px; max-width: 95vw;
                    max-height: 80vh; display: flex; flex-direction: column;
                    box-shadow: 0 16px 48px rgba(0,0,0,0.18); overflow: hidden;
                }
                .cg-modal-header {
                    padding: 12px 16px; border-bottom: 1px solid #e8eaed;
                    display: flex; align-items: center; justify-content: space-between;
                    background: #f8f9fb; flex-shrink: 0;
                }
                .cg-modal-title { font-weight: 600; font-size: 13px; color: #111827; display:flex; align-items:center; gap:8px; }
                .cg-modal-close {
                    background: none; border: none; cursor: pointer; color: #9ca3af;
                    font-size: 18px; line-height: 1; padding: 0 2px;
                }
                .cg-modal-close:hover { color: #374151; }
                .cg-modal-tabs { display: flex; gap: 0; border-bottom: 1px solid #e8eaed; flex-shrink: 0; }
                .cg-modal-tab {
                    padding: 8px 16px; font-size: 12px; font-weight: 500; cursor: pointer;
                    color: #6b7280; border-bottom: 2px solid transparent; margin-bottom: -1px;
                    transition: all .15s;
                }
                .cg-modal-tab:hover { color: #374151; }
                .cg-modal-tab.active { color: #2563eb; border-bottom-color: #2563eb; }
                .cg-modal-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
                .cg-modal-body::-webkit-scrollbar { width: 5px; }
                .cg-modal-body::-webkit-scrollbar-thumb { background: #e2e5ea; border-radius: 3px; }
                .cg-modal-pane { display: none; }
                .cg-modal-pane.active { display: block; }
                .cg-info-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: flex-start; }
                .cg-info-key { min-width: 80px; font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase; padding-top: 1px; flex-shrink: 0; }
                .cg-info-val { font-family: monospace; font-size: 12px; color: #1f2937; word-break: break-all; }
                .cg-headers-table { width: 100%; border-collapse: collapse; font-size: 12px; }
                .cg-headers-table th { text-align: left; padding: 4px 8px; background: #f3f4f6; color: #6b7280; font-weight: 600; font-size: 11px; border-bottom: 1px solid #e8eaed; }
                .cg-headers-table td { padding: 4px 8px; border-bottom: 1px solid #f3f4f6; font-family: monospace; vertical-align: top; }
                .cg-headers-table td:first-child { color: #6b7280; white-space: nowrap; }
                .cg-headers-table td:last-child { color: #1f2937; word-break: break-all; }
                .cg-body-pre {
                    background: #f9fafb; border: 1px solid #e8eaed; border-radius: 5px;
                    padding: 10px; font-family: monospace; font-size: 11.5px; line-height: 1.6;
                    white-space: pre-wrap; word-break: break-all; color: #1f2937; margin-top: 8px;
                    max-height: 200px; overflow-y: auto;
                }
                .cg-section-sub { font-size: 11px; color: #9ca3af; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; margin: 12px 0 6px; }
                .cg-req-inspect { color: #9ca3af; cursor: pointer; font-size: 12px; padding: 0 3px; flex-shrink: 0; }
                .cg-req-inspect:hover { color: #2563eb; }
            `;
            document.head.appendChild(style);
        },

        createPanel() {
            const panel = document.createElement('div');
            panel.id = 'cg-panel';
            panel.classList.add('collapsed');
            panel.innerHTML = `
                <div class="cg-header">
                    <div class="cg-title">
                        <span class="cg-dot" id="cg-dot"></span>
                        抢课脚本
                        <span class="cg-priority-badge" id="cg-exec-badge" style="display:none"></span>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center">
                        <button class="btn rec" id="cg-btn-rec">● 录制</button>
                        <button class="cg-toggle" id="cg-btn-toggle">+</button>
                    </div>
                </div>
                <div class="cg-body">

                    <!-- 优先级管理 -->
                    <div class="cg-section">
                        <div class="cg-section-title">优先级请求组</div>
                        <div class="cg-tabs" id="cg-tabs"></div>
                        <div class="cg-btn-group">
                            <button class="btn add" id="cg-btn-add-p">＋ 添加优先级</button>
                            <button class="btn del" id="cg-btn-del-p">删除当前</button>
                            <button class="btn" id="cg-btn-clear-p">清空请求</button>
                        </div>
                        <div class="cg-req-list" id="cg-req-list">
                            <div style="padding:14px;text-align:center;color:#9ca3af;font-size:12px">暂无请求，点击录制后操作页面自动捕获</div>
                        </div>
                    </div>

                    <!-- 执行配置 + 操作 合并一行 -->
                    <div class="cg-section">
                        <div class="cg-section-title">执行</div>
                        <div class="cg-row">
                            <span class="cg-label">循环间隔</span>
                            <input type="number" class="cg-input" id="cg-interval" value="500" min="0" step="50" style="max-width:90px">
                            <span style="color:#9ca3af;font-size:12px">ms</span>
                            <span class="cg-label" style="margin-left:8px">起始优先级</span>
                            <select class="cg-input" id="cg-start-priority" style="max-width:120px"></select>
                        </div>
                        <div class="cg-action-row">
                            <button class="btn go" id="cg-btn-start">▶ 开始抢课</button>
                            <button class="btn stop" id="cg-btn-stop" disabled>■ 停止</button>
                        </div>
                        <div class="cg-status-bar" id="cg-status-bar">就绪</div>
                    </div>

                    <!-- 条件脚本 -->
                    <div class="cg-section">
                        <div class="cg-section-title">条件脚本</div>
                        <textarea class="cg-input" id="cg-condition" placeholder="// 可用: ctx.status  ctx.responseText  ctx.currentPriority  ctx.loopCount
// ctx.contains(str)  ctx.json()  ctx.log(msg)
//
// return 1   继续当前优先级
// return 0   切换到下一优先级
// return -1  结束所有请求
//
// 示例:
// if (ctx.contains('选课成功')) return -1;
// if (ctx.status === 200 && ctx.json()?.code === 0) return -1;
// return 1;"></textarea>
                        <div class="cg-hint">每次请求响应后执行 · 1 继续 / 0 切换优先级 / −1 停止</div>
                    </div>

                    <!-- 导入/导出 -->
                    <div class="cg-section">
                        <div class="cg-section-title">配置</div>
                        <div style="display:flex;gap:6px;align-items:center">
                            <button class="btn" id="cg-btn-export">↑ 导出配置</button>
                            <button class="btn" id="cg-btn-import">↓ 导入配置</button>
                            <input type="file" id="cg-import-file" accept=".json" style="display:none">
                            <span class="cg-hint" style="margin:0">Cookie 等浏览器托管头不会被导出</span>
                        </div>
                    </div>

                    <!-- 日志 -->
                    <div class="cg-section">
                        <div class="cg-section-title">运行日志</div>
                        <div class="cg-log" id="cg-log"><div style="color:#9ca3af">等待开始...</div></div>
                    </div>
                </div>
            `;
            // modal 挂到 body，避免被 panel overflow:hidden 裁剪
            const modal = document.createElement('div');
            modal.id = 'cg-modal-overlay';
            modal.className = 'cg-modal-overlay';
            modal.style.display = 'none';
            modal.innerHTML = `
                <div class="cg-modal">
                    <div class="cg-modal-header">
                        <div class="cg-modal-title">
                            <span class="cg-method" id="cg-modal-method"></span>
                            <span id="cg-modal-url" style="font-family:monospace;font-size:12px;color:#4b5563;word-break:break-all"></span>
                        </div>
                        <button class="cg-modal-close" id="cg-modal-close">✕</button>
                    </div>
                    <div class="cg-modal-tabs">
                        <div class="cg-modal-tab active" data-pane="req">请求</div>
                        <div class="cg-modal-tab" data-pane="resp">响应</div>
                    </div>
                    <div class="cg-modal-body">
                        <div class="cg-modal-pane active" id="cg-pane-req">
                            <div class="cg-section-sub">请求头</div>
                            <table class="cg-headers-table" id="cg-req-headers-table">
                                <thead><tr><th>Header</th><th>Value</th></tr></thead>
                                <tbody></tbody>
                            </table>
                            <div class="cg-section-sub">请求体</div>
                            <pre class="cg-body-pre" id="cg-req-body">（无）</pre>
                        </div>
                        <div class="cg-modal-pane" id="cg-pane-resp">
                            <div class="cg-info-row">
                                <span class="cg-info-key">状态码</span>
                                <span class="cg-info-val" id="cg-resp-status">—</span>
                            </div>
                            <div class="cg-section-sub">响应头</div>
                            <table class="cg-headers-table" id="cg-resp-headers-table">
                                <thead><tr><th>Header</th><th>Value</th></tr></thead>
                                <tbody></tbody>
                            </table>
                            <div class="cg-section-sub">响应体</div>
                            <pre class="cg-body-pre" id="cg-resp-body">（无录制响应，响应数据仅在录制阶段捕获）</pre>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            document.body.appendChild(panel);
            this.elements = {
                panel, dot: panel.querySelector('#cg-dot'),
                execBadge: panel.querySelector('#cg-exec-badge'),
                recBtn: panel.querySelector('#cg-btn-rec'),
                toggleBtn: panel.querySelector('#cg-btn-toggle'),
                tabs: panel.querySelector('#cg-tabs'),
                reqList: panel.querySelector('#cg-req-list'),
                addPBtn: panel.querySelector('#cg-btn-add-p'),
                delPBtn: panel.querySelector('#cg-btn-del-p'),
                clearPBtn: panel.querySelector('#cg-btn-clear-p'),
                intervalInput: panel.querySelector('#cg-interval'),
                startPrioritySelect: panel.querySelector('#cg-start-priority'),
                conditionInput: panel.querySelector('#cg-condition'),
                startBtn: panel.querySelector('#cg-btn-start'),
                stopBtn: panel.querySelector('#cg-btn-stop'),
                statusBar: panel.querySelector('#cg-status-bar'),
                logContainer: panel.querySelector('#cg-log'),
                exportBtn: panel.querySelector('#cg-btn-export'),
                importBtn: panel.querySelector('#cg-btn-import'),
                importFile: panel.querySelector('#cg-import-file')
            };
        },

        bindEvents() {
            const el = this.elements;

            // 折叠/展开
            el.toggleBtn.addEventListener('click', () => {
                el.panel.classList.toggle('collapsed');
                el.toggleBtn.textContent = el.panel.classList.contains('collapsed') ? '+' : '−';
            });
            el.panel.querySelector('.cg-title').addEventListener('click', () => {
                if (el.panel.classList.contains('collapsed')) {
                    el.panel.classList.remove('collapsed');
                    el.toggleBtn.textContent = '−';
                }
            });

            // 录制按钮
            el.recBtn.addEventListener('click', () => {
                if (State.isPlaying) return;
                State.isRecording = !State.isRecording;
                el.recBtn.textContent = State.isRecording ? '停止录制' : '录制';
                el.dot.className = 'cg-dot' + (State.isRecording ? ' recording' : '');
                Utils.log(State.isRecording ? 'info' : 'warning',
                    State.isRecording
                        ? `开始录制 → ${State.priorities[State.recordingPriority]?.name}`
                        : '停止录制');
            });

            // 添加优先级
            el.addPBtn.addEventListener('click', () => {
                const n = State.priorities.length + 1;
                State.priorities.push({ name: `优先级 ${n}`, requests: [] });
                State.recordingPriority = State.priorities.length - 1;
                this.updatePriorityTabs();
                this.updatePriorityList();
                this.updateStartPrioritySelect();
            });

            // 删除当前优先级
            el.delPBtn.addEventListener('click', () => {
                if (State.priorities.length <= 1) {
                    Utils.log('warning', '至少保留一个优先级');
                    return;
                }
                if (!confirm(`确定删除 ${State.priorities[State.recordingPriority].name}？`)) return;
                State.priorities.splice(State.recordingPriority, 1);
                State.recordingPriority = Math.min(State.recordingPriority, State.priorities.length - 1);
                this.updatePriorityTabs();
                this.updatePriorityList();
                this.updateStartPrioritySelect();
            });

            // 清空当前优先级请求
            el.clearPBtn.addEventListener('click', () => {
                const p = State.priorities[State.recordingPriority];
                if (!p) return;
                if (!confirm(`确定清空 ${p.name} 的所有请求？`)) return;
                p.requests = [];
                this.updatePriorityList();
                Utils.log('warning', `已清空 ${p.name}`);
            });

            // 开始/停止
            el.startBtn.addEventListener('click', () => Controller.startLoop());
            el.stopBtn.addEventListener('click', () => Controller.stopLoop('手动停止'));

            // 导出配置
            el.exportBtn.addEventListener('click', () => ConfigIO.export());

            // 导入配置
            el.importBtn.addEventListener('click', () => el.importFile.click());
            el.importFile.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    ConfigIO.import(ev.target.result);
                    el.importFile.value = ''; // 允许重复导入同一文件
                };
                reader.readAsText(file);
            });
        },

        updatePriorityTabs() {
            const el = this.elements;
            el.tabs.innerHTML = State.priorities.map((p, i) => `
                <div class="cg-tab ${i === State.recordingPriority ? 'active' : ''} ${State.isPlaying && i === State.currentPriorityIndex ? 'playing-tab' : ''}"
                     data-index="${i}" title="点击切换录制目标">
                    P${i + 1}: ${p.name}
                    <span style="color:#555;font-size:10px">(${p.requests.length})</span>
                </div>
            `).join('');
            el.tabs.querySelectorAll('.cg-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    State.recordingPriority = parseInt(tab.dataset.index);
                    this.updatePriorityTabs();
                    this.updatePriorityList();
                });
            });
        },

        updatePriorityList() {
            const p = State.priorities[State.recordingPriority];
            const el = this.elements;
            if (!p || p.requests.length === 0) {
                el.reqList.innerHTML = '<div style="padding:16px;text-align:center;color:#555">暂无请求，开始录制后自动捕获</div>';
                return;
            }
            el.reqList.innerHTML = p.requests.map((req, i) => `
                <div class="cg-req-item">
                    <span class="cg-method m-${req.method}">${req.method}</span>
                    <span class="cg-url" title="${req.url}">${req.url}</span>
                    <span class="cg-req-inspect" data-index="${i}" title="查看详情">⋯</span>
                    <span class="cg-req-del" data-index="${i}" title="删除此请求">✕</span>
                </div>
            `).join('');
            el.reqList.querySelectorAll('.cg-req-inspect').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    UI.showRequestModal(p.requests[parseInt(btn.dataset.index)]);
                });
            });
            el.reqList.querySelectorAll('.cg-req-del').forEach(btn => {
                btn.addEventListener('click', () => {
                    p.requests.splice(parseInt(btn.dataset.index), 1);
                    this.updatePriorityList();
                    this.updatePriorityTabs();
                });
            });
        },

        updateStartPrioritySelect() {
            const sel = this.elements.startPrioritySelect;
            const cur = sel.value;
            sel.innerHTML = State.priorities.map((p, i) =>
                `<option value="${i}" ${String(i) === cur ? 'selected' : ''}>P${i + 1}: ${p.name}</option>`
            ).join('');
        },

        updateLogs() {
            const c = this.elements.logContainer;
            c.innerHTML = State.logs.map(l => `
                <div class="cg-log-entry">
                    <span class="cg-log-time">${l.time}</span>
                    <span class="log-${l.type}">[${l.type.toUpperCase()}]</span>
                    <span> ${l.message}</span>
                </div>
            `).join('');
            c.scrollTop = 0;
        },

        setStatus(text) {
            this.elements.statusBar.textContent = text;
        },

        setPlayingState(playing, priorityIndex) {
            const el = this.elements;
            el.startBtn.disabled = playing;
            el.stopBtn.disabled = !playing;
            el.recBtn.disabled = playing;
            el.startBtn.textContent = playing ? '运行中...' : '开始抢课';
            el.dot.className = 'cg-dot' + (playing ? ' playing' : '');
            if (playing && priorityIndex !== undefined) {
                el.execBadge.textContent = `执行中: P${priorityIndex + 1}`;
                el.execBadge.style.display = '';
                el.execBadge.className = 'cg-priority-badge active-exec';
            } else {
                el.execBadge.style.display = 'none';
            }
            this.updatePriorityTabs();
        },

        showRequestModal(req) {
            const overlay = document.getElementById('cg-modal-overlay');
            if (!overlay) return;

            // 填充方法 + URL
            const methodEl = overlay.querySelector('#cg-modal-method');
            methodEl.textContent = req.method;
            methodEl.className = `cg-method m-${req.method}`;
            overlay.querySelector('#cg-modal-url').textContent = req.url;

            // 请求头
            const reqTbody = overlay.querySelector('#cg-req-headers-table tbody');
            const headers = req.headers || {};
            reqTbody.innerHTML = Object.keys(headers).length
                ? Object.entries(headers).map(([k, v]) =>
                    `<tr><td>${k}</td><td>${v}</td></tr>`).join('')
                : '<tr><td colspan="2" style="color:#9ca3af;text-align:center">无请求头</td></tr>';

            // 请求体
            const bodyText = req.body
                ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2))
                : '（无）';
            overlay.querySelector('#cg-req-body').textContent = bodyText;

            // 响应（录制阶段捕获的）
            overlay.querySelector('#cg-resp-status').textContent =
                req.status ? `${req.status}` : '—（未录制响应）';
            const respTbody = overlay.querySelector('#cg-resp-headers-table tbody');
            const respHeaders = req.responseHeaders || {};
            respTbody.innerHTML = Object.keys(respHeaders).length
                ? Object.entries(respHeaders).map(([k, v]) =>
                    `<tr><td>${k}</td><td>${v}</td></tr>`).join('')
                : '<tr><td colspan="2" style="color:#9ca3af;text-align:center">无响应头</td></tr>';
            overlay.querySelector('#cg-resp-body').textContent =
                req.responseText || '（无录制响应，响应数据仅在录制阶段捕获）';

            // 重置到请求 tab
            overlay.querySelectorAll('.cg-modal-tab').forEach(t => t.classList.remove('active'));
            overlay.querySelectorAll('.cg-modal-pane').forEach(p => p.classList.remove('active'));
            overlay.querySelector('[data-pane="req"]').classList.add('active');
            overlay.querySelector('#cg-pane-req').classList.add('active');

            overlay.style.display = 'flex';
        },

        initModal() {
            const overlay = document.getElementById('cg-modal-overlay');
            if (!overlay) return;
            // 关闭
            overlay.querySelector('#cg-modal-close').addEventListener('click', () => {
                overlay.style.display = 'none';
            });
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.style.display = 'none';
            });
            // Tab 切换
            overlay.querySelectorAll('.cg-modal-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    overlay.querySelectorAll('.cg-modal-tab').forEach(t => t.classList.remove('active'));
                    overlay.querySelectorAll('.cg-modal-pane').forEach(p => p.classList.remove('active'));
                    tab.classList.add('active');
                    overlay.querySelector(`#cg-pane-${tab.dataset.pane}`).classList.add('active');
                });
            });
        }
    };

    // ==================== 控制器 ====================
    const Controller = {
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),

        async startLoop() {
            if (State.isPlaying) return;

            // 编译条件脚本
            const scriptText = UI.elements.conditionInput.value.trim();
            State.conditionFunc = scriptText ? Utils.compileCondition(scriptText) : null;

            const startIdx = parseInt(UI.elements.startPrioritySelect.value) || 0;
            const interval = parseInt(UI.elements.intervalInput.value) || 500;

            // 验证：起始优先级必须有请求
            if (State.priorities[startIdx].requests.length === 0) {
                Utils.log('error', `${State.priorities[startIdx].name} 没有录制任何请求`);
                return;
            }

            State.isPlaying = true;
            State.currentPriorityIndex = startIdx;
            State.loopCount = 0;
            UI.setPlayingState(true, startIdx);
            Utils.log('info', `开始抢课，从 P${startIdx + 1} 出发，间隔 ${interval}ms`);

            try {
                while (State.isPlaying) {
                    const p = State.priorities[State.currentPriorityIndex];
                    if (!p) {
                        Utils.log('warning', '已超出所有优先级，停止');
                        break;
                    }
                    if (p.requests.length === 0) {
                        Utils.log('warning', `${p.name} 无请求，跳到下一优先级`);
                        State.currentPriorityIndex++;
                        continue;
                    }

                    State.loopCount++;
                    UI.setStatus(`${p.name} | 第 ${State.loopCount} 轮`);
                    Utils.log('info', `[${p.name}] 第 ${State.loopCount} 轮，共 ${p.requests.length} 个请求`);

                    let decision = 1; // 默认继续

                    for (let i = 0; i < p.requests.length; i++) {
                        if (!State.isPlaying) break;
                        const req = p.requests[i];

                        try {
                            Utils.log('info', `  → ${req.method} ${req.url}`);
                            const resp = await this.sendRequest(req);
                            Utils.log('success', `  ← ${resp.status} ${resp.statusText}`);

                            decision = Utils.runCondition(req, resp);

                            if (decision !== 1) break; // 0 或 -1 立即跳出请求循环
                        } catch (e) {
                            Utils.log('error', `  ✗ 请求失败: ${e.message}`);
                            // 请求失败视为继续
                        }

                    }

                    if (!State.isPlaying) break;

                    if (decision === -1) {
                        Utils.log('success', '条件脚本返回 -1，任务完成，停止所有请求');
                        break;
                    } else if (decision === 0) {
                        const nextIdx = State.currentPriorityIndex + 1;
                        if (nextIdx >= State.priorities.length) {
                            Utils.log('warning', '已是最后一个优先级，无法切换，继续当前优先级');
                        } else {
                            Utils.log('info', `条件脚本返回 0，切换到 P${nextIdx + 1}`);
                            State.currentPriorityIndex = nextIdx;
                            State.loopCount = 0;
                            UI.setPlayingState(true, State.currentPriorityIndex);
                        }
                        // 切换后不等待，立即开始下一轮
                    } else {
                        // decision === 1，继续当前优先级，等待间隔
                        await this.sleep(interval);
                    }
                }
            } catch (e) {
                Utils.log('error', '执行异常: ' + e.message);
            } finally {
                this.stopLoop('执行结束');
            }
        },

        sendRequest(request) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: request.method,
                    url: request.url,
                    headers: request.headers || {},
                    data: request.body || null,
                    onload: (resp) => resolve({
                        status: resp.status,
                        statusText: resp.statusText || '',
                        responseText: resp.responseText || '',
                        responseHeaders: resp.responseHeaders || {}
                    }),
                    onerror: (e) => reject(new Error(e.statusText || '网络错误')),
                    ontimeout: () => reject(new Error('请求超时'))
                });
            });
        },

        stopLoop(reason) {
            State.isPlaying = false;
            UI.setPlayingState(false);
            UI.setStatus('已停止' + (reason ? ': ' + reason : ''));
            Utils.log('warning', '停止' + (reason ? ': ' + reason : ''));
        }
    };

    // ==================== 初始化 ====================
    Interceptor.init();

    function initUI() {
        UI.init();
        UI.updateStartPrioritySelect();
        UI.initModal();
        Utils.log('info', '抢课脚本已加载，请先录制各优先级请求');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }

    console.log('[抢课脚本] 已加载');
})();
