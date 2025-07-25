// ==UserScript==
// @name         传音AI助手
// @namespace    http://tampermonkey.net/
// @version      1.0.6
// @description  选中文本后显示AI助手，调用API生成内容并打开新标签页，支持全选和受限网站，集成飞书文档转Markdown功能
// @author       hongxiang.zhou
// @match        https://*.feishu.cn/*/*
// @downloadURL https://raw.githubusercontent.com/Loweiter/TranssionAiPlugin/refs/heads/main/TranssionAiPlugin.js
// @updateURL https://raw.githubusercontent.com/Loweiter/TranssionAiPlugin/refs/heads/main/TranssionAiPlugin.js
// @grant        GM_setClipboard
// ==/UserScript==
(function () {
    'use strict';
    let currentContent = null;
    let currentUser = null;
    let aiButton = null;
    let inputBox = null;
    let selectedText = '';
    let inputBoxVisible = false;
    let aiButtonVisible = false;
    let isMouseDown = false;
    let isDragging = false; // 新增：是否正在拖拽选择
    let processingWindow = null;
    let checkingSelection = false;
    let lastClipboardContent = ''; // 记录上次剪贴板内容
    let clipboardCheckInProgress = false; // 防止重复检查
    let lastCtrlCTime = 0; // 记录上次Ctrl+C的时间
    let aiDismissed = false; // 记录AI是否被主动关闭

    // 常驻按钮相关变量
    let floatingAiButton = null;
    let isDraggingFloat = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let buttonStartX = 0;
    let buttonStartY = 0;

    // FeishuToMd 相关变量
    let isProcessing = false; // 状态标记
    let tooltipTimer = null; // 提示框定时器
    let usageCount = 0; // 本次会话使用次数计数
    let mdButton = null; // Markdown 转换按钮
    /// 全局变量
    let collectionInterval = null;
    let collectionInterval2 = null;
    let collectedNodes = new Map(); // 用于存储收集到的节点，key为元素的唯一标识，value为节点信息

    const currentUrl = window.location.href;
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    const scroller = createBruteForceScroller();

    // API配置
    const API_URL = "https://test-ai.palmplaystore.com/ai/open/HtmlAgentV2";

    // 初始化：解除复制限制
    initializeCopyUnlock();
    // 初始化剪贴板监听
    //initializeClipboardListener();
    // 创建常驻AI按钮
    createFloatingAiButton();
    // 创建Markdown转换按钮
    createMarkdownButton();

    // 全局鼠标位置跟踪
    window.lastMouseX = 0;
    window.lastMouseY = 0;

    document.addEventListener('mousemove', function (e) {
        window.lastMouseX = e.clientX;
        window.lastMouseY = e.clientY;
    }, { passive: true });


    XMLHttpRequest.prototype.open = function (method, url, ...args) {
        this._url = url;
        return originalXHROpen.apply(this, [method, url, ...args]);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        if (this._url && this._url.includes('accounts/web/user')) {
            this.addEventListener('readystatechange', function () {
                if (this.readyState === 4 && this.status === 200) {
                    try {
                        const response = JSON.parse(this.responseText);
                        if (response.data && response.data.user && response.data.user.name) {
                            handleUserName(response.data.user.name, response.data.user);
                        }
                    } catch (e) {
                        console.error('解析响应失败:', e);
                    }
                }
            });
        }
        return originalXHRSend.apply(this, args);
    };


    function initializeCopyUnlock() {
        // 检查当前网址是否匹配指定的域名
        if (window.location.href.includes('scys.com')) {
            // 隐藏 .toast-wrap 元素
            var style = document.createElement('style');
            style.type = 'text/css';
            style.innerHTML = `
                .toast-wrap {
                    display: none !important;
                }
            `;
            document.head.appendChild(style);

            // 解除禁用右键菜单和文本选择的限制
            document.addEventListener('contextmenu', function (e) {
                e.stopPropagation();
            }, true);

            document.addEventListener('selectstart', function (e) {
                e.stopPropagation();
            }, true);

            document.addEventListener('copy', function (e) {
                e.stopPropagation();
            }, true);
        }

        // 解除飞书文档的限制
        if (window.location.href.includes('feishu.cn')) {
            setTimeout(() => {
                document.body.style.userSelect = 'auto';
                document.body.style.webkitUserSelect = 'auto';
                document.body.style.mozUserSelect = 'auto';
                document.body.style.msUserSelect = 'auto';

                // 移除所有阻止选择的事件监听器
                var elems = document.querySelectorAll('*');
                for (var i = 0; i < elems.length; i++) {
                    elems[i].style.userSelect = 'auto';
                    elems[i].style.webkitUserSelect = 'auto';
                    elems[i].onmousedown = null;
                    elems[i].onselectstart = null;
                    elems[i].ondragstart = null;
                }
            }, 1000);
        }
    }

    // 创建Markdown转换按钮
    function createMarkdownButton() {
        // 检查是否第一次使用
        const STORAGE_KEY = 'feishu_md_first_time';
        const isFirstTimeEver = !localStorage.getItem(STORAGE_KEY);

        // 创建Markdown转换相关样式
        const mdStyle = document.createElement('style');
        mdStyle.textContent = `
            .feishu-md-button {
                position: fixed !important;
                right: 20px !important;
                top: 120px !important;
                z-index: 10000 !important;
                min-width: 80px !important;
                height: 32px !important;
                border: none !important;
                border-radius: 6px !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 4px !important;
            }

            .feishu-md-button svg {
                width: 14px !important;
                height: 14px !important;
                fill: currentColor !important;
            }

            .feishu-md-button.primary {
                background: #1890ff !important;
                color: white !important;
            }

            .feishu-md-button.primary:hover {
                background: #40a9ff !important;
            }

            .feishu-md-button.danger {
                background: #ff4d4f !important;
                color: white !important;
            }

            .feishu-md-button.danger:hover {
                background: #ff7875 !important;
            }

            .feishu-md-button.processing {
                background: #52c41a !important;
                color: white !important;
                cursor: not-allowed !important;
            }

            .feishu-md-button:disabled {
                opacity: 0.6 !important;
                cursor: not-allowed !important;
            }

            .feishu-md-modal {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                background: rgba(0, 0, 0, 0.4) !important;
                z-index: 10001 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            }

            .feishu-md-modal-content {
                background: white !important;
                padding: 32px !important;
                border-radius: 8px !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
                max-width: 500px !important;
                width: 90% !important;
                text-align: left !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                position: relative !important;
            }

            .feishu-md-modal-close {
                position: absolute !important;
                top: 12px !important;
                right: 16px !important;
                width: 24px !important;
                height: 24px !important;
                border: none !important;
                background: transparent !important;
                font-size: 18px !important;
                color: #999 !important;
                cursor: pointer !important;
                border-radius: 50% !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                transition: all 0.2s ease !important;
            }

            .feishu-md-modal-close:hover {
                background: #f5f5f5 !important;
                color: #666 !important;
            }

            .feishu-md-modal-title {
                font-size: 18px !important;
                font-weight: 600 !important;
                color: #333 !important;
                margin-bottom: 16px !important;
                text-align: center !important;
            }

            .feishu-md-modal-text {
                font-size: 14px !important;
                color: #666 !important;
                line-height: 1.6 !important;
                margin-bottom: 20px !important;
            }

            .feishu-md-modal-steps {
                margin: 20px 0 !important;
            }

            .feishu-md-modal-step {
                margin: 12px 0 !important;
                padding: 12px !important;
                background: #f8f9fa !important;
                border-radius: 6px !important;
                border-left: 4px solid #1890ff !important;
            }

            .feishu-md-modal-step-title {
                font-weight: 600 !important;
                color: #333 !important;
                margin-bottom: 4px !important;
            }

            .feishu-md-modal-step-desc {
                color: #666 !important;
                font-size: 13px !important;
                line-height: 1.4 !important;
            }

            .feishu-md-kbd {
                display: inline-block !important;
                background: #f5f5f5 !important;
                border: 1px solid #d9d9d9 !important;
                border-radius: 3px !important;
                padding: 2px 6px !important;
                font-family: monospace !important;
                font-size: 12px !important;
                font-weight: 600 !important;
            }

            .feishu-md-progress {
                width: 100% !important;
                height: 4px !important;
                background: #f0f0f0 !important;
                border-radius: 2px !important;
                overflow: hidden !important;
                margin-top: 16px !important;
            }

            .feishu-md-progress-bar {
                height: 100% !important;
                background: #1890ff !important;
                border-radius: 2px !important;
                animation: progress 10s linear forwards !important;
            }

            @keyframes progress {
                from { width: 0%; }
                to { width: 100%; }
            }

            .feishu-md-tip {
                background: #e6f7ff !important;
                border: 1px solid #91d5ff !important;
                border-radius: 6px !important;
                padding: 12px !important;
                margin-top: 16px !important;
                font-size: 13px !important;
                color: #0050b3 !important;
            }

            .feishu-md-notification {
                position: fixed !important;
                top: 20px !important;
                right: 20px !important;
                z-index: 10002 !important;
                max-width: 300px !important;
                background: white !important;
                border-radius: 6px !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
                padding: 16px !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                transform: translateX(100%) !important;
                transition: transform 0.3s ease !important;
            }

            .feishu-md-notification.show {
                transform: translateX(0) !important;
            }

            .feishu-md-notification-title {
                font-size: 14px !important;
                font-weight: 600 !important;
                color: #333 !important;
                margin-bottom: 4px !important;
                display: flex !important;
                align-items: center !important;
            }

            .feishu-md-notification-text {
                font-size: 13px !important;
                color: #666 !important;
                line-height: 1.4 !important;
            }

            .feishu-md-notification.success {
                border-left: 4px solid #52c41a !important;
            }

            .feishu-md-notification.error {
                border-left: 4px solid #ff4d4f !important;
            }

            .feishu-md-notification-icon {
                margin-right: 6px !important;
                font-size: 14px !important;
            }

            .feishu-md-center-tip {
                position: fixed !important;
                top: 50% !important;
                left: 50% !important;
                transform: translate(-50%, -50%) scale(0.8) !important;
                z-index: 10003 !important;
                background: rgba(0, 0, 0, 0.75) !important;
                color: white !important;
                padding: 20px 32px !important;
                border-radius: 12px !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
                font-size: 16px !important;
                font-weight: 500 !important;
                text-align: center !important;
                backdrop-filter: blur(10px) !important;
                -webkit-backdrop-filter: blur(10px) !important;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
                opacity: 0 !important;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                pointer-events: none !important;
                min-width: 280px !important;
            }

            .feishu-md-center-tip.show {
                opacity: 1 !important;
                transform: translate(-50%, -50%) scale(1) !important;
            }

            .feishu-md-center-tip-icon {
                font-size: 24px !important;
                margin-bottom: 8px !important;
                display: block !important;
            }

            .feishu-md-center-tip-text {
                margin-bottom: 12px !important;
                line-height: 1.4 !important;
            }

            .feishu-md-center-tip-scroll {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
                color: rgba(255, 255, 255, 0.8) !important;
                font-size: 14px !important;
            }

            .feishu-md-scroll-arrow {
                animation: scrollBounce 1.5s ease-in-out infinite !important;
            }

            @keyframes scrollBounce {
                0%, 100% {
                    transform: translateY(0);
                }
                50% {
                    transform: translateY(5px);
                }
            }

            .feishu-md-scroll-dots {
                display: flex !important;
                gap: 3px !important;
                margin-left: 8px !important;
            }

            .feishu-md-scroll-dot {
                width: 4px !important;
                height: 4px !important;
                background: rgba(255, 255, 255, 0.6) !important;
                border-radius: 50% !important;
                animation: dotPulse 1.5s ease-in-out infinite !important;
            }

            .feishu-md-scroll-dot:nth-child(2) {
                animation-delay: 0.3s !important;
            }

            .feishu-md-scroll-dot:nth-child(3) {
                animation-delay: 0.6s !important;
            }

            @keyframes dotPulse {
                0%, 100% {
                    opacity: 0.6;
                    transform: scale(1);
                }
                50% {
                    opacity: 1;
                    transform: scale(1.2);
                }
            }
        `;
        document.head.appendChild(mdStyle);

        // 创建Markdown转换按钮
        mdButton = document.createElement("button");
        mdButton.innerHTML = `
            <svg viewBox="0 0 24 24">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
            </svg>
            获取全文
        `;
        mdButton.className = "feishu-md-button primary";
        mdButton.style.visibility = "hidden";
        // 暂时不开放
        document.body.appendChild(mdButton);

        mdButton.addEventListener("click", handleMdButtonClick);

        // 监听键盘事件
        document.addEventListener('keydown', function (e) {
            // ESC键关闭模态框
            if (e.key === 'Escape') {
                closeMdModal();
            }

            if (e.ctrlKey && e.key === 'a') {
                // 用户按了 Ctrl+A，隐藏提示框
                closeMdModal();
            }
        });
    }

    // Markdown转换按钮点击处理
    function handleMdButtonClick() {
        const STORAGE_KEY = 'feishu_md_first_time';
        const isFirstTimeEver = !localStorage.getItem(STORAGE_KEY);
        const shouldShowTip = isFirstTimeEver && usageCount === 0;
        if (!isProcessing) {
            // 开始处理
            isProcessing = true;
            mdButton.innerHTML = `结束获取 (0)`;
            mdButton.className = "feishu-md-button danger";
            // 开始自动收集
            startAutoCollection();
            // 检查是否需要显示详细指导（首次使用）
            if (isFirstTimeEver && usageCount === 0) {
                // 标记为非第一次使用（localStorage）
                localStorage.setItem(STORAGE_KEY, 'false');
                // const modal = createDetailedMdModal();
                // 25秒后自动隐藏
                // tooltipTimer = setTimeout(() => {
                // closeMdModal();
                // }, 25000);
            } else {
                // 显示中间提示框 - 开始阶段
                createMdCenterTip('正在自动收集内容', 'start');
            }
            // 增加使用次数计数
            usageCount++;
        } else {
            // 结束处理，开始转换
            isProcessing = false;
            // 停止自动收集
            stopAutoCollection();
            // 关闭模态框
            closeMdModal();
            // 显示处理中状态
            setTimeout(() => {
                mdButton.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z">
                        <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
                    </path>
                </svg>
                处理中...
            `;
                mdButton.className = "feishu-md-button processing";
                mdButton.disabled = true;
                // 延迟一下再执行转换，确保页面渲染完成
                setTimeout(async () => {
                    await convertCollectedToMarkdown();

                    // 恢复按钮状态
                    mdButton.innerHTML = `
                    <svg viewBox="0 0 24 24">
                        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
                    </svg>
                    获取全文
                `;
                    mdButton.className = "feishu-md-button primary";
                    mdButton.disabled = false;
                }, 500);
            }, 500);
        }
    }

    // 创建中间提示框
    function createMdCenterTip(message, type = 'start') {
        // 移除已存在的中间提示框
        const existingTip = document.querySelector('.feishu-md-center-tip');
        if (existingTip) {
            existingTip.remove();
        }

        const tip = document.createElement("div");
        tip.className = "feishu-md-center-tip";

        let icon, text, scrollHint;

        if (type === 'start') {
            text = '正在自动浏览内容中……';
            scrollHint = `
                <div class="feishu-md-center-tip-scroll">
                    <span class="feishu-md-scroll-arrow">↓</span>
                    滑动加载内容
                    <div class="feishu-md-scroll-dots">
                        <div class="feishu-md-scroll-dot"></div>
                        <div class="feishu-md-scroll-dot"></div>
                        <div class="feishu-md-scroll-dot"></div>
                    </div>
                </div>
            `;
        }

        tip.innerHTML = `
            <div class="feishu-md-center-tip-text">${text}</div>
            ${scrollHint}
        `;

        document.body.appendChild(tip);

        // 显示动画
        setTimeout(() => {
            tip.classList.add('show');
        }, 100);

        // 2秒后自动隐藏
        setTimeout(() => {
            tip.classList.remove('show');
            setTimeout(() => {
                if (tip.parentNode) {
                    tip.remove();
                }
            }, 300);
        }, 2000);

        return tip;
    }

    // 关闭模态框的函数
    function closeMdModal() {
        if (tooltipTimer) {
            clearTimeout(tooltipTimer);
            tooltipTimer = null;
        }
        const modal = document.querySelector('.feishu-md-modal');
        if (modal) {
            modal.remove();
        }
    }

    // 创建详细操作指导模态框
    function createDetailedMdModal() {
        const existingModal = document.querySelector('.feishu-md-modal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement("div");
        modal.className = "feishu-md-modal";

        const modalContent = document.createElement("div");
        modalContent.className = "feishu-md-modal-content";

        modalContent.innerHTML = `
            <button class="feishu-md-modal-close" type="button" aria-label="关闭">×</button>
            <div class="feishu-md-modal-title">📋 飞书文档转 Markdown 使用指南</div>

            <div class="feishu-md-modal-text">
                欢迎使用飞书文档转换工具！此工具将自动扫描获取文档内容，并支持智能问答功能。
            </div>

            <div class="feishu-md-modal-steps">
                <div class="feishu-md-modal-step">
                    <div class="feishu-md-modal-step-title">第一步：自动滚动扫描</div>
                    <div class="feishu-md-modal-step-desc">
                        工具将自动滚动页面，获取文档的全部内容。飞书采用懒加载机制，需要滚动到对应位置才能加载内容。
                    </div>
                </div>

                <div class="feishu-md-modal-step">
                    <div class="feishu-md-modal-step-title">第二步：控制扫描进度</div>
                    <div class="feishu-md-modal-step-desc">
                        你可以<strong>点击"结束获取"按钮提前结束扫描</strong>，或者等待系统自动扫描到文档结尾后自动结束。
                    </div>
                </div>

                <div class="feishu-md-modal-step">
                    <div class="feishu-md-modal-step-title">第三步：智能问答</div>
                    <div class="feishu-md-modal-step-desc">
                        扫描完成后，你可以<strong>针对文档内容进行提问</strong>，工具将基于获取的内容为你提供智能回答。
                    </div>
                </div>
            </div>

            <div class="feishu-md-tip">
                💡 <strong>小贴士：</strong>扫描过程中请保持页面活跃状态，完成后即可开始智能问答。
            </div>

            <div class="feishu-md-progress">
                <div class="feishu-md-progress-bar"></div>
            </div>
        `;


        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // 添加关闭按钮事件监听
        const closeBtn = modalContent.querySelector('.feishu-md-modal-close');
        closeBtn.addEventListener('click', closeMdModal);

        // 点击背景关闭模态框
        modal.addEventListener('click', function (e) {
            if (e.target === modal) {
                closeMdModal();
            }
        });

        return modal;
    }

    // 创建右上角通知
    function createMdNotification(title, content, type = 'success') {
        const notification = document.createElement("div");
        notification.className = `feishu-md-notification ${type}`;

        const icon = type === 'success' ? '✅' : '❌';

        notification.innerHTML = `
            <div class="feishu-md-notification-title">
                <span class="feishu-md-notification-icon">${icon}</span>
                ${title}
            </div>
            <div class="feishu-md-notification-text">${content}</div>
        `;

        document.body.appendChild(notification);

        // 显示动画
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);

        // 自动隐藏
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, 1000);

        return notification;
    }
    // 获取DOM元素的唯一标识
    function getElementHash(element) {
        // 直接使用元素的outerHTML生成hash
        const htmlContent = element.innerHTML + element.src + element.textContent + element.getAttribute('data-line-num');
        // 生成hash值
        return encodeURIComponent(htmlContent);
    }
    // 收集页面内容的函数
    function collectPageContent() {
        try {
            // 选择需要处理的节点
            const nodesToProcess = document.querySelectorAll('.heading-h2, .heading-h3,.heading-h4,.heading-h5, .docx-text-block, .docx-image, table, .list-content, .inline-code, .code-line-wrapper,canvas');
            // 遍历节点，收集内容
            nodesToProcess.forEach((node) => {
                // 获取元素的唯一标识
                const elementHash = getElementHash(node);

                // 如果这个元素已经被收集过，直接跳过
                if (collectedNodes.has(elementHash)) {
                    return;
                }
                let type, content;

                switch (true) {
                    case node.classList.contains('heading-h2'):
                        type = 'heading-h2';
                        content = node.textContent.trim().replace(/\u200B/g, '');
                        break;
                    case node.classList.contains('heading-h3'):
                        type = 'heading-h3';
                        content = node.textContent.trim().replace(/\u200B/g, '');
                        break;
                    case node.classList.contains('heading-h4'):
                        type = 'heading-h4';
                        content = node.textContent.trim().replace(/\u200B/g, '');
                        break;
                    case node.classList.contains('heading-h5'):
                        type = 'heading-h5';
                        content = node.textContent.trim().replace(/\u200B/g, '');
                        break;
                    case node.classList.contains('docx-text-block'):
                        // 排除表格
                        if (!node.closest || !node.closest('table')) {
                            const spans = node.querySelectorAll('span');
                            let textSet = new Set(); // 使用 Set 存储内容，确保不重复
                            spans.forEach(span => {
                                if (span.style.fontWeight === 'bold') {
                                    textSet.add('**' + span.textContent.replace(/\u200B/g, '') + '**');
                                } else if (span.classList.contains('inline-code')) {
                                    // 如果是行内代码，将其文本内容用 `` 符号包裹起来
                                    textSet.add('`' + span.textContent.replace(/\u200B/g, '') + '`');
                                } else if (
                                    // 没有子元素且任意父元素中不含.inline-code的类名
                                    span.childElementCount === 0 &&
                                    !span.closest('.inline-code')
                                ) {
                                    textSet.add(span.textContent.replace(/\u200B/g, ''));
                                }
                            });
                            type = 'text-block';
                            content = Array.from(textSet).join(''); // 转换 Set 为数组，并用 join 方法连接成字符串
                        }
                        break;
                    case node.classList.contains('docx-image'):
                        type = 'img';
                        content = node.src;
                        break;
                    case node.tagName.toLowerCase() === 'table':
                        type = 'table-block';
                        content = { rows: [] };
                        // 将表格中的行和列数据保存到 content.rows 中
                        var rows = node.querySelectorAll('tr');
                        rows.forEach((row) => {
                            const rowData = [];
                            const cells = row.querySelectorAll('td, th');
                            cells.forEach((cell) => {
                                rowData.push(cell.textContent.trim().replace(/\u200B/g, ''));
                            });
                            content.rows.push(rowData);
                        });
                        break;
                    case node.classList.contains('list-content'):
                        type = 'list';
                        content = node.textContent.trim().replace(/\u200B/g, '');
                        break;
                    case node.classList.contains('code-line-wrapper'):
                        type = 'code-block';
                        content = node.textContent;
                        break;
                    case node.tagName.toLowerCase() === 'canvas' && node.id.startsWith('__ratio_sdk_canvas') && !node.id.startsWith('__ratio_sdk_canvas_0__'):
                        type = 'canvas';
                        content = node.toDataURL('image/png');
                        break;
                    default:
                        break;
                }
                // 如果有内容，添加到集合中
                if (content && (typeof content === 'string' ? content.trim() : true)) {
                    const nodeObj = {
                        type: type,
                        content: content,
                        elementHash: elementHash,
                        timestamp: Date.now(),
                        element: node, // 保存原始元素引用，用于排序
                        documentOrder: getDocumentOrder(node) // 获取在文档中的顺序
                    };
                    if (collectedNodes.get(node) != null && collectedNodes.get(node).elementHash.length >= nodeObj.elementHash.length) {
                        return
                    } else {
                        if (type === 'canvas' && node.id != '') {
                            collectedNodes.set(node.id, nodeObj);
                        } else {
                            collectedNodes.set(node, nodeObj);
                        }


                    }

                }
            });
            // 更新按钮文本显示收集的数量
            if (isProcessing) {
                const count = collectedNodes.size;
                mdButton.innerHTML = `结束获取 (${count})`;
            }
        } catch (error) {
            console.warn("收集内容时出现错误:", error);
        }
    }
    // 获取元素在文档中的顺序（用于排序）
    function getDocumentOrder(element) {
        let order = 0;
        let current = element;

        // 计算元素在文档中的大致位置
        while (current && current.parentNode) {
            let sibling = current.previousSibling;
            while (sibling) {
                order++;
                sibling = sibling.previousSibling;
            }
            current = current.parentNode;
            order += 1000; // 每层级增加1000，确保层级差异
        }

        return order;
    }
    // 开始自动收集
    function startAutoCollection() {
        // 清空之前收集的内容
        collectedNodes.clear();

        collectPageContent();
        scroller.start(); // 开始滚动
        collectionInterval = setInterval(collectPageContent, 100);
        collectionInterval2 = setInterval(function () {
            if (!scroller.getStatus().active) {
                handleMdButtonClick()
            }
        }, 100);
    }
    // 停止自动收集
    function stopAutoCollection() {
        if (collectionInterval) {
            scroller.stop()
            clearInterval(collectionInterval);
            clearInterval(collectionInterval2);
            collectionInterval = null;
            collectionInterval2 = null;
        }
    }
    // 转换收集到的内容为Markdown - 修改为异步函数以处理图片转换
    async function convertCollectedToMarkdown() {
        try {
            // 将Map转换为数组并按照在页面中的位置排序
            const nodesArray = Array.from(collectedNodes.values());

            // 将节点信息转换为 Markdown 格式的文本
            let markdownContent = '';

            // 用于存储需要异步处理的图片
            const imagePromises = [];

            for (const node of nodesArray) {
                switch (node.type) {
                    case 'heading-h2':
                        markdownContent += '## ' + node.content + '\n\n';
                        break;
                    case 'heading-h3':
                        markdownContent += '### ' + node.content + '\n\n';
                        break;
                    case 'heading-h4':
                        markdownContent += '#### ' + node.content + '\n\n';
                        break;
                    case 'heading-h5':
                        markdownContent += '#### ' + node.content + '\n\n';
                        break;
                    case 'text-block':
                        markdownContent += node.content + '\n\n';
                        break;
                    case 'code-block':
                        markdownContent += node.content + '\n';
                        break;
                    case 'img':
                        // 检查是否是 blob URL
                        if (node.content.startsWith('blob:')) {
                            try {
                                // 创建一个 Promise 来处理 blob 转 base64
                                const imagePromise = fetch(node.content)
                                    .then(response => response.blob())
                                    .then(blob => {
                                        return new Promise((resolve) => {
                                            const reader = new FileReader();
                                            reader.onload = function (e) {
                                                resolve(e.target.result);
                                            };
                                            reader.onerror = function () {
                                                resolve(node.content); // 失败时使用原 URL
                                            };
                                            reader.readAsDataURL(blob);
                                        });
                                    })
                                    .catch(() => node.content); // 失败时使用原 URL

                                imagePromises.push(imagePromise);
                                // 临时使用占位符
                                markdownContent += `![IMAGE_PLACEHOLDER_${imagePromises.length - 1}]()` + '\n';
                            } catch (error) {
                                console.warn('Error processing blob URL:', error);
                                markdownContent += '![](' + node.content + ')' + '\n';
                            }
                        } else {
                            // 普通 URL 或已经是 base64 格式
                            markdownContent += '![](' + node.content + ')' + '\n';
                        }
                        break;
                    case 'list':
                        markdownContent += '- ' + node.content + '\n\n';
                        break;
                    case 'table-block':
                        var table = node.content;
                        var rows = table.rows;
                        if (rows.length > 0) {
                            var columnCount = rows[0].length;
                            var rowCount = rows.length;
                            // 表头
                            markdownContent += '|';
                            for (let i = 0; i < columnCount; i++) {
                                markdownContent += rows[0][i] + '|';
                            }
                            markdownContent += '\n|';
                            for (let i = 0; i < columnCount; i++) {
                                markdownContent += ':---:|';
                            }
                            markdownContent += '\n';
                            // 表格内容
                            for (let i = 1; i < rowCount; i++) {
                                const row = rows[i];
                                markdownContent += '|';
                                for (let j = 0; j < columnCount; j++) {
                                    markdownContent += row[j] + '|';
                                }
                                markdownContent += '\n';
                            }
                            markdownContent += '\n';
                        }
                        break;
                    case 'canvas':
                        markdownContent += `![画板${node.element.id}](` + node.content + ')' + '\n\n';
                        break;
                    default:
                        break;
                }
            }

            // 等待所有图片转换完成
            if (imagePromises.length > 0) {
                const convertedImages = await Promise.all(imagePromises);

                // 替换占位符为实际的 base64 数据
                convertedImages.forEach((base64Data, index) => {
                    const placeholder = `![IMAGE_PLACEHOLDER_${index}]()`;
                    const imageMarkdown = `![](${base64Data})`;
                    markdownContent = markdownContent.replace(placeholder, imageMarkdown);
                });
            }
            //调用https://test-ai.palmplaystore.com/ai/open/UpdateContent 上传markdownContent
            try {
                const uploadResponse = await fetch('https://test-ai.palmplaystore.com/ai/open/UpdateContent', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        currentUrl: currentUrl,
                        currentContent: markdownContent
                    })
                });
                if (uploadResponse.ok) {
                    createMdNotification("获取成功", "内容已上传到服务器", "success");
                } else {
                    throw new Error(`上传失败: ${uploadResponse.status}`);
                }
            } catch (uploadError) {
                console.error("上传失败:", uploadError);
                createMdNotification("获取失败", "内容上传到服务器失败", "error");
            }
            // 复制到剪贴板
            // navigator.clipboard.writeText(markdownContent).then(() => {
            //     console.log("Markdown content copied to clipboard.");
            //     console.log("收集到的节点数量:", collectedNodes.size);
            //     createMdNotification("复制成功", `已收集${collectedNodes.size}个内容块`, "success");
            // }, () => {
            //     console.error("Failed to copy Markdown content to clipboard.");
            //     console.log("Markdown内容:", markdownContent);
            //     createMdNotification("复制失败", "请手动复制控制台内容", "error");
            // });
        } catch (error) {
            console.error("转换过程中出现错误:", error);
            createMdNotification("转换错误", "转换失败，请重试", "error");
        }
    }


    // 创建常驻的浮动AI按钮
    function createFloatingAiButton() {
        floatingAiButton = document.createElement('div');
        floatingAiButton.id = 'floating-ai-button';
        floatingAiButton.style.cssText = `
        position: fixed;
        right: 20px;
        bottom: 80px;
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: 2px solid rgba(255,255,255,0.3);
        border-radius: 50%;
        cursor: pointer;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(10px);
        user-select: none;
    `;

        // 创建AI图标
        const aiIcon = document.createElement('div');
        aiIcon.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" fill="white" opacity="0.9"/>
                <path d="M19 11L19.5 13.5L22 14L19.5 14.5L19 17L18.5 14.5L16 14L18.5 13.5L19 11Z" fill="white" opacity="0.7"/>
                <path d="M5 6L5.5 7.5L7 8L5.5 8.5L5 10L4.5 8.5L3 8L4.5 7.5L5 6Z" fill="white" opacity="0.7"/>
            </svg>
            <div style="font-size: 10px; color: white; font-weight: 600; margin-top: 2px; letter-spacing: 0.2px;">AI</div>
        </div>
    `;
        aiIcon.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
    `;

        floatingAiButton.appendChild(aiIcon);

        // 悬停效果
        floatingAiButton.addEventListener('mouseenter', function () {
            if (!isDraggingFloat) {
                this.style.transform = 'scale(1.1)';
                this.style.boxShadow = '0 12px 30px rgba(102, 126, 234, 0.6)';
            }
        });

        floatingAiButton.addEventListener('mouseleave', function () {
            if (!isDraggingFloat) {
                this.style.transform = 'scale(1)';
                this.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.4)';
            }
        });

        // 拖拽功能
        floatingAiButton.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();

            // 记录初始位置，用于判断是否真正发生了拖拽
            const initialX = e.clientX;
            const initialY = e.clientY;

            dragStartX = e.clientX;
            dragStartY = e.clientY;

            const rect = this.getBoundingClientRect();
            buttonStartX = rect.left;
            buttonStartY = rect.top;

            this.style.transition = 'none';
            this.style.cursor = 'grabbing';
            this.style.transform = 'scale(1.05)';

            // 创建拖拽处理函数
            const handleDrag = (e) => {
                const deltaX = Math.abs(e.clientX - initialX);
                const deltaY = Math.abs(e.clientY - initialY);

                // 只有移动距离超过阈值才认为是拖拽
                if (deltaX > 5 || deltaY > 5) {
                    isDraggingFloat = true;
                }

                if (isDraggingFloat) {
                    handleFloatDrag(e);
                }
            };

            const handleDragEnd = (e) => {
                document.removeEventListener('mousemove', handleDrag);
                document.removeEventListener('mouseup', handleDragEnd);

                if (isDraggingFloat) {
                    // 真正的拖拽结束
                    handleFloatDragEnd(e);
                } else {
                    // 这是一个点击操作
                    this.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                    this.style.cursor = 'pointer';
                    this.style.transform = 'scale(1)';

                    // 触发点击事件
                    handleFloatingButtonClick(e);
                }
            };

            document.addEventListener('mousemove', handleDrag);
            document.addEventListener('mouseup', handleDragEnd);
        });

        document.body.appendChild(floatingAiButton);
    }

    // 处理常驻按钮点击
    function handleFloatingButtonClick(e) {
        e.stopPropagation();
        // 隐藏其他可能存在的弹窗
        hideAiButton();
        hideInputBox();

        // 显示输入框，选中内容为空
        selectedText = '';
        const rect = floatingAiButton.getBoundingClientRect();
        showInputBox({
            left: rect.left - 200,
            top: rect.top,
            bottom: rect.bottom,
            right: rect.right
        }, true); // 传入 true 表示是常驻按钮调用
    }


    // 处理常驻按钮拖拽
    function handleFloatDrag(e) {
        if (!isDraggingFloat) return;

        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;

        let newX = buttonStartX + deltaX;
        let newY = buttonStartY + deltaY;

        // 边界检测
        const buttonSize = 56;
        const maxX = window.innerWidth - buttonSize;
        const maxY = window.innerHeight - buttonSize;

        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));

        floatingAiButton.style.left = newX + 'px';
        floatingAiButton.style.top = newY + 'px';
        floatingAiButton.style.right = 'auto';
        floatingAiButton.style.bottom = 'auto';
    }

    // 处理常驻按钮拖拽结束
    function handleFloatDragEnd(e) {
        if (!isDraggingFloat) return;

        isDraggingFloat = false;

        floatingAiButton.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        floatingAiButton.style.cursor = 'pointer';
        floatingAiButton.style.transform = 'scale(1)';

        document.removeEventListener('mousemove', handleFloatDrag);
        document.removeEventListener('mouseup', handleFloatDragEnd);

        // 吸附到边缘
        snapToEdge();
    }

    // 修改 snapToEdge 函数，只在必要时吸附
    function snapToEdge() {
        const rect = floatingAiButton.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // 检查是否需要吸附（距离边缘很近才吸附）
        const snapThreshold = 50; // 距离边缘50像素内才吸附

        let needSnap = false;
        let newLeft = rect.left;

        // 水平方向吸附
        if (rect.left < snapThreshold) {
            // 靠近左边缘
            newLeft = 20;
            needSnap = true;
        } else if (rect.right > screenWidth - snapThreshold) {
            // 靠近右边缘
            newLeft = screenWidth - rect.width - 20;
            needSnap = true;
        }

        // 只有在需要吸附时才移动
        if (needSnap) {
            floatingAiButton.style.left = newLeft + 'px';
            floatingAiButton.style.right = 'auto';
        }
    }

    // 初始化剪贴板监听
    function initializeClipboardListener() {
        // 监听 Ctrl+C 组合键
        document.addEventListener('keydown', function (e) {
            // 检测 Ctrl+C 或 Cmd+C (Mac)
            if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !clipboardCheckInProgress) {

                // 记录当前时间
                const currentTime = Date.now();
                lastCtrlCTime = currentTime;

                // 重置AI关闭状态
                aiDismissed = false;

                // 延迟检查剪贴板，确保复制操作完成
                setTimeout(() => {
                    // 检查是否是最新的Ctrl+C操作（防止延迟导致的重复处理）
                    if (currentTime === lastCtrlCTime) {
                        checkClipboardAndShowAI(e, true); // 传入 true 表示强制显示
                    }
                }, 200);
            }
        });

        // 定期检查剪贴板变化（可选，作为备用方案）
        setInterval(() => {
            if (!inputBoxVisible && !aiButtonVisible && !clipboardCheckInProgress && !aiDismissed) {
                checkClipboardSilently();
            }
        }, 2000);
    }

    // 检查剪贴板并显示AI助手
    async function checkClipboardAndShowAI(event, forceShow = false) {
        if (clipboardCheckInProgress) return;

        clipboardCheckInProgress = true;

        try {
            let clipboardText = '';

            // 尝试多种方式读取剪贴板
            try {
                // 方法1: 使用现代浏览器API
                if (navigator.clipboard && navigator.clipboard.readText) {
                    clipboardText = await navigator.clipboard.readText();
                }
            } catch (err) {
                console.log('现代API读取剪贴板失败，尝试其他方式:', err);
            }

            // 方法2: 如果现代API失败，尝试Tampermonkey API
            if (!clipboardText && typeof GM_getClipboard !== 'undefined') {
                try {
                    clipboardText = GM_getClipboard();
                } catch (err) {
                    console.log('GM API读取剪贴板失败:', err);
                }
            }

            // 方法3: 检查当前选中的文本
            if (!clipboardText) {
                const selection = window.getSelection();
                if (selection && selection.toString().trim()) {
                    clipboardText = selection.toString().trim();
                }
            }

            // 修改这里的逻辑：如果是强制显示或者内容不同，就显示AI按钮
            if (clipboardText && clipboardText.trim()) {
                const trimmedText = clipboardText.trim();

                // 如果是强制显示(Ctrl+C触发)或者内容与上次不同，就显示AI按钮
                if (forceShow || trimmedText !== lastClipboardContent) {
                    lastClipboardContent = trimmedText;
                    selectedText = trimmedText;

                    console.log('从剪贴板获取到文本:', selectedText);

                    // 显示AI按钮在鼠标位置或屏幕中心
                    let rect;
                    if (event && event.clientX && event.clientY) {
                        rect = {
                            right: event.clientX,
                            top: event.clientY,
                            bottom: event.clientY,
                            left: event.clientX
                        };
                    } else {
                        // 使用视口中心位置
                        rect = {
                            right: window.innerWidth / 2,
                            top: window.innerHeight / 2,
                            bottom: window.innerHeight / 2,
                            left: window.innerWidth / 2
                        };
                    }

                    showAiButton(rect);
                }
            }
        } catch (error) {
            console.log('读取剪贴板失败:', error);
        }

        clipboardCheckInProgress = false;
    }

    // 静默检查剪贴板变化
    async function checkClipboardSilently() {
        try {
            let clipboardText = '';

            if (navigator.clipboard && navigator.clipboard.readText) {
                clipboardText = await navigator.clipboard.readText();
            } else if (typeof GM_getClipboard !== 'undefined') {
                clipboardText = GM_getClipboard();
            }

            if (clipboardText && clipboardText.trim() && clipboardText !== lastClipboardContent) {
                lastClipboardContent = clipboardText;
                //console.log('检测到剪贴板内容变化');
            }
        } catch (error) {
            // 静默失败，不输出错误
        }
    }

    // 监听鼠标按下事件
    document.addEventListener('mousedown', function (e) {
        // 如果点击的是AI按钮、输入框或常驻按钮
        if ((aiButton && aiButton.contains(e.target)) ||
            (inputBox && inputBox.contains(e.target)) ||
            (floatingAiButton && floatingAiButton.contains(e.target)) ||
            (mdButton && mdButton.contains(e.target))) {
            return;
        }

        isMouseDown = true;
        isDragging = false; // 重置拖拽状态

        // 隐藏之前的AI按钮（如果存在）
        if (aiButtonVisible) {
            hideAiButton();
        }
    });

    // 监听鼠标移动事件
    document.addEventListener('mousemove', function (e) {
        if (isMouseDown && !isDraggingFloat) {
            isDragging = true; // 标记为正在拖拽
        }
    });

    // 监听鼠标松开事件
    document.addEventListener('mouseup', function (e) {
        if (isMouseDown && !isDraggingFloat) {
            isMouseDown = false;

            // 只有在真正发生了拖拽选择后才检查选择
            if (isDragging) {
                // 延迟检查选择，确保选择已经完成
                setTimeout(() => checkSelection(e), 100);
            }

            isDragging = false; // 重置拖拽状态
        }
    });

    // 增强的选择检测函数
    function checkSelection(event) {
        if (inputBoxVisible || checkingSelection) return;

        checkingSelection = true;

        try {
            const selection = window.getSelection();

            // 多重检测机制
            let text = '';
            let rect = null;

            // 方法1: 标准选择检测
            if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
                text = selection.toString().trim();
                if (text) {
                    const range = selection.getRangeAt(0);
                    rect = range.getBoundingClientRect();
                }
            }

            // 方法2: 如果标准方法失败，尝试获取document.getSelection()
            if (!text && document.getSelection) {
                const docSelection = document.getSelection();
                if (docSelection && docSelection.toString) {
                    text = docSelection.toString().trim();
                    if (text && docSelection.rangeCount > 0) {
                        const range = docSelection.getRangeAt(0);
                        rect = range.getBoundingClientRect();
                    }
                }
            }

            // 方法3: 特殊情况处理 - 检查是否是全选
            if (!text || (rect && rect.width === 0 && rect.height === 0)) {
                // 延迟再次检查，处理全选等特殊情况
                setTimeout(() => {
                    const newSelection = window.getSelection();
                    if (newSelection && newSelection.toString) {
                        const newText = newSelection.toString().trim();
                        if (newText && newText.length > 0) {
                            selectedText = newText;
                            console.log('延迟检测到选中文本:', selectedText);

                            // 对于全选或无法获取正确位置的情况，使用事件位置或鼠标位置
                            let displayRect;
                            if (event && event.clientX && event.clientY) {
                                displayRect = {
                                    right: event.clientX,
                                    top: event.clientY,
                                    bottom: event.clientY,
                                    left: event.clientX
                                };
                            } else {
                                // 使用全局鼠标位置
                                displayRect = {
                                    right: window.lastMouseX || window.innerWidth / 2,
                                    top: window.lastMouseY || window.innerHeight / 2,
                                    bottom: window.lastMouseY || window.innerHeight / 2,
                                    left: window.lastMouseX || window.innerWidth / 2
                                };
                            }

                            showAiButton(displayRect, event);
                        }
                    }
                    checkingSelection = false;
                }, 150);
                return;
            }

            if (text && text.length > 0) {
                selectedText = text;
                console.log('检测到选中文本:', selectedText);

                // 处理rect为空或尺寸为0的情况
                if (!rect || (rect.width === 0 && rect.height === 0)) {
                    if (event && event.clientX && event.clientY) {
                        rect = {
                            right: event.clientX,
                            top: event.clientY,
                            bottom: event.clientY,
                            left: event.clientX,
                            width: 0,
                            height: 0
                        };
                    } else {
                        // 使用全局鼠标位置
                        rect = {
                            right: window.lastMouseX || window.innerWidth / 2,
                            top: window.lastMouseY || window.innerHeight / 2,
                            bottom: window.lastMouseY || window.innerHeight / 2,
                            left: window.lastMouseX || window.innerWidth / 2,
                            width: 0,
                            height: 0
                        };
                    }
                }

                // 传入事件对象，以便获取鼠标位置
                showAiButton(rect, event);
            } else {
                hideAiButton();
            }
        } catch (error) {
            console.log('选择检测出错:', error);
        }

        checkingSelection = false;
    }

    // 增强的键盘事件监听 - 针对全选
    document.addEventListener('keydown', function (e) {
        // 检测Ctrl+A或Cmd+A (Mac)
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            console.log('检测到全选操作');
            // 延迟检查，确保浏览器完成选择操作
            setTimeout(() => {
                checkSelection(null);
            }, 150);
        }
    });

    // 显示AI按钮 - 优化为鼠标附近位置
    function showAiButton(rect, mouseEvent = null) {
        // 确保只有一个弹窗
        hideAiButton(); // 先隐藏之前的按钮
        hideInputBox(); // 隐藏可能存在的输入框

        aiButtonVisible = true;
        aiDismissed = false; // 重置关闭状态

        // 创建AI按钮
        aiButton = document.createElement('div');

        // 优化初始位置计算 - 基于鼠标位置
        const buttonSize = 30;
        const margin = 30; // 增加边距，避免紧贴鼠标
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left, top;
        let mouseX, mouseY;

        // 获取鼠标位置
        if (mouseEvent && mouseEvent.clientX !== undefined && mouseEvent.clientY !== undefined) {
            // 使用传入的鼠标事件位置
            mouseX = mouseEvent.clientX;
            mouseY = mouseEvent.clientY;
        } else if (window.lastMouseX !== undefined && window.lastMouseY !== undefined) {
            // 使用全局记录的鼠标位置
            mouseX = window.lastMouseX;
            mouseY = window.lastMouseY;
        } else {
            // 回退到选区位置
            mouseX = rect.right;
            mouseY = rect.top;
        }

        // 智能位置计算 - 优先考虑鼠标位置
        // 水平位置：优先显示在鼠标右侧，空间不足时显示左侧
        if (mouseX + buttonSize + margin <= viewportWidth) {
            left = mouseX + margin;
        } else if (mouseX - buttonSize - margin >= 0) {
            left = mouseX - buttonSize - margin;
        } else {
            // 极端情况：显示在屏幕中央
            left = (viewportWidth - buttonSize) / 2;
        }

        top = mouseY

        // 确保不超出边界
        left = Math.max(10, Math.min(left, viewportWidth - buttonSize - 10));

        aiButton.style.cssText = `
        position: fixed;
        left: ${left}px;
        top: ${top}px;
        width: ${buttonSize}px;
        height: ${buttonSize}px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border: 2px solid rgba(255,255,255,0.3);
        border-radius: 50%;
        cursor: pointer;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4), 0 0 0 2px rgba(102, 126, 234, 0.6);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        animation: aiButtonSlideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(10px);
    `;

        // 修改样式配置，控制所有弹窗大小
        if (!document.getElementById('ai-assistant-style')) {
            const style = document.createElement('style');
            style.id = 'ai-assistant-style';
            style.textContent = `
    @keyframes aiButtonSlideIn {
        0% {
            opacity: 0;
            transform: scale(0.3) rotate(-180deg);
        }
        50% {
            transform: scale(1.1) rotate(0deg);
        }
        100% {
            opacity: 1;
            transform: scale(1) rotate(0deg);
        }
    }
    @keyframes aiButtonPulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.05); }
    }
    @keyframes inputBoxSlideIn {
        0% {
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
            backdrop-filter: blur(0px);
        }
        100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            backdrop-filter: blur(20px);
        }
    }
    @keyframes glowPulse {
        0%, 100% { box-shadow: 0 0 10px rgba(102, 126, 234, 0.3); }
        50% { box-shadow: 0 0 20px rgba(102, 126, 234, 0.6), 0 0 25px rgba(118, 75, 162, 0.4); }
    }
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    @keyframes slideInRight {
        0% {
            opacity: 0;
            transform: translateX(20px);
        }
        100% {
            opacity: 1;
            transform: translateX(0);
        }
    }
    @keyframes shrinkToCorner {
        0% {
            transform: scale(1) translate(0, 0);
            opacity: 1;
        }
        100% {
            transform: scale(0.5) translate(50%, -50%);
            opacity: 0.95;
        }
    }
    @keyframes processingWindowSlideIn {
        0% {
            transform: translateY(-100%);
            opacity: 0;
        }
        100% {
            transform: translateY(0);
            opacity: 1;
        }
    }
    /* 生成类型选择器样式 */
    .generation-type-selector {
        margin-bottom: 12px;
        padding: 8px;
        background: rgba(255,255,255,0.03);
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.1);
    }
    .generation-type-label {
        font-size: 11px;
        color: rgba(0,0,0,0.6);
        margin-bottom: 6px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .generation-type-options {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .generation-type-option {
        padding: 4px 8px;
        font-size: 11px;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        color: rgba(0,0,0,0.7);
        user-select: none;
    }
    .generation-type-option:hover {
        background: rgba(102, 126, 234, 0.2);
        border-color: rgba(102, 126, 234, 0.4);
        color: rgba(0,0,0,0.8);
    }
    .generation-type-option.selected {
        background: linear-gradient(135deg, #667eea, #764ba2);
        border-color: rgba(102, 126, 234, 0.8);
        color: white;
    }
`;
            document.head.appendChild(style);
        }

        // 创建AI图标
        const aiIcon = document.createElement('div');
        aiIcon.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" fill="white" opacity="0.9"/>
                <path d="M19 11L19.5 13.5L22 14L19.5 14.5L19 17L18.5 14.5L16 14L18.5 13.5L19 11Z" fill="white" opacity="0.7"/>
                <path d="M5 6L5.5 7.5L7 8L5.5 8.5L5 10L4.5 8.5L3 8L4.5 7.5L5 6Z" fill="white" opacity="0.7"/>
            </svg>
            <div style="font-size: 8px; color: white; font-weight: 600; margin-top: 1px; letter-spacing: 0.2px;">AI</div>
        </div>
    `;
        aiIcon.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        animation: glowPulse 2s ease-in-out infinite;
    `;

        aiButton.appendChild(aiIcon);

        // 悬停效果
        aiButton.addEventListener('mouseenter', function () {
            this.style.transform = 'scale(1.1)';
            this.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6), 0 0 0 2px rgba(102, 126, 234, 0.8)';
            this.style.animation = 'aiButtonPulse 1s ease-in-out infinite';
        });

        aiButton.addEventListener('mouseleave', function () {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4), 0 0 0 2px rgba(102, 126, 234, 0.6)';
            this.style.animation = 'glowPulse 2s ease-in-out infinite';
        });

        // 点击事件
        aiButton.addEventListener('click', function (e) {
            e.stopPropagation();
            showInputBox({
                left: left,
                top: top,
                bottom: top + buttonSize,
                right: left + buttonSize
            });
        });

        document.body.appendChild(aiButton);
    }



    function adjustAiButtonPosition() {
        // 可以保留这个函数用于特殊情况的微调，但通常不需要了
        if (!aiButton) return;

        const rect = aiButton.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const margin = 10;

        // 只在极端情况下进行微调
        if (rect.right > viewportWidth || rect.bottom > viewportHeight || rect.left < 0 || rect.top < 0) {
            let left = Math.max(margin, Math.min(parseInt(aiButton.style.left), viewportWidth - rect.width - margin));
            let top = Math.max(margin, Math.min(parseInt(aiButton.style.top), viewportHeight - rect.height - margin));

            aiButton.style.left = left + 'px';
            aiButton.style.top = top + 'px';
        }
    }

    // 隐藏AI按钮
    function hideAiButton() {
        if (aiButton) {
            aiButton.remove();
            aiButton = null;
        }
        aiButtonVisible = false;
        aiDismissed = true; // 标记AI被主动关闭
    }

    // 显示科技感输入框 - 修改以支持常驻按钮和外侧图片显示
    function showInputBox(rect, isFloatingButton = false) {
        // 确保样式已加载
        ensureStylesLoaded();

        // 确保只有一个弹窗
        hideAiButton(); // 隐藏AI按钮
        hideInputBox(); // 隐藏之前可能存在的输入框
        inputBoxVisible = true;
        aiDismissed = false; // 重置关闭状态

        // 创建输入框容器 - 修改尺寸
        inputBox = document.createElement('div');
        inputBox.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.bottom + 20}px;
        background: linear-gradient(145deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 16px;
        padding: 16px;
        z-index: 10001;
        box-shadow: 0 20px 60px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.1);
        width: 350px;
        max-height: 400px;
        overflow: visible;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: inputBoxSlideIn 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    `;

        // 创建标题栏 - 减小尺寸
        const titleBar = document.createElement('div');
        titleBar.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
    `;

        // AI图标（标题栏中的小图标）
        const titleIcon = document.createElement('div');
        titleIcon.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" fill="#667eea"/>
            <path d="M19 11L19.5 13.5L22 14L19.5 14.5L19 17L18.5 14.5L16 14L18.5 13.5L19 11Z" fill="#764ba2"/>
        </svg>
    `;
        titleIcon.style.marginRight = '6px';

        // 标题文字 - 减小字体
        const titleText = document.createElement('span');
        titleText.textContent = 'AI 智能助手';
        titleText.style.cssText = `
        font-size: 14px;
        font-weight: 600;
        background: linear-gradient(135deg, #667eea, #764ba2);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
    `;

        titleBar.appendChild(titleIcon);
        titleBar.appendChild(titleText);
        inputBox.appendChild(titleBar);

        // 新增：生成类型选择器
        const generationTypeSelector = document.createElement('div');
        generationTypeSelector.className = 'generation-type-selector';

        const typeLabel = document.createElement('div');
        typeLabel.className = 'generation-type-label';
        typeLabel.textContent = '生成类型';

        const typeOptions = document.createElement('div');
        typeOptions.className = 'generation-type-options';

        const types = [
            { value: 'auto', label: '自动' },
            { value: 'mermaid', label: 'Mermaid' },
            { value: 'drawio', label: 'DrawIO' },
            { value: 'svg', label: 'SVG' },
            { value: 'mindmap', label: '思维导图' }
        ];

        types.forEach((type, index) => {
            const option = document.createElement('div');
            option.className = 'generation-type-option';
            option.textContent = type.label;
            option.dataset.value = type.value;

            // 默认选中第一个
            if (index === 0) {
                option.classList.add('selected');
            }

            option.addEventListener('click', function () {
                // 清除其他选中状态
                typeOptions.querySelectorAll('.generation-type-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                // 选中当前选项
                this.classList.add('selected');
            });

            typeOptions.appendChild(option);
        });

        generationTypeSelector.appendChild(typeLabel);
        generationTypeSelector.appendChild(typeOptions);
        inputBox.appendChild(generationTypeSelector);

        // 创建图片显示区域（在输入框外侧）- 减小尺寸
        const imageDisplayArea = document.createElement('div');
        imageDisplayArea.id = 'image-display-area';
        imageDisplayArea.style.cssText = `
        margin-bottom: 12px;
        min-height: 0;
        transition: all 0.3s ease;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 0;
        border-radius: 8px;
    `;

        // 创建输入框容器
        const inputContainer = document.createElement('div');
        inputContainer.style.cssText = `
        position: relative;
        margin-bottom: 12px;
    `;

        // 创建输入框 - 纯文本输入，固定高度不延伸
        const input = document.createElement('div');
        input.setAttribute('contenteditable', 'true');
        input.id = 'ai-text-input';
        input.style.cssText = `
        width: 100%;
        height: 80px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        padding: 10px;
        font-size: 13px;
        color: rgba(0,0,0,0.9);
        font-family: inherit;
        box-sizing: border-box;
        transition: all 0.3s ease;
        outline: none;
        overflow-y: auto;
        line-height: 1.3;
        resize: none;
    `;

        // 设置占位符
        input.innerHTML = '<span style="color: rgba(0,0,0,0.5); pointer-events: none;">请输入您的需求，或直接粘贴图片...</span>';

        // 处理占位符显示/隐藏
        input.addEventListener('focus', function () {
            if (this.innerHTML === '<span style="color: rgba(0,0,0,0.5); pointer-events: none;">请输入您的需求，或直接粘贴图片...</span>') {
                this.innerHTML = '';
            }
            this.style.borderColor = 'rgba(102, 126, 234, 0.5)';
            this.style.boxShadow = '0 0 0 2px rgba(102, 126, 234, 0.1)';
            this.style.background = 'rgba(255,255,255,0.1)';
        });

        input.addEventListener('blur', function () {
            if (this.innerHTML.trim() === '' || this.textContent.trim() === '') {
                this.innerHTML = '<span style="color: rgba(0,0,0,0.5); pointer-events: none;">请输入您的需求，或直接粘贴图片...</span>';
            }
            this.style.borderColor = 'rgba(255,255,255,0.1)';
            this.style.boxShadow = 'none';
            this.style.background = 'rgba(255,255,255,0.05)';
        });

        // 添加图片粘贴功能（保持原有功能）
        input.addEventListener('paste', function (e) {
            e.preventDefault();
            const items = e.clipboardData.items;
            let hasImage = false;

            // 检查剪贴板中的图片
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type.indexOf('image') !== -1) {
                    hasImage = true;
                    const file = item.getAsFile();
                    if (file) {
                        // 处理图片文件，传入图片显示区域
                        handleImagePaste(file, imageDisplayArea);
                    }
                }
            }

            // 如果没有图片，处理普通文本
            if (!hasImage) {
                const text = e.clipboardData.getData('text/plain');
                if (text) {
                    // 清除占位符
                    if (input.innerHTML.includes('请输入您的需求')) {
                        input.innerHTML = '';
                    }
                    // 插入文本
                    const selection = window.getSelection();
                    const range = selection.getRangeAt(0);
                    range.deleteContents();
                    range.insertNode(document.createTextNode(text));
                    range.collapse(false);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }
        });

        inputContainer.appendChild(input);

        // 创建按钮容器 - 减小按钮尺寸
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    `;

        // 创建按钮样式函数 - 减小按钮
        function createButton(text, gradient, hoverGradient) {
            const btn = document.createElement('button');
            btn.style.cssText = `
            background: ${gradient};
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
            position: relative;
            overflow: hidden;
        `;
            btn.textContent = text;

            btn.addEventListener('mouseenter', function () {
                this.style.background = hoverGradient;
                this.style.transform = 'translateY(-1px)';
                this.style.boxShadow = '0 4px 15px rgba(0,0,0,0.15)';
            });

            btn.addEventListener('mouseleave', function () {
                this.style.background = gradient;
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = 'none';
            });

            return btn;
        }

        // 取消按钮
        const cancelBtn = createButton(
            '取消',
            'linear-gradient(135deg, #6b7280, #4b5563)',
            'linear-gradient(135deg, #4b5563, #374151)'
        );
        cancelBtn.onclick = function () {
            hideInputBox();
        };

        // 确认按钮 - 修改为获取选中的生成类型
        const confirmBtn = createButton(
            'AI 处理',
            'linear-gradient(135deg, #667eea, #764ba2)',
            'linear-gradient(135deg, #5a67d8, #6b46c1)'
        );
        confirmBtn.onclick = function () {
            const content = getInputContent(input);
            // 获取选中的生成类型
            const selectedType = typeOptions.querySelector('.generation-type-option.selected');
            const generationType = selectedType ? selectedType.dataset.value : 'auto';

            if (content.text.trim() || content.images.length > 0) {
                const textToProcess = isFloatingButton ? '' : selectedText;
                showProcessingWindow(textToProcess, content.text, content.images, generationType);
                hideInputBox(true);
            } else {
                input.style.borderColor = '#ef4444';
                input.focus();
                setTimeout(() => {
                    input.style.borderColor = 'rgba(255,255,255,0.1)';
                }, 2000);
            }
        };

        // 组装元素
        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(confirmBtn);

        inputBox.appendChild(imageDisplayArea);
        inputBox.appendChild(inputContainer);
        inputBox.appendChild(buttonContainer);

        document.body.appendChild(inputBox);

        // 自动聚焦
        setTimeout(() => input.focus(), 200);

        // 键盘事件
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                confirmBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideInputBox();
            }
        });

        // 调整位置
        adjustInputBoxPosition();

        // 阻止事件冒泡
        inputBox.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    }
    // 确保样式已加载的函数
    function ensureStylesLoaded() {
        if (!document.getElementById('ai-assistant-style')) {
            const style = document.createElement('style');
            style.id = 'ai-assistant-style';
            style.textContent = `
            @keyframes aiButtonSlideIn {
                0% {
                    opacity: 0;
                    transform: scale(0.3) rotate(-180deg);
                }
                50% {
                    transform: scale(1.1) rotate(0deg);
                }
                100% {
                    opacity: 1;
                    transform: scale(1) rotate(0deg);
                }
            }
            @keyframes aiButtonPulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.05); }
            }
            @keyframes inputBoxSlideIn {
                0% {
                    opacity: 0;
                    transform: translateY(-20px) scale(0.95);
                    backdrop-filter: blur(0px);
                }
                100% {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                    backdrop-filter: blur(20px);
                }
            }
            @keyframes glowPulse {
                0%, 100% { box-shadow: 0 0 10px rgba(102, 126, 234, 0.3); }
                50% { box-shadow: 0 0 20px rgba(102, 126, 234, 0.6), 0 0 25px rgba(118, 75, 162, 0.4); }
            }
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            @keyframes slideInRight {
                0% {
                    opacity: 0;
                    transform: translateX(20px);
                }
                100% {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
            @keyframes shrinkToCorner {
                0% {
                    transform: scale(1) translate(0, 0);
                    opacity: 1;
                }
                100% {
                    transform: scale(0.5) translate(50%, -50%);
                    opacity: 0.95;
                }
            }
            @keyframes processingWindowSlideIn {
                0% {
                    transform: translateY(-100%);
                    opacity: 0;
                }
                100% {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            /* 生成类型选择器样式 */
            .generation-type-selector {
                margin-bottom: 12px;
                padding: 8px;
                background: rgba(255,255,255,0.03);
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .generation-type-label {
                font-size: 11px;
                color: rgba(0,0,0,0.6);
                margin-bottom: 6px;
                font-weight: 500;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .generation-type-options {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            .generation-type-option {
                padding: 4px 8px;
                font-size: 11px;
                background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 12px;
                cursor: pointer;
                transition: all 0.2s ease;
                color: rgba(0,0,0,0.7);
                user-select: none;
            }
            .generation-type-option:hover {
                background: rgba(102, 126, 234, 0.2);
                border-color: rgba(102, 126, 234, 0.4);
                color: rgba(0,0,0,0.8);
            }
            .generation-type-option.selected {
                background: linear-gradient(135deg, #667eea, #764ba2);
                border-color: rgba(102, 126, 234, 0.8);
                color: white;
            }
        `;
            document.head.appendChild(style);
        }
    }

    // 修改 showProcessingWindow 函数参数
    function showProcessingWindow(text, prompt, images = [], generationType = 'auto') {
        // 创建处理窗口 - 减小尺寸
        processingWindow = document.createElement('div');
        processingWindow.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(145deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 12px;
        padding: 12px;
        z-index: 10003;
        box-shadow: 0 10px 30px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.1);
        width: 260px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        animation: processingWindowSlideIn 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        transition: all 0.3s ease;
    `;
        // 标题 - 减小字体
        const title = document.createElement('div');
        title.style.cssText = `
        display: flex;
        align-items: center;
        margin-bottom: 10px;
        font-size: 13px;
        font-weight: 600;
        color: rgba(0,0,0,0.8);
    `;
        // AI图标 - 减小尺寸
        const icon = document.createElement('div');
        icon.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" fill="#667eea"/>
            <path d="M19 11L19.5 13.5L22 14L19.5 14.5L19 17L18.5 14.5L16 14L18.5 13.5L19 11Z" fill="#764ba2"/>
        </svg>
    `;
        icon.style.marginRight = '6px';
        const titleText = document.createTextNode('AI 处理中...');
        title.appendChild(icon);
        title.appendChild(titleText);
        // 内容区域
        const content = document.createElement('div');
        content.style.cssText = `
        margin-bottom: 10px;
        font-size: 11px;
        color: rgba(0,0,0,0.6);
        display: flex;
        flex-direction: column;
        gap: 6px;
    `;
        // 显示生成类型
        const typeInfo = document.createElement('div');
        typeInfo.style.cssText = `
        background: rgba(255,255,255,0.1);
        border-radius: 6px;
        padding: 6px;
        font-size: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
    `;

        // 只有当有选中内容时才显示 - 减小尺寸
        if (text && text.trim()) {
            const selectedTextSummary = document.createElement('div');
            selectedTextSummary.style.cssText = `
            background: rgba(255,255,255,0.1);
            border-radius: 6px;
            padding: 6px;
            font-size: 10px;
            max-height: 30px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
            selectedTextSummary.textContent = `选中内容: ${text.substring(0, 40)}${text.length > 40 ? '...' : ''}`;
            content.appendChild(selectedTextSummary);
        }
        // 显示用户需求摘要 - 减小尺寸
        if (prompt && prompt.trim()) {
            const promptSummary = document.createElement('div');
            promptSummary.style.cssText = `
            background: rgba(255,255,255,0.1);
            border-radius: 6px;
            padding: 6px;
            font-size: 10px;
            max-height: 30px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        `;
            promptSummary.textContent = `需求: ${prompt.substring(0, 40)}${prompt.length > 40 ? '...' : ''}`;
            content.appendChild(promptSummary);
        }
        // 显示图片信息 - 减小尺寸
        if (images && images.length > 0) {
            const imageInfo = document.createElement('div');
            imageInfo.style.cssText = `
            background: rgba(255,255,255,0.1);
            border-radius: 4px;
            padding: 4px;
            font-size: 10px;
            display: flex;
            align-items: center;
            gap: 6px;
        `;
            const imageIcon = document.createElement('div');
            imageIcon.innerHTML = `
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="2"/>
                <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" stroke-width="2"/>
                <polyline points="21,15 16,10 5,21" stroke="currentColor" stroke-width="2"/>
            </svg>
        `;
            const imageText = document.createElement('span');
            imageText.textContent = `包含 ${images.length} 张图片`;
            imageInfo.appendChild(imageIcon);
            imageInfo.appendChild(imageText);
            content.appendChild(imageInfo);
        }
        // 进度指示器 - 减小尺寸
        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
    `;

        const spinner = document.createElement('div');
        spinner.style.cssText = `
        width: 14px;
        height: 14px;
        border: 2px solid rgba(102, 126, 234, 0.3);
        border-top: 2px solid rgba(102, 126, 234, 1);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        flex-shrink: 0;
    `;

        const progressText = document.createElement('div');
        progressText.style.cssText = `
        font-size: 11px;
        color: rgba(0,0,0,0.7);
        flex: 1;
    `;
        progressText.textContent = '正在处理您的请求...';

        // 组装进度条
        progressContainer.appendChild(spinner);
        progressContainer.appendChild(progressText);
        // 取消按钮 - 减小尺寸
        const cancelBtn = document.createElement('button');
        cancelBtn.style.cssText = `
        background: linear-gradient(135deg, #6b7280, #4b5563);
        color: white;
        border: none;
        padding: 5px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 11px;
        margin-top: 8px;
        align-self: flex-end;
        transition: all 0.3s ease;
    `;
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('mouseenter', function () {
            this.style.background = 'linear-gradient(135deg, #4b5563, #374151)';
            this.style.transform = 'translateY(-1px)';
        });
        cancelBtn.addEventListener('mouseleave', function () {
            this.style.background = 'linear-gradient(135deg, #6b7280, #4b5563)';
            this.style.transform = 'translateY(0)';
        });
        cancelBtn.addEventListener('click', function () {
            hideProcessingWindow();
        });
        // 组装内容
        content.appendChild(progressContainer);
        processingWindow.appendChild(title);
        processingWindow.appendChild(content);
        processingWindow.appendChild(cancelBtn);
        document.body.appendChild(processingWindow);
        // 实际调用API处理，传递生成类型
        handlePromptSubmit(text, prompt, images);
    }
    async function handlePromptSubmit(text, prompt, images = []) {
        console.log('Selected text:', text);
        console.log('User prompt:', prompt);
        console.log('Images:', images.length);
        try {
            // 组合完整的提示词，包含生成类型信息
            let fullPrompt = '';
            if (text && prompt) {
                fullPrompt = `当前用户选择的内容是###${text}###，\n\n当前用户的需求是###${prompt}###`;
            } else if (prompt) {
                fullPrompt = `--- 用户需求 ---\n当前用户的需求是###${prompt}###`;
            }
            // 准备POST数据
            const formData = new FormData();
            const selectedType = document.querySelector('.generation-type-option.selected');
            const generationType = selectedType ? selectedType.dataset.value : 'auto';
            formData.append('prompt', fullPrompt);
            formData.append('currentUrl', currentUrl);
            formData.append('generationType', generationType);
            // 添加图片数据
            if (images && images.length > 0) {
                images.forEach((imageData, index) => {
                    // 将 base64 转换为 blob
                    const base64Data = imageData.base64.split(',')[1];
                    const byteCharacters = atob(base64Data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: imageData.type });
                    formData.append('images', blob, imageData.name);
                });
            }

            // 获取当前用户名
            const userCacheKey = 'feishu_user_name';
            const userName = localStorage.getItem(userCacheKey);
            if (userName) {
                formData.append('userName', userName);
            }

            // 发送API请求
            const response = await fetch(API_URL, {
                method: 'POST',
                body: formData // 不设置 Content-Type，让浏览器自动设置包含 boundary
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.text();
            // 隐藏处理窗口
            hideProcessingWindow();
            // 处理响应结果
            if (result && (result.startsWith('http://') || result.startsWith('https://'))) {
                window.open(result, '_blank');
            } else {
                try {
                    const jsonResult = JSON.parse(result);
                    if (jsonResult.messageType == 'URL') {
                        window.open(jsonResult.message, '_blank');
                    } else {
                        // copyToClipboard(result);
                        showNotification(jsonResult.message);
                    }
                } catch (e) {
                    copyToClipboard(result);
                    showNotification('AI 响应已复制到剪贴板！');
                }
            }
        } catch (error) {
            console.error('API call failed:', error);
            showNotification('调用 AI 接口失败，请重试');
            hideProcessingWindow();
        }
    }

    // 处理图片粘贴 - 修改为显示更小的图片
    function handleImagePaste(file, imageDisplayArea) {
        const reader = new FileReader();

        reader.onload = function (e) {
            const base64Image = e.target.result;

            // 确保图片显示区域可见
            if (imageDisplayArea.children.length === 0) {
                imageDisplayArea.style.minHeight = '60px'; // 减小高度
                imageDisplayArea.style.padding = '8px';
                imageDisplayArea.style.background = 'rgba(255,255,255,0.03)';
                imageDisplayArea.style.border = '1px dashed rgba(255,255,255,0.2)';
            }

            // 创建图片容器 - 大幅缩小尺寸
            const imageContainer = document.createElement('div');
            imageContainer.style.cssText = `
            position: relative;
            display: inline-block;
            border-radius: 8px;
            overflow: visible;
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
            border: 1px solid rgba(102, 126, 234, 0.4);
            background: rgba(255,255,255,0.1);
            width: 40px;
            height: 40px;
            margin: 2px;
        `;

            // 创建图片元素 - 更小尺寸
            const img = document.createElement('img');
            img.src = base64Image;
            img.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            border-radius: 6px;
        `;

            // 创建删除按钮 - 相应缩小
            const deleteBtn = document.createElement('div');
            deleteBtn.innerHTML = '×';
            deleteBtn.style.cssText = `
            position: absolute;
            top: -6px;
            right: -6px;
            width: 16px;
            height: 16px;
            background: #ff4757;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            box-shadow: 0 1px 4px rgba(255, 71, 87, 0.4);
            transition: all 0.2s ease;
            z-index: 10;
            border: 1px solid white;
            line-height: 1;
        `;

            deleteBtn.addEventListener('mouseenter', function () {
                this.style.background = '#ff3742';
                this.style.transform = 'scale(1.1)';
                this.style.boxShadow = '0 2px 6px rgba(255, 71, 87, 0.6)';
            });

            deleteBtn.addEventListener('mouseleave', function () {
                this.style.background = '#ff4757';
                this.style.transform = 'scale(1)';
                this.style.boxShadow = '0 1px 4px rgba(255, 71, 87, 0.4)';
            });

            deleteBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                imageContainer.remove();

                // 如果没有图片了，隐藏图片显示区域
                if (imageDisplayArea.children.length === 0) {
                    imageDisplayArea.style.minHeight = '0';
                    imageDisplayArea.style.padding = '0';
                    imageDisplayArea.style.background = 'transparent';
                    imageDisplayArea.style.border = 'none';
                }
            });

            imageContainer.addEventListener('mouseleave', function () {
                clearTimeout(previewTimeout);
                hideImagePreview();
            });

            // 设置图片的 data 属性存储 base64 数据
            imageContainer.setAttribute('data-image-base64', base64Image);
            imageContainer.setAttribute('data-image-type', file.type);
            imageContainer.setAttribute('data-image-name', file.name || 'pasted-image.png');

            // 组装图片容器
            imageContainer.appendChild(img);
            imageContainer.appendChild(deleteBtn);

            // 添加到图片显示区域
            imageDisplayArea.appendChild(imageContainer);

        };

        reader.readAsDataURL(file);
    }


    // 获取输入内容 - 修改为从外侧图片区域获取图片
    function getInputContent(inputElement) {
        const result = {
            text: '',
            images: []
        };

        // 获取纯文本内容
        const textContent = inputElement.textContent || inputElement.innerText || '';
        // 过滤掉占位符文本
        if (textContent && textContent !== '请输入您的需求，或直接粘贴图片...') {
            result.text = textContent.trim();
        }

        // 从图片显示区域获取图片
        const imageDisplayArea = document.getElementById('image-display-area');
        if (imageDisplayArea) {
            const imageContainers = imageDisplayArea.querySelectorAll('[data-image-base64]');
            console.log(`Found ${imageContainers.length} image containers`);

            imageContainers.forEach((container, index) => {
                const base64 = container.getAttribute('data-image-base64');
                const type = container.getAttribute('data-image-type');
                const name = container.getAttribute('data-image-name');

                if (base64) {
                    result.images.push({
                        base64: base64,
                        type: type || 'image/png',
                        name: name || `image_${index}.png`
                    });
                    console.log(`Image ${index}: ${name}, type: ${type}`);
                }
            });
        }

        console.log('Final input content:', { textLength: result.text.length, imageCount: result.images.length });
        return result;
    }


    // 隐藏处理窗口
    function hideProcessingWindow() {
        if (processingWindow) {
            processingWindow.style.opacity = '0';
            processingWindow.style.transform = 'translateY(-20px)';
            processingWindow.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

            setTimeout(() => {
                if (processingWindow) {
                    processingWindow.remove();
                    processingWindow = null;
                }
            }, 300);
        }
        aiDismissed = true; // 标记AI被主动关闭
    }

    // 调整输入框位置
    function adjustInputBoxPosition() {
        if (!inputBox) return;

        const rect = inputBox.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = parseInt(inputBox.style.left);
        let top = parseInt(inputBox.style.top);

        if (rect.right > viewportWidth - 20) {
            left = viewportWidth - rect.width - 20;
        }

        if (left < 20) {
            left = 20;
        }

        if (rect.bottom > viewportHeight - 20) {
            top = top - rect.height - 60;
        }

        if (top < 20) {
            top = 20;
        }

        inputBox.style.left = left + 'px';
        inputBox.style.top = top + 'px';
    }

    // 隐藏输入框
    function hideInputBox(animate = false) {
        if (inputBox) {
            if (animate) {
                inputBox.style.transform = 'scale(0.2) translate(50%, -50%)';
                inputBox.style.opacity = '0';
                inputBox.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)';

                setTimeout(() => {
                    if (inputBox) {
                        inputBox.remove();
                        inputBox = null;
                    }
                }, 100);
            } else {
                inputBox.remove();
                inputBox = null;
            }
        }
        inputBoxVisible = false;
        aiDismissed = true; // 标记AI被主动关闭

        // 清除选择
        /*
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            selection.removeAllRanges();
        }
        */
    }


    // 显示通知
    function showNotification(text) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, rgba(0,0,0,0.8), rgba(0,0,0,0.9));
            backdrop-filter: blur(10px);
            color: white;
            padding: 12px 20px;
            border-radius: 12px;
            z-index: 10002;
            font-size: 14px;
            border: 1px solid rgba(255,255,255,0.1);
            animation: slideInRight 0.3s ease-out;
            max-width: 300px;
            word-wrap: break-word;
        `;
        notification.textContent = text;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            notification.style.transform = 'translateX(20px)';
            notification.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // 复制到剪贴板
    function copyToClipboard(text) {
        // 尝试多种复制方法
        try {
            // 方法1: 优先使用 Tampermonkey API
            if (typeof GM_setClipboard !== 'undefined') {
                GM_setClipboard(text);
                console.log('Text copied to clipboard via GM API');
                return;
            }

        } catch (err) {
            console.error('Copy failed:', err);
            fallbackCopyToClipboard(text);
        }
    }

    // 传统复制方法
    function fallbackCopyToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();

        try {
            document.execCommand('copy');
            console.log('Text copied to clipboard via fallback method');
        } catch (err) {
            console.error('Fallback copy failed:', err);
        }

        document.body.removeChild(textArea);
    }

    // 处理获取到的用户名的函数
    function handleUserName(userName, userInfo) {
        // 存储到本地存储
        localStorage.setItem('feishu_user_name', userName);
        localStorage.setItem('feishu_user_info', JSON.stringify(userInfo));
    }

    function cleanText(text) {
        if (!text) return '';

        return text
            // 去除零宽空格 (ZWSP) - Unicode U+200B
            .replace(/\u200B/g, '')
            // 去除零宽非断行空格 (ZWNBSP) - Unicode U+FEFF
            .replace(/\uFEFF/g, '')
            // 去除零宽连字符 (ZWJ) - Unicode U+200D
            .replace(/\u200D/g, '')
            // 去除零宽非连字符 (ZWNJ) - Unicode U+200C
            .replace(/\u200C/g, '')
            // 去除左到右标记 (LRM) - Unicode U+200E
            .replace(/\u200E/g, '')
            // 去除右到左标记 (RLM) - Unicode U+200F
            .replace(/\u200F/g, '')
            // 去除其他常见的不可见字符
            .replace(/[\u200A\u2009\u2008\u2007\u2006\u2005\u2004\u2003\u2002\u2001\u2000]/g, ' ')
            .trim();
    }
    /**
     * 暴力全局滚动器
     * @param {Object} options - 配置选项
     * @returns {Object} 控制对象
     */
    function createBruteForceScroller(options = {}) {
        // 默认配置
        const config = {
            step: 20,                    // 每次滚动的像素
            interval: 25,                // 滚动间隔(毫秒)
            scrollDuration: 20,         // 连续滚动次数后暂停
            pauseDuration: 200,          // 暂停时间(毫秒)
            maxNoScrollCount: 5,        // 连续无滚动次数阈值
            autoStop: true,              // 是否自动停止
            onStart: null,               // 开始回调
            onStop: null,                // 停止回调
            onAutoStop: null,            // 自动停止回调
            onProgress: null,            // 进度回调 (scrollCount, noScrollCount)
            ...options
        };

        // 状态变量
        let active = false;
        let timer = null;
        let scrollCount = 0;
        let noScrollCount = 0;

        /**
         * 暴力滚动核心方法
         */
        function bruteForceScroll() {
            let hasScrolled = false;

            // 滚动所有可滚动元素
            document.querySelectorAll('*').forEach(el => {
                try {
                    if (el.scrollHeight > el.clientHeight) {
                        const oldScrollTop = el.scrollTop;
                        el.scrollTop += config.step;

                        if (el.scrollTop > oldScrollTop) {
                            hasScrolled = true;
                        }
                    }
                } catch (e) { }
            });

            // 滚动页面
            const oldPageScrollY = window.pageYOffset || document.documentElement.scrollTop;
            window.scrollBy(0, config.step);
            const newPageScrollY = window.pageYOffset || document.documentElement.scrollTop;

            if (newPageScrollY > oldPageScrollY) {
                hasScrolled = true;
            }

            // 检查是否到达底部
            if (!hasScrolled) {
                noScrollCount++;

                if (config.autoStop && noScrollCount >= config.maxNoScrollCount) {
                    stop(true); // 自动停止
                    return;
                }
            } else {
                noScrollCount = 0;
            }

            scrollCount++;

            // 进度回调
            if (config.onProgress) {
                config.onProgress(scrollCount, noScrollCount);
            }

            // 检查是否需要暂停
            if (scrollCount >= config.scrollDuration) {
                clearInterval(timer);
                scrollCount = 0;

                setTimeout(() => {
                    if (active) {
                        timer = setInterval(bruteForceScroll, config.interval);
                    }
                }, config.pauseDuration);
            }
        }

        /**
         * 开始滚动
         */
        function start() {
            if (active) return false;

            active = true;
            scrollCount = 0;
            noScrollCount = 0;
            timer = setInterval(bruteForceScroll, config.interval);

            if (config.onStart) {
                config.onStart();
            }

            return true;
        }

        /**
         * 停止滚动
         * @param {boolean} isAutoStop - 是否为自动停止
         */
        function stop(isAutoStop = false) {
            if (!active) return false;

            clearInterval(timer);
            active = false;
            scrollCount = 0;
            noScrollCount = 0;
            timer = null;

            if (isAutoStop && config.onAutoStop) {
                config.onAutoStop();
            }

            if (config.onStop) {
                config.onStop(isAutoStop);
            }

            return true;
        }

        /**
         * 切换滚动状态
         */
        function toggle() {
            return active ? stop() : start();
        }

        /**
         * 获取当前状态
         */
        function getStatus() {
            return {
                active,
                scrollCount,
                noScrollCount
            };
        }

        // 返回控制对象
        return {
            start,
            stop,
            toggle,
            getStatus,
            isActive: () => active
        };
    }

    // 全局事件监听
    document.addEventListener('click', function (e) {
        if (aiButton && !aiButton.contains(e.target)) {
            hideAiButton();
        }
        if (inputBox && !inputBox.contains(e.target) && inputBoxVisible &&
            floatingAiButton && !floatingAiButton.contains(e.target) &&
            mdButton && !mdButton.contains(e.target)) {
            hideInputBox();
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (inputBoxVisible) {
                hideInputBox();
            } else if (aiButtonVisible) {
                hideAiButton();
            }
            if (processingWindow) {
                hideProcessingWindow();
            }
        }
    });
})();
