// ==UserScript==
// @name         Coze 工作流批量导入 v3
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  批量导入工作流 ZIP 文件到 Coze 资源库，支持同名检测跳过、错误重试
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
        importInterval: 5000,      // 导入间隔（毫秒）- 增加到 5 秒避免连接关闭
        waitTime: 1500,            // 等待页面响应时间
        skipDuplicates: true,      // 跳过同名工作流
        debug: true,               // 调试模式
        maxRetries: 2,             // 最大重试次数
        retryDelay: 3000           // 重试间隔（毫秒）
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
        // 格式: Workflow-X001_描述_1-draft-1075.zip
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
        return filename.replace(/\.(json|zip)$/, '');
    }

    // 获取页面上已存在的工作流名称
    async function fetchExistingWorkflows() {
        log('开始获取已存在的工作流列表...');
        
        // 方法1: 滚动页面加载所有工作流，然后从 DOM 获取
        try {
            // 先滚动页面到底部，触发懒加载
            log('滚动页面加载所有工作流...');
            const scrollContainer = document.querySelector('[class*="scroll"], [class*="list"], main') || document.documentElement;
            let lastHeight = scrollContainer.scrollHeight;
            let scrollAttempts = 0;
            const maxScrollAttempts = 10;
            
            while (scrollAttempts < maxScrollAttempts) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
                await sleep(1000);
                
                const newHeight = scrollContainer.scrollHeight;
                if (newHeight === lastHeight) {
                    break; // 没有更多内容了
                }
                lastHeight = newHeight;
                scrollAttempts++;
            }
            
            // 现在获取所有工作流名称
            // 尝试多种选择器，排除导航菜单
            const selectors = [
                // 资源库列表项中的名称
                '[class*="resource-item"] [class*="name"]',
                '[class*="resource-item"] [class*="title"]',
                '[class*="workflow-item"] [class*="name"]',
                '[class*="workflow-item"] [class*="title"]',
                // 表格行中的名称
                'tr [class*="name"]',
                'tr [class*="title"]',
                // 卡片中的名称
                '[class*="card"] [class*="name"]:not([class*="nav"])',
                '[class*="card"] [class*="title"]:not([class*="nav"])',
            ];
            
            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    elements.forEach(el => {
                        const name = el.textContent.trim();
                        if (name) {
                            existingWorkflows.add(name);
                        }
                    });
                    log(`从选择器 "${selector}" 获取到 ${elements.length} 个工作流`);
                }
            }
            
            // 如果上面的选择器都没找到，尝试更通用的方法
            if (existingWorkflows.size === 0) {
                log('尝试通用方法获取工作流名称...');
                // 查找所有包含"工作流"文本的行的前一个元素（通常是名称）
                const allText = document.querySelectorAll('*');
                const navItems = ['扣子', '个人空间', '主页', '项目开发', '资源库', '任务中心', '效果评测', '空间配置', '模板商店', '插件商店', '作品社区', 'API 管理', '文档中心', '通用管理', '总积分', '下次续费'];
                
                allText.forEach(el => {
                    if (el.textContent.trim() === '工作流' && el.children.length === 0) {
                        // 找到父级中的名称元素
                        const parent = el.closest('[class*="item"], [class*="row"], tr');
                        if (parent) {
                            const nameEl = parent.querySelector('[class*="name"], [class*="title"], h3, h4, span');
                            if (nameEl && nameEl.textContent.trim()) {
                                const name = nameEl.textContent.trim();
                                // 排除导航菜单项
                                if (!navItems.some(nav => name.includes(nav))) {
                                    existingWorkflows.add(name);
                                }
                            }
                        }
                    }
                });
            }
            
            if (existingWorkflows.size > 0) {
                log(`共获取到 ${existingWorkflows.size} 个已存在的工作流`);
                log(`工作流名称: ${Array.from(existingWorkflows).join(', ')}`);
                return;
            }
        } catch (e) {
            log('从 DOM 获取失败:', e.message);
        }

        // 方法2: 尝试从网络请求中获取（监听 XHR）
        log('提示: 如需精确检测同名，请确保已滚动加载所有工作流');
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

    // 关闭"确认离开"弹窗
    async function dismissLeaveDialog() {
        const dialogs = document.querySelectorAll('[class*="modal"], [class*="dialog"]');
        for (const dialog of dialogs) {
            if (dialog.textContent.includes('确认离开') || dialog.textContent.includes('离开会终止')) {
                log('检测到"确认离开"弹窗，点击取消');
                // 通常"取消"按钮是第一个按钮
                const cancelBtn = dialog.querySelector('button:first-child') || 
                                  dialog.querySelector('[class*="cancel"]') ||
                                  Array.from(dialog.querySelectorAll('button')).find(b => 
                                      b.textContent.includes('取消') || b.textContent.includes('Cancel')
                                  );
                if (cancelBtn) {
                    cancelBtn.click();
                    await sleep(500);
                    return true;
                }
            }
        }
        return false;
    }

    // 关闭导入弹窗
    async function closeImportDialog() {
        const dialogs = document.querySelectorAll('[class*="modal"], [class*="dialog"]');
        for (const dialog of dialogs) {
            // 排除"确认离开"弹窗
            if (dialog.textContent.includes('确认离开') || dialog.textContent.includes('离开会终止')) {
                continue;
            }
            // 查找关闭按钮
            const closeBtn = dialog.querySelector('[class*="close"], [aria-label="Close"], button:last-child');
            if (closeBtn) {
                closeBtn.click();
                await sleep(500);
                return true;
            }
        }
        return false;
    }

    // ========== 核心导入逻辑 ==========
    async function importNextFile(retryCount = 0) {
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

            // 步骤2: 等待文件输入框出现（排除脚本自己创建的文件输入框）
            log('步骤2: 等待文件输入框');
            const fileInput = await waitForElement('input[type="file"]:not(#coze-file-input)', 5000);
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

            // 处理"确认离开"弹窗（如果有）
            await dismissLeaveDialog();

            // 记录到已存在列表
            existingWorkflows.add(workflowName);
            addLog(`✓ 导入成功: ${file.name}`, 'success');
            currentIndex++;
            updateProgress();

            // 关闭导入弹窗
            await closeImportDialog();

            // 继续下一个
            await sleep(500);
            importNextFile();

        } catch (error) {
            logError(`导入失败: ${file.name}`, error.message);
            
            // 重试逻辑
            if (retryCount < CONFIG.maxRetries) {
                addLog(` 重试 (${retryCount + 1}/${CONFIG.maxRetries}): ${file.name}`, 'skip');
                await sleep(CONFIG.retryDelay);
                importNextFile(retryCount + 1);
                return;
            }
            
            addLog(`✗ 失败: ${file.name} - ${error.message}`, 'error');
            
            // 尝试关闭可能的弹窗
            await dismissLeaveDialog();
            await closeImportDialog();
            
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
                <span>Coze 工作流批量导入 v3</span>
                <span class="close-btn" id="coze-close-btn">&times;</span>
            </div>
            <div class="body">
                <div class="checkbox-row">
                    <input type="checkbox" id="coze-skip-duplicates" ${CONFIG.skipDuplicates ? 'checked' : ''}>
                    <label for="coze-skip-duplicates">跳过同名工作流</label>
                </div>
                <input type="file" id="coze-file-input" webkitdirectory multiple accept=".json,.zip" style="display:none">
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
            // 支持文件夹选择和多个文件选择
            let selectedFiles = Array.from(e.target.files);
            
            // 如果选择了文件夹，过滤出 JSON/ZIP 文件
            files = selectedFiles.filter(f => f.name.endsWith('.json') || f.name.endsWith('.zip'));
            
            if (files.length > 0) {
                document.getElementById('coze-start-btn').disabled = false;
                document.getElementById('coze-status').textContent = `已选择 ${files.length} 个文件`;
                addLog(`已选择 ${files.length} 个工作流文件`, 'info');
                log(`文件列表: ${files.map(f => f.name).join(', ')}`);
            } else {
                addLog('未找到 JSON/ZIP 文件', 'error');
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
