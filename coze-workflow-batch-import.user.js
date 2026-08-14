// ==UserScript==
// @name         Coze 工作流批量导入 v2
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  批量导入工作流 JSON 文件到 Coze 资源库，支持同名检测跳过
// @author       Vibe Coding
// @match        https://www.coze.cn/*
// @match        https://coze.cn/*
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ========== 配置 ==========
    const CONFIG = {
        importInterval: 2500,      // 导入间隔（毫秒）
        waitTime: 1500,            // 等待页面响应时间
        skipDuplicates: true,      // 跳过同名工作流
        debug: true                // 调试模式
    };

    // ========== 全局状态 ==========
    let files = [];
    let currentIndex = 0;
    let isRunning = false;
    let panel = null;
    let existingWorkflows = new Set();  // 已存在的工作流名称

    // ========== 日志 ==========
    function log(...args) {
        if (CONFIG.debug) {
            console.log('[Coze批量导入]', ...args);
        }
    }

    function logError(...args) {
        console.error('[Coze批量导入]', ...args);
    }

    // ========== 样式 ==========
    GM_addStyle(`
        #coze-batch-panel {
            position: fixed;
            top: 80px;
            right: 20px;
            width: 380px;
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 99999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            overflow: hidden;
        }
        #coze-batch-panel .header {
            background: linear-gradient(135deg, #5b5fc7 0%, #4b4fb5 100%);
            color: #fff;
            padding: 14px 18px;
            font-size: 15px;
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #coze-batch-panel .body {
            padding: 16px 18px;
            max-height: 60vh;
            overflow-y: auto;
        }
        #coze-batch-panel .btn {
            width: 100%;
            padding: 10px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            margin-bottom: 10px;
            transition: all 0.2s;
        }
        #coze-batch-panel .btn-primary {
            background: #5b5fc7;
            color: #fff;
        }
        #coze-batch-panel .btn-primary:hover:not(:disabled) {
            background: #4b4fb5;
        }
        #coze-batch-panel .btn-primary:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        #coze-batch-panel .btn-secondary {
            background: #f0f0f0;
            color: #333;
        }
        #coze-batch-panel .btn-secondary:hover {
            background: #e0e0e0;
        }
        #coze-batch-panel .btn-danger {
            background: #ff4444;
            color: #fff;
        }
        #coze-batch-panel .btn-danger:hover:not(:disabled) {
            background: #dd3333;
        }
        #coze-batch-panel .progress {
            margin-top: 12px;
            font-size: 13px;
            color: #666;
        }
        #coze-batch-panel .progress-bar {
            height: 6px;
            background: #f0f0f0;
            border-radius: 3px;
            margin-top: 8px;
            overflow: hidden;
        }
        #coze-batch-panel .progress-bar-inner {
            height: 100%;
            background: linear-gradient(90deg, #5b5fc7, #7b7fd7);
            transition: width 0.3s;
        }
        #coze-batch-panel .log {
            margin-top: 12px;
            max-height: 200px;
            overflow-y: auto;
            font-size: 12px;
            background: #f8f8f8;
            border-radius: 6px;
            padding: 10px;
        }
        #coze-batch-panel .log-item {
            padding: 3px 0;
            border-bottom: 1px solid #eee;
        }
        #coze-batch-panel .log-item:last-child {
            border-bottom: none;
        }
        #coze-batch-panel .log-success { color: #22c55e; }
        #coze-batch-panel .log-error { color: #ef4444; }
        #coze-batch-panel .log-skip { color: #f59e0b; }
        #coze-batch-panel .log-info { color: #666; }
        #coze-batch-panel .close-btn {
            cursor: pointer;
            font-size: 18px;
            opacity: 0.8;
        }
        #coze-batch-panel .close-btn:hover {
            opacity: 1;
        }
        #coze-batch-panel .checkbox-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            font-size: 13px;
            color: #666;
        }
    `);

    // ========== 工具函数 ==========
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 从文件名提取工作流名称
    function extractWorkflowName(filename) {
        // 格式: Workflow-X001_描述_1-draft-1075.json
        const match = filename.match(/Workflow-X\d+_(.+?)_1-draft/);
        if (match) {
            // 去掉类型前缀（W/V/T/P/S等）
            let name = match[1];
            // 尝试提取中文描述
            const descMatch = name.match(/_(.+)/);
            if (descMatch) {
                return descMatch[1];
            }
            return name;
        }
        return filename.replace('.json', '');
    }

    // 获取页面上已存在的工作流名称
    async function fetchExistingWorkflows() {
        log('开始获取已存在的工作流列表...');
        
        // 方法1: 尝试从页面 DOM 获取
        try {
            const items = document.querySelectorAll('[class*="workflow-item"], [class*="resource-item"], [data-testid*="workflow"]');
            items.forEach(item => {
                const nameEl = item.querySelector('[class*="name"], [class*="title"], h3, h4');
                if (nameEl) {
                    existingWorkflows.add(nameEl.textContent.trim());
                }
            });
            if (existingWorkflows.size > 0) {
                log(`从页面获取到 ${existingWorkflows.size} 个工作流`);
                return;
            }
        } catch (e) {
            log('从 DOM 获取失败:', e.message);
        }

        // 方法2: 尝试通过 API 获取（需要用户配置 token）
        // 这里暂时跳过，因为需要 workspace_id 和 access_token
        log('提示: 如需精确检测同名，请在 Coze 资源库页面滚动加载所有工作流后再开始导入');
    }

    // 检查工作流是否已存在
    function isWorkflowExists(name) {
        if (!CONFIG.skipDuplicates) return false;
        
        // 精确匹配
        if (existingWorkflows.has(name)) return true;
        
        // 模糊匹配（忽略大小写和空格）
        const normalizedName = name.toLowerCase().replace(/\s+/g, '');
        for (const existing of existingWorkflows) {
            const normalizedExisting = existing.toLowerCase().replace(/\s+/g, '');
            if (normalizedName === normalizedExisting) {
                return true;
            }
        }
        
        return false;
    }

    // 等待元素出现
    async function waitForElement(selector, timeout = 10000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            // 尝试多种选择器策略
            const strategies = [
                () => document.querySelector(selector),
                () => {
                    // 按文本内容查找按钮
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.find(btn => btn.textContent.includes(selector.replace(/button:contains\("(.+?)"\)/, '$1')));
                },
                () => {
                    // 查找包含特定文本的任何元素
                    const all = Array.from(document.querySelectorAll('*'));
                    return all.find(el => el.textContent === selector && el.children.length === 0);
                }
            ];
            
            for (const strategy of strategies) {
                try {
                    const el = strategy();
                    if (el) return el;
                } catch (e) {}
            }
            
            await sleep(200);
        }
        
        return null;
    }

    // 查找按钮（更健壮的方式）
    function findButton(text) {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        
        // 精确匹配
        let btn = buttons.find(b => b.textContent.trim() === text);
        if (btn) return btn;
        
        // 包含匹配
        btn = buttons.find(b => b.textContent.includes(text));
        if (btn) return btn;
        
        // 查找 span 内的文本
        const spans = Array.from(document.querySelectorAll('span'));
        const span = spans.find(s => s.textContent.trim() === text);
        if (span) {
            return span.closest('button') || span.parentElement?.closest('[role="button"]');
        }
        
        return null;
    }

    // ========== 核心导入逻辑 ==========
    async function importNextFile() {
        if (currentIndex >= files.length) {
            updateStatus('全部完成！');
            isRunning = false;
            return;
        }

        const file = files[currentIndex];
        const workflowName = extractWorkflowName(file.name);
        
        // 检查同名
        if (isWorkflowExists(workflowName)) {
            addLog(`跳过同名: ${file.name}`, 'skip');
            currentIndex++;
            updateProgress();
            await sleep(500);
            importNextFile();
            return;
        }

        updateStatus(`正在导入 (${currentIndex + 1}/${files.length}): ${file.name}`);
        addLog(`开始导入: ${file.name}`, 'info');

        try {
            // 步骤1: 点击"导入"按钮打开弹窗
            log('步骤1: 查找导入按钮');
            const importBtn = findButton('导入');
            if (!importBtn) {
                throw new Error('找不到"导入"按钮，请确认当前在资源库页面');
            }
            importBtn.click();
            await sleep(CONFIG.waitTime);

            // 步骤2: 等待文件输入框出现
            log('步骤2: 等待文件输入框');
            const fileInput = await waitForElement('input[type="file"]', 5000);
            if (!fileInput) {
                throw new Error('找不到文件输入框');
            }

            // 步骤3: 上传文件
            log('步骤3: 上传文件');
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            
            // 步骤4: 等待导入完成（Coze 上传后自动导入，无需手动确认）
            log('步骤4: 等待导入完成');
            await sleep(CONFIG.importInterval);

            // 检查弹窗是否还存在（如果关闭说明导入完成）
            const dialogStillOpen = document.querySelector('[class*="modal"], [class*="dialog"]');
            
            // 记录到已存在列表
            existingWorkflows.add(workflowName);
            addLog(`✓ 导入成功: ${file.name}`, 'success');
            currentIndex++;
            updateProgress();

            // 如果弹窗还开着，尝试关闭它
            if (dialogStillOpen) {
                const closeBtn = dialogStillOpen.querySelector('[class*="close"], [aria-label="Close"], button:last-child');
                if (closeBtn) closeBtn.click();
                await sleep(500);
            }

            // 继续下一个
            await sleep(500);
            importNextFile();

        } catch (error) {
            logError(`导入失败: ${file.name}`, error.message);
            addLog(`✗ 失败: ${file.name} - ${error.message}`, 'error');
            
            // 尝试关闭可能的弹窗
            const closeBtn = document.querySelector('[class*="close"], [aria-label="Close"]');
            if (closeBtn) closeBtn.click();
            
            await sleep(1000);
            
            // 继续下一个
            currentIndex++;
            updateProgress();
            importNextFile();
        }
    }

    // ========== UI 函数 ==========
    function createPanel() {
        panel = document.createElement('div');
        panel.id = 'coze-batch-panel';
        panel.innerHTML = `
            <div class="header">
                <span>Coze 工作流批量导入 v2</span>
                <span class="close-btn" id="coze-close-btn">&times;</span>
            </div>
            <div class="body">
                <div class="checkbox-row">
                    <input type="checkbox" id="coze-skip-duplicates" ${CONFIG.skipDuplicates ? 'checked' : ''}>
                    <label for="coze-skip-duplicates">跳过同名工作流</label>
                </div>
                <input type="file" id="coze-file-input" webkitdirectory multiple accept=".json" style="display:none">
                <button class="btn btn-primary" id="coze-select-btn">选择工作流文件</button>
                <button class="btn btn-primary" id="coze-start-btn" disabled>开始导入</button>
                <button class="btn btn-danger" id="coze-stop-btn" disabled>停止</button>
                <div class="progress" id="coze-status">请选择文件</div>
                <div class="progress-bar"><div class="progress-bar-inner" id="coze-progress-bar" style="width:0%"></div></div>
                <div class="log" id="coze-log"></div>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定事件
        document.getElementById('coze-close-btn').onclick = () => panel.remove();
        
        document.getElementById('coze-select-btn').onclick = () => {
            document.getElementById('coze-file-input').click();
        };

        document.getElementById('coze-file-input').onchange = (e) => {
            files = Array.from(e.target.files).filter(f => f.name.endsWith('.json'));
            if (files.length > 0) {
                document.getElementById('coze-start-btn').disabled = false;
                document.getElementById('coze-status').textContent = `已选择 ${files.length} 个文件`;
                addLog(`已选择 ${files.length} 个工作流文件`, 'info');
            }
        };

        document.getElementById('coze-start-btn').onclick = async () => {
            if (isRunning) return;
            
            CONFIG.skipDuplicates = document.getElementById('coze-skip-duplicates').checked;
            
            // 获取已存在的工作流
            if (CONFIG.skipDuplicates) {
                addLog('正在检查已存在的工作流...', 'info');
                await fetchExistingWorkflows();
                addLog(`检测到 ${existingWorkflows.size} 个已存在的工作流`, 'info');
            }
            
            isRunning = true;
            currentIndex = 0;
            document.getElementById('coze-start-btn').disabled = true;
            document.getElementById('coze-stop-btn').disabled = false;
            importNextFile();
        };

        document.getElementById('coze-stop-btn').onclick = () => {
            isRunning = false;
            document.getElementById('coze-start-btn').disabled = false;
            document.getElementById('coze-stop-btn').disabled = true;
            document.getElementById('coze-status').textContent = '已停止';
            addLog('导入已手动停止', 'info');
        };
    }

    function updateStatus(text) {
        const el = document.getElementById('coze-status');
        if (el) el.textContent = text;
    }

    function updateProgress() {
        const percent = (currentIndex / files.length) * 100;
        const bar = document.getElementById('coze-progress-bar');
        if (bar) bar.style.width = `${percent}%`;
        updateStatus(`进度: ${currentIndex}/${files.length} (${Math.round(percent)}%)`);
    }

    function addLog(text, type = 'info') {
        const log = document.getElementById('coze-log');
        if (!log) return;
        
        const item = document.createElement('div');
        item.className = `log-item log-${type}`;
        item.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
        log.insertBefore(item, log.firstChild);
        
        // 限制日志数量
        while (log.children.length > 100) {
            log.removeChild(log.lastChild);
        }
    }

    // ========== 启动 ==========
    function init() {
        log('脚本已加载');
        
        // 延迟创建面板，确保页面加载完成
        setTimeout(() => {
            createPanel();
            log('控制面板已创建');
        }, 2000);
    }

    // 页面加载完成后启动
    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

})();
