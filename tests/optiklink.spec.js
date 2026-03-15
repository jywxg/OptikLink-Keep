// tests/optiklink.spec.js
const { test, chromium } = require('@playwright/test');
const https = require('https');

const [email, password] = (process.env.DISCORD_ACCOUNT || ',').split(',');
const [panelUser, panelPass] = (process.env.PANEL_ACCOUNT || ',').split(',');
const [TG_CHAT_ID, TG_TOKEN] = (process.env.TG_BOT || ',').split(',');

const TIMEOUT = 60000;

function nowStr() {
    return new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).replace(/\//g, '-');
}

function sendTG(result) {
    return new Promise((resolve) => {
        if (!TG_CHAT_ID || !TG_TOKEN) {
            console.log('⚠️ TG_BOT 未配置，跳过推送');
            return resolve();
        }

        const msg = [
            `🎮 OptikLink 保活通知`,
            `🕐 运行时间: ${nowStr()}`,
            `🖥 服务器: 🇸🇬 OptikLink-SG`,
            `📊 执行结果: ${result}`,
        ].join('\n');

        const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: msg });
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TG_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }, (res) => {
            if (res.statusCode === 200) {
                console.log('📨 TG 推送成功');
            } else {
                console.log(`⚠️ TG 推送失败：HTTP ${res.statusCode}`);
            }
            resolve();
        });

        req.on('error', (e) => {
            console.log(`⚠️ TG 推送异常：${e.message}`);
            resolve();
        });

        req.setTimeout(15000, () => {
            console.log('⚠️ TG 推送超时');
            req.destroy();
            resolve();
        });

        req.write(body);
        req.end();
    });
}

async function handleOAuthPage(page) {
    console.log(`  📄 当前 URL: ${page.url()}`);
    await page.waitForTimeout(5000);

    const selectors = [
        'button:has-text("Authorize")',
        'button:has-text("授权")',
        'div[class*="footer"] button',
        'button[class*="primary"]',
        'button[type="submit"]',
    ];

    for (let i = 0; i < 8; i++) {
        console.log(`  🔄 第 ${i + 1} 次尝试，URL: ${page.url()}`);

        if (!page.url().includes('discord.com')) {
            console.log('  ✅ 已离开 Discord');
            return;
        }

        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);

        for (const selector of selectors) {
            try {
                const btn = page.locator(selector).last();
                await btn.waitFor({ state: 'visible', timeout: 3000 });

                const text = (await btn.innerText()).trim();
                console.log(`  🔘 找到按钮: "${text}" (${selector})`);

                if (
                    text.includes('取消') ||
                    text.toLowerCase().includes('cancel') ||
                    text.toLowerCase().includes('deny')
                ) continue;

                const disabled = await btn.isDisabled();
                if (disabled) {
                    console.log('  ⏳ 按钮 disabled，等待...');
                    await page.waitForTimeout(2000);
                    break;
                }

                await btn.click();
                console.log(`  ✅ 已点击: "${text}"`);
                await page.waitForTimeout(3000);

                if (!page.url().includes('discord.com')) {
                    console.log('  ✅ 授权成功，已跳转');
                    return;
                }
                break;
            } catch { continue; }
        }

        await page.waitForTimeout(3000);
    }

    console.log(`  ⚠️ handleOAuthPage 结束，URL: ${page.url()}`);
}

