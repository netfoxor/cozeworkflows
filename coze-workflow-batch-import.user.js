// ==UserScript==
// @name         Coze 工作流批量导入
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  批量导入 Coze 工作流 JSON 文件到资源库
// @author       Vibe Coding
// @match        https://www.coze.cn/*
// @match        https://coze.cn/*
// @grant        GM_addStyle
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ========== 配置区域 ==========
    // 如果页面结构变化，修改以下选择器
    const SELECTORS = {
        // 资源库页面的"导入"按钮
        importButton: 'button:contains("导入"), [data-testid="import-button"]',
        // 上传弹窗中的文件输入框
        fileInput: 'input[type="file"]',
        // 上传弹窗中的"导入"确认按钮
        confirmButton: 'button:contains("导入")',
        // 成功提示
        successToast: '.semi-toast-success, .toast-success, [class*="success"]',
    };

    // ========== 全局状态 ==========
    let files = [];
    let currentIndex = 0;
    let isRunning = false;
    let panel = null;

    // ========== 样式 ==========
    GM_addStyle(`
        #coze-batch-panel {
            position: fixed;
            top: 80px;
            right: 20px;
            width: 360px;
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            z-index: 99999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            overflow: hidden;
        }
        #coze-batch-panel .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
        }
        #coze-batch-panel .file-list {
            max-height: 200px;
            overflow-y: auto;
            margin: 10px 0;
            border: 1px solid #eee;
            border-radius: 8px;
            padding: 8px;
            font-size: 12px;
            color: #666;
        }
        #coze-batch-panel .file-item {
            padding: 4px 8px;
            border-radius: 4px;
            margin: 2px 0;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #coze-batch-panel .file-item.pending { color: #999; }
        #coze-batch-panel .file-item.uploading { color: #1890ff; background: #e6f7ff; }
        #coze-batch-panel .file-item.success { color: #52c41a; background: #f6ffed; }
        #coze-batch-panel .file-item.error { color: #ff4d4f; background: #fff2f0; }
        #coze-batch-panel .progress {
            margin: 10px 0;
            font-size: 13px;
            color: #333;
        }
        #coze-batch-panel .progress-bar {
            height: 6px;
            background: #f0f0f0;
            border-radius: 3px;
            overflow: hidden;
            margin-top: 6px;
        }
        #coze-batch-panel .progress-bar-inner {
            height: 100%;
            background: linear-gradient(90deg, #667eea, #764ba2);
            border-radius: 3px;
            transition: width 0.3s;
        }
        #coze-batch-panel .btn {
            display: inline-block;
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
        }
        #coze-batch-panel .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff;
        }
        #coze-batch-panel .btn-primary:hover { opacity: 0.9; }
        #coze-batch-panel .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        #coze-batch-panel .btn-secondary {
            background: #f5f5f5;
            color: #666;
            margin-left: 8px;
        }
        #coze-batch-panel .btn-secondary:hover { background: #e8e8e8; }
        #coze-batch-panel .close-btn {
            background: none;
            border: none;
            color: #fff;
            font-size: 18px;
            cursor: pointer;
            opacity: 0.8;
        }
        #coze-batch-panel .close-btn:hover { opacity: 1; }
        #coze-batch-panel .tip {
            font-size: 11px;
            color: #999;
            margin-top: 8px;
            line-height: 1.5;
        }
    `);

    // ========== 工具函数 ==========
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function log(msg) {
        console.log('[Coze批量导入]', msg);
    }

    // ========== 创建控制面板 ==========
    function createPanel() {
        panel = document.createElement('div');
        panel.id = 'coze-batch-panel';
        panel.innerHTML = `
            <div class="header">
                <span>Coze 工作流批量导入</span>
                <button class="close-btn" id="coze-batch-close">&times;</button>
            </div>
            <div class="body">
                <div>
                    <input type="file" id="coze-batch-files" multiple accept=".json,.zip" style="display:none" webkitdirectory>
                    <button class="btn btn-primary" id="coze-batch-select">选择工作流文件</button>
                    <button class="btn btn-secondary" id="coze-batch-start" disabled>开始导入</button>
                    <button class="btn btn-secondary" id="coze-batch-stop" style="display:none">停止</button>
                </div>
                <div class="progress" id="coze-batch-progress" style="display:none">
                    <span id="coze-batch-status">准备中...</span>
                    <div class="progress-bar">
                        <div class="progress-bar-inner" id="coze-batch-bar" style="width: 0%"></div>
                    </div>
                </div>
                <div class="file-list" id="coze-batch-list" style="display:none"></div>
                <div class="tip">
                    提示：此功能需要 Coze 会员权限。<br>
                    选择包含 JSON 文件的文件夹后，脚本会自动逐个上传导入。<br>
                    导入过程中请勿操作页面。
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定事件
        document.getElementById('coze-batch-close').addEventListener('click', () => {
            panel.style.display = 'none';
        });

        document.getElementById('coze-batch-select').addEventListener('click', () => {
            document.getElementById('coze-batch-files').click();
        });

        document.getElementById('coze-batch-files').addEventListener('change', handleFileSelect);

        document.getElementById('coze-batch-start').addEventListener('click', startImport);

        document.getElementById('coze-batch-stop').addEventListener('click', stopImport);
    }

    // ========== 文件选择处理 ==========
    function handleFileSelect(e) {
        const selectedFiles = Array.from(e.target.files);
        // 过滤出 JSON 和 ZIP 文件
        files = selectedFiles.filter(f => 
            f.name.endsWith('.json') || f.name.endsWith('.zip')
        );

        if (files.length === 0) {
            alert('未找到 JSON 或 ZIP 文件，请重新选择');
            return;
        }

        log(`选择了 ${files.length} 个文件`);

        // 显示文件列表
        const listEl = document.getElementById('coze-batch-list');
        listEl.style.display = 'block';
        listEl.innerHTML = files.map((f, i) => 
            `<div class="file-item pending" data-index="${i}">
                <span>${i + 1}.</span>
                <span>${f.name}</span>
            </div>`
        ).join('');

        // 启用开始按钮
        document.getElementById('coze-batch-start').disabled = false;
        document.getElementById('coze-batch-progress').style.display = 'block';
        document.getElementById('coze-batch-status').textContent = `已选择 ${files.length} 个文件，点击"开始导入"`;
    }

    // ========== 更新文件状态 ==========
    function updateFileStatus(index, status, text) {
        const item = document.querySelector(`.file-item[data-index="${index}"]`);
        if (item) {
            item.className = `file-item ${status}`;
            if (text) {
                item.querySelector('span:last-child').textContent = text;
            }
        }
    }

    function updateProgress(current, total) {
        const percent = Math.round((current / total) * 100);
        document.getElementById('coze-batch-bar').style.width = `${percent}%`;
        document.getElementById('coze-batch-status').textContent = 
            `导入中 ${current}/${total} (${percent}%)`;
    }

    // ========== 核心导入逻辑 ==========
    async function startImport() {
        if (isRunning) return;
        isRunning = true;

        // 隐藏选择按钮，显示停止按钮
        document.getElementById('coze-batch-select').style.display = 'none';
        document.getElementById('coze-batch-start').style.display = 'none';
        document.getElementById('coze-batch-stop').style.display = 'inline-block';

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < files.length; i++) {
            if (!isRunning) {
                log('用户停止导入');
                break;
            }

            currentIndex = i;
            const file = files[i];
            updateProgress(i + 1, files.length);
            updateFileStatus(i, 'uploading', `${file.name} - 上传中...`);

            try {
                await importSingleFile(file, i);
                updateFileStatus(i, 'success', `${file.name} - 导入成功`);
                successCount++;
            } catch (err) {
                log(`导入失败: ${file.name} - ${err.message}`);
                updateFileStatus(i, 'error', `${file.name} - 失败: ${err.message}`);
                errorCount++;
            }

            // 等待一下再导入下一个，避免请求过快
            await sleep(2000);
        }

        // 完成
        isRunning = false;
        document.getElementById('coze-batch-status').textContent = 
            `导入完成！成功 ${successCount} 个，失败 ${errorCount} 个`;
        document.getElementById('coze-batch-stop').style.display = 'none';
        document.getElementById('coze-batch-select').style.display = 'inline-block';
        document.getElementById('coze-batch-select').textContent = '重新选择';
        document.getElementById('coze-batch-start').style.display = 'inline-block';
        document.getElementById('coze-batch-start').disabled = true;

        GM_notification({
            title: 'Coze 批量导入完成',
            text: `成功 ${successCount} 个，失败 ${errorCount} 个`,
            timeout: 5000
        });
    }

    function stopImport() {
        isRunning = false;
    }

    // ========== 单个文件导入 ==========
    async function importSingleFile(file, index) {
        // 策略1：查找页面上的文件输入框
        let fileInput = document.querySelector('input[type="file"]');
        
        if (!fileInput) {
            // 尝试点击"导入"按钮触发弹窗
            const importBtn = findImportButton();
            if (importBtn) {
                importBtn.click();
                await sleep(1500);
                fileInput = document.querySelector('input[type="file"]');
            }
        }

        if (!fileInput) {
            throw new Error('未找到文件上传输入框，请确认当前在资源库页面');
        }

        // 使用 DataTransfer 模拟文件选择
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;

        // 触发 change 事件
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        // 等待文件解析
        await sleep(3000);

        // 查找并点击"导入"确认按钮
        const confirmBtn = findConfirmButton();
        if (confirmBtn) {
            confirmBtn.click();
        } else {
            // 有些情况下文件选择后会自动导入
            log('未找到确认按钮，可能已自动导入');
        }

        // 等待导入完成（检测成功提示或页面变化）
        await waitForImportComplete();
    }

    // ========== 查找按钮 ==========
    function findImportButton() {
        // 尝试多种方式查找"导入"按钮
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        return buttons.find(btn => {
            const text = btn.textContent.trim();
            return text === '导入' || text.includes('导入');
        });
    }

    function findConfirmButton() {
        // 查找弹窗中的"导入"确认按钮
        const buttons = Array.from(document.querySelectorAll('button'));
        // 弹窗中的按钮通常在 modal/dialog 内
        const modalButtons = buttons.filter(btn => {
            const text = btn.textContent.trim();
            return text === '导入' && btn.closest('[role="dialog"], .semi-modal, [class*="modal"], [class*="dialog"]');
        });
        return modalButtons[0] || buttons.find(btn => btn.textContent.trim() === '导入');
    }

    // ========== 等待导入完成 ==========
    async function waitForImportComplete() {
        const maxWait = 30000; // 最多等30秒
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
            // 检查成功提示
            const successToast = document.querySelector(
                '.semi-toast-success, [class*="toast"][class*="success"], [class*="message"][class*="success"]'
            );
            if (successToast) {
                log('检测到成功提示');
                await sleep(1000);
                return;
            }

            // 检查是否回到了资源库列表（导入成功后弹窗关闭）
            const fileInput = document.querySelector('input[type="file"]');
            if (!fileInput || fileInput.offsetParent === null) {
                // 文件输入框消失，说明弹窗已关闭
                log('弹窗已关闭，认为导入完成');
                await sleep(1000);
                return;
            }

            await sleep(1000);
        }

        // 超时
        log('等待导入完成超时，继续下一个');
    }

    // ========== 初始化 ==========
    function init() {
        // 等待页面加载完成
        if (document.readyState === 'complete') {
            createPanel();
        } else {
            window.addEventListener('load', createPanel);
        }
    }

    init();
})();