test('OptikLink 保活', async () => {
    const proxyUrl = '';

    if (!email || !password) {
        throw new Error('❌ 缺少账号配置，格式: DISCORD_ACCOUNT=email,password');
    }

    let proxyConfig = undefined;
    if (process.env.GOST_PROXY) {
        try {
            const http = require('http');
            await new Promise((resolve, reject) => {
                const req = http.request(
                    { host: '127.0.0.1', port: 8080, path: '/', method: 'GET', timeout: 3000 },
                    () => resolve()
                );
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
                req.end();
            });
            proxyConfig = { server: process.env.GOST_PROXY };
            console.log('🛡️ 本地代理连通，使用 GOST 转发');
        } catch {
            console.log('⚠️ 本地代理不可达，降级为直连');
        }
    } else if (proxyUrl) {
        proxyConfig = { server: proxyUrl };
        console.log(`🛡️ 使用代理: ${proxyUrl.replace(/:\/\/.*@/, '://***@')}`);
    }

    console.log('🔧 启动浏览器...');
    const browser = await chromium.launch({
        headless: true,
        proxy: proxyConfig,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT);

    await context.addInitScript(() => {
        if (!location.hostname.includes('optiklink.net')) return;

        const AD_DOMAINS = [
            'tzegilo.com', 'alwingulla.com', 'auqot.com', 'jmosl.com', '094kk.com',
            'optiklink.com', 'tmll7.com', 'oundhertobeconsist.org',
            'pagead2.googlesyndication.com', 'googlesyndication.com',
            'googletagservices.com', 'doubleclick.net',
            'adsbygoogle', 'popads', 'popcash', 'clickadu', 'tsyndicate',
            'trafficjunky', 'afu.php',
        ];
        const isAd = (url) => url && AD_DOMAINS.some(d => url.includes(d));

        const _createElement = document.createElement.bind(document);
        document.createElement = function (tag) {
            const el = _createElement(tag);
            if (tag.toLowerCase() === 'script') {
                const _desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
                Object.defineProperty(el, 'src', {
                    set(val) { if (!isAd(val)) _desc.set.call(this, val); },
                    get() { return _desc.get.call(this); },
                });
            }
            return el;
        };

        const _write = document.write.bind(document);
        document.write = function (html) { if (!isAd(html)) return _write(html); };

        const _appendChild = Element.prototype.appendChild;
        Element.prototype.appendChild = function (node) {
            if (node?.tagName === 'SCRIPT' && isAd(node.src)) return node;
            return _appendChild.call(this, node);
        };

        const _insertBefore = Element.prototype.insertBefore;
        Element.prototype.insertBefore = function (node, ref) {
            if (node?.tagName === 'SCRIPT' && isAd(node.src)) return node;
            return _insertBefore.call(this, node, ref);
        };

        const _fetch = window.fetch;
        window.fetch = function (url, ...args) {
            if (isAd(typeof url === 'string' ? url : url?.url))
                return Promise.reject(new Error('blocked'));
            return _fetch.call(this, url, ...args);
        };

        const _xhrOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...args) {
            if (isAd(url)) return;
            return _xhrOpen.call(this, method, url, ...args);
        };

        const _open = window.open.bind(window);
        window.open = function (url, ...args) {
            if (!url) return null;
            if (url.startsWith('/') || url.includes('optiklink.net')) return _open(url, ...args);
            return null;
        };

        const _addEL = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, fn, opts) {
            if (type === 'click' && (this === window || this === document)) {
                const src = fn?.toString() || '';
                if (/setTimeout\s*\(\s*\w\s*,\s*0\s*\)/.test(src)) return;
                if (/contextmenu.*localStorage|localStorage.*contextmenu/s.test(src)) return;
            }
            return _addEL.call(this, type, fn, opts);
        };

        Object.defineProperty(window, 'adsbygoogle', {
            get: () => ({ loaded: true, push: () => {} }),
            set: () => {},
            configurable: false,
        });
    });

    console.log('🚀 浏览器就绪！');
    console.log('🛡️ OptikLink 广告猎手启动');

    try {
        console.log('🌐 验证出口 IP...');
        try {
            const res = await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded' });
            const body = await res.text();
            const ip = JSON.parse(body).ip || body;
            const masked = ip.replace(/(\d+\.\d+\.\d+\.)\d+/, '$1xx');
            console.log(`✅ 出口 IP 确认：${masked}`);
        } catch {
            console.log('⚠️ IP 验证超时，跳过');
        }

        console.log('🔑 打开 OptikLink 登录页...');
        await page.goto('https://optiklink.com/auth', { waitUntil: 'domcontentloaded' });

        console.log('📤 点击 Login with Discord...');
        await page.click("a[href='login']");

        console.log('⏳ 等待跳转 Discord 登录页...');
        await page.waitForURL(/discord\.com\/login/, { timeout: TIMEOUT });

        console.log('✏️ 填写账号密码...');
        await page.fill('input[name="email"]', email);
        await page.fill('input[name="password"]', password);

        console.log('📤 提交登录请求...');
        await page.click('button[type="submit"]');
        await page.waitForTimeout(2000);

        if (/discord\.com\/login/.test(page.url())) {
            let err = '账密错误或触发了 2FA / 验证码';
            try { err = await page.locator('[class*="errorMessage"]').first().innerText(); } catch {}
            await sendTG(`❌ Discord 登录失败：${err}`);
            throw new Error(`❌ Discord 登录失败: ${err}`);
        }

        console.log('⏳ 等待 OAuth 授权...');
        try {
            await page.waitForURL(/discord\.com\/oauth2\/authorize/, { timeout: 6000 });
            console.log('🔍 进入 OAuth 授权页，处理中...');
            await page.waitForTimeout(2000);

            if (page.url().includes('discord.com')) {
                await handleOAuthPage(page);
            } else {
                console.log('✅ 已自动完成授权，无需手动点击');
            }

            await page.waitForURL(/optiklink\.net/, { timeout: 15000 });
            console.log(`✅ 已离开 Discord，当前：${page.url()}`);
        } catch {
            console.log(`✅ 静默授权或已跳转，当前：${page.url()}`);
        }

        console.log('⏳ 确认到达 OptikLink...');
        try {
            await page.waitForURL(/optiklink\.net/, { timeout: 30000 });
        } catch { /* 可能已经在页面 */ }

        if (!page.url().includes('optiklink.net')) {
            throw new Error(`❌ 未到达 OptikLink，当前 URL: ${page.url()}`);
        }
        console.log(`✅ 登录成功！当前：${page.url()}`);

        console.log('📤 点击 Login to Panel...');
        await page.click('a[data-target="#logintopanel"]');
        await page.waitForTimeout(2000);

        console.log('📤 点击 Panel Login...');
        const [panelPage] = await Promise.all([
            context.waitForEvent('page'),
            page.click('a[href="https://control.optiklink.net/auth/login"]'),
        ]);

        panelPage.setDefaultTimeout(TIMEOUT);
        console.log('⏳ 等待跳转控制台登录页...');
        await panelPage.waitForURL(/control\.optiklink\.net\/auth\/login/, { timeout: TIMEOUT });
        console.log(`✅ 已到达控制台登录页：${panelPage.url()}`);

        console.log('✏️ 填写控制台账号密码...');
        await panelPage.fill('input[name="username"]', panelUser);
        await panelPage.fill('input[name="password"]', panelPass);

        console.log('📤 提交控制台登录...');
        await panelPage.click('span.sc-1qu1gou-2:has-text("Login")');

        console.log('⏳ 确认到达控制台首页...');
        await panelPage.waitForURL(/control\.optiklink\.net\/$/, { timeout: TIMEOUT });
        console.log(`✅ 控制台登录成功！当前：${panelPage.url()}`);

        console.log('🔍 查找服务器 OptikLink-SG...');
        await panelPage.waitForTimeout(2000);

        const [serverPage] = await Promise.all([
            context.waitForEvent('page'),
            panelPage.click('p:has-text("[Paper] OptikLink-SG")'),
        ]);

        serverPage.setDefaultTimeout(TIMEOUT);
        await serverPage.waitForURL(/control\.optiklink\.net\/server\/28386fc6/, { timeout: TIMEOUT });
        console.log(`✅ 已到达服务器页面：${serverPage.url()}`);

        console.log('🔍 检查服务器状态...');
        await serverPage.waitForTimeout(3000);

        const statusText = await serverPage.locator('p.sc-168cvuh-1').innerText().catch(() => '');
        console.log(`📊 服务器状态：${statusText.trim()}`);

        if (statusText.toLowerCase().includes('running')) {
            console.log('🎉 保活成功！');
            await sendTG('✅ 保活成功！\n服务器状态：🚀 Running');
        } else if (statusText.toLowerCase().includes('offline')) {
            console.log('⚠️ 服务器离线，尝试启动...');
            await serverPage.click('button:has-text("Start")');
            console.log('📤 已点击 Start，持续监控状态...');

            let started = false;
            for (let i = 0; i < 24; i++) {
                await serverPage.waitForTimeout(5000);
                const s = await serverPage.locator('p.sc-168cvuh-1').innerText().catch(() => '');
                console.log(`  🔄 第 ${i + 1} 次检查，状态：${s.trim()}`);
                if (s.toLowerCase().includes('running')) {
                    started = true;
                    break;
                }
            }

            if (started) {
                console.log('✅ 服务器已成功启动！');
                await sendTG('🔄 Start 启动！\n服务器状态：🚀 Running');
            } else {
                console.log('❌ 等待超时，服务器未能启动');
                await sendTG('❌ Start 启动失败，等待超时\n服务器状态：Offline');
            }
        } else {
            console.log(`⚠️ 未知状态：${statusText.trim()}`);
            await sendTG(`⚠️ 状态未知\n服务器状态：${statusText.trim()}`);
        }

    } catch (e) {
        await sendTG(`❌ 脚本异常：${e.message}`);
        throw e;

    } finally {
        await browser.close();
    }
});
