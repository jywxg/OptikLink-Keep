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

function sendTG(result, serverName = 'OptikLink') {
    return new Promise((resolve) => {
        if (!TG_CHAT_ID || !TG_TOKEN) {
            console.log('⚠️ TG_BOT 未配置，跳过推送');
            return resolve();
        }

        const msg = [
            `🎮 OptikLink 保活通知`,
            `🕐 运行时间: ${nowStr()}`,
            `🖥 服务器: ${serverName}`,
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

// 处理 Discord 登录页（填账密）
async function handleDiscordLogin(page, email, password) {
    console.log('  ✏️ 填写 Discord 账号密码...');
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);

    console.log('  📤 提交 Discord 登录...');
    await page.click('button[type="submit"]');

    console.log('  ⏳ 等待离开 Discord 登录页...');
    try {
        await page.waitForURL(url => !url.toString().includes('discord.com/login'), { timeout: 15000 });
        console.log(`  ✅ 已离开登录页，当前：${page.url()}`);
    } catch {
        let err = '账密错误或触发了 2FA / 验证码';
        try { err = await page.locator('[class*="errorMessage"]').first().innerText(); } catch {}
        throw new Error(`❌ Discord 登录失败: ${err}`);
    }
}

// 处理 Discord OAuth 授权页（点击 Authorize）
async function handleOAuthPage(page) {
    console.log(`  📄 当前在 Discord OAuth 授权页面`);
    await page.waitForTimeout(2000);

    for (let i = 0; i < 5; i++) {
        const currentUrl = page.url();

        if (!currentUrl.includes('discord.com')) {
            console.log('  ✅ 已离开 Discord');
            return;
        }

        try {
            const btn = await page.waitForSelector('button.primary_a22cb0', { timeout: 3000 });
            const text = (await btn.innerText()).trim();
            console.log(`  🔘 当前按钮: "${text}"`);

            if (/scroll/i.test(text) || text.includes('滚动')) {
                console.log('  → 滚动条款到底部...');
                await page.evaluate(() => {
                    const s = document.querySelector('[class*="scroller"]')
                        || document.querySelector('[class*="scrollerBase"]')
                        || document.querySelector('[class*="content"]');
                    if (s) s.scrollTop = s.scrollHeight;
                    window.scrollTo(0, document.body.scrollHeight);
                });
                await page.waitForTimeout(1500);
                await btn.click();
                console.log('  ✅ 已点击（滚动后）');
                await page.waitForTimeout(1500);
            } else if (/authorize/i.test(text) || text.includes('授权')) {
                await btn.click();
                console.log('  ✅ 已点击授权按钮');
                await page.waitForTimeout(3000);
                return;
            } else {
                // 其他按钮（包括 disabled 状态）不点击，等待页面自动处理
                const disabled = await btn.isDisabled();
                console.log(`  ⏳ 按钮 "${text}" disabled=${disabled}，等待...`);
                await page.waitForTimeout(1500);
            }
        } catch {
            console.log('  ✨ 按钮未找到，等待自动跳转...');
            try {
                await page.waitForURL(url => !url.toString().includes('discord.com'), { timeout: 10000 });
                console.log('  ✅ 跳转成功');
            } catch {
                console.log('  ⏳ 跳转中，稍候...');
            }
            return;
        }
    }

    console.log(`  ⚠️ handleOAuthPage 结束，URL: ${page.url()}`);
}

test('OptikLink 保活', async ({ }, testInfo) => {
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
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT);
    let activePage = page;

    await page.addInitScript(() => {
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

        // 等待离开 /auth 页，判断实际落地位置
        // 三种情况：
        //   A. discord.com/login       → 没有 Discord 登录态，需填账密
        //   B. discord.com/oauth2/...  → 有登录态但需要点授权（或按钮是 Log In 说明又被踢回登录）
        //   C. optiklink.net           → 全程静默完成，直接成功
        console.log('⏳ 等待跳转目标页面...');
        await page.waitForURL(url => !url.toString().includes('optiklink.com/auth'), { timeout: TIMEOUT });

        const landedUrl = page.url();
        console.log(`📍 落地页：${landedUrl}`);

        if (landedUrl.includes('discord.com/login')) {
            // 情况A：直接落到登录页，填账密
            console.log('🔑 Discord 未登录，进入登录流程...');
            await handleDiscordLogin(page, email, password);
        } else if (landedUrl.includes('discord.com/oauth2')) {
            // 情况B：落到 OAuth 授权页，处理授权
            // 注意：OAuth 页上如果按钮是 "Log In" 说明登录态已失效，需要先登录
            console.log('🔍 落地 OAuth 授权页，检查登录状态...');
            await page.waitForTimeout(2000);

            // 检查按钮文字来判断是否需要先登录
            try {
                const btn = await page.waitForSelector('button.primary_a22cb0', { timeout: 5000 });
                const btnText = (await btn.innerText()).trim();
                console.log(`  🔘 OAuth 页按钮："${btnText}"`);

                if (/log\s*in/i.test(btnText) || btnText.includes('登录')) {
                    // 按钮是 Log In，说明没有登录态，点击后会跳转到登录页
                    console.log('  🔑 OAuth 页需要先登录，跳转 Discord 登录页...');
                    await btn.click();
                    await page.waitForURL(/discord\.com\/login/, { timeout: 10000 });
                    await handleDiscordLogin(page, email, password);
                } else {
                    // 按钮是 Authorize 或其他，走正常 OAuth 流程
                    await handleOAuthPage(page);
                }
            } catch {
                // 找不到按钮，可能已自动跳转
                console.log('  ✨ OAuth 页无需操作，已自动跳转');
            }
        } else if (landedUrl.includes('optiklink.net')) {
            // 情况C：直接到达 OptikLink，全程静默完成
            console.log('✅ Discord session 完全有效，已静默完成授权');
        } else {
            console.log(`⚠️ 未知落地页：${landedUrl}，尝试继续...`);
        }

        // 处理登录/授权后可能还停在 Discord 的情况（如 OAuth 授权页还未跳走）
        if (page.url().includes('discord.com/oauth2')) {
            console.log('🔍 仍在 OAuth 授权页，继续处理...');
            await handleOAuthPage(page);
        }

        // 等待最终到达 OptikLink
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
            page.context().waitForEvent('page'),
            page.click('a[href="https://control.optiklink.net/auth/login"]'),
        ]);

        panelPage.setDefaultTimeout(TIMEOUT);
        activePage = panelPage;
        console.log('⏳ 等待跳转控制台登录页...');
        await panelPage.waitForURL(/control\.optiklink\.net\/auth\/login/, { timeout: TIMEOUT });
        console.log(`✅ 已到达控制台登录页：${panelPage.url()}`);

        console.log('✏️ 填写控制台账号密码...');
        await panelPage.fill('input[name="username"]', panelUser);
        await panelPage.fill('input[name="password"]', panelPass);

        console.log('⏳ 等待 reCAPTCHA 加载...');
        await panelPage.waitForFunction(() => {
            return typeof grecaptcha !== 'undefined' && grecaptcha.getResponse !== undefined;
        }, { timeout: 15000 }).catch(() => console.log('  ℹ️ reCAPTCHA 未检测到，继续...'));
        await panelPage.waitForTimeout(2000);

        console.log('📤 提交控制台登录...');
        await panelPage.click('button[type="submit"]');

        console.log('⏳ 确认到达控制台首页...');
        await panelPage.waitForURL(url => !url.toString().includes('/auth/login'), { timeout: TIMEOUT });
        console.log(`✅ 控制台登录成功！当前：${panelPage.url()}`);

        await panelPage.waitForTimeout(2000);

        console.log('🔍 查找服务器...');
        await panelPage.waitForTimeout(2000);

        const serverInfo = await panelPage.evaluate(() => {
            const card = document.querySelector('a[href*="/server/"]');
            if (!card) return null;
            const href = card.getAttribute('href');
            const id = href.replace('/server/', '').trim();
            const nameEl = card.querySelector('p.sc-1ibsw91-5');
            const name = nameEl ? nameEl.innerText.trim() : '';
            return { id, name };
        });

        if (!serverInfo) throw new Error('❌ 未找到服务器卡片');
        console.log(`✅ 找到服务器：${serverInfo.name} (${serverInfo.id})`);

        await panelPage.goto(`https://control.optiklink.net/server/${serverInfo.id}`, { waitUntil: 'domcontentloaded' });
        console.log(`✅ 已到达服务器页面：${panelPage.url()}`);

        const serverPage = panelPage;

        console.log('🔍 检查服务器状态...');
        await serverPage.waitForTimeout(3000);

        const statusText = await serverPage.locator('p.sc-168cvuh-1').innerText().catch(() => '');
        console.log(`💻 服务器状态：${statusText.trim()}`);

        if (statusText.toLowerCase().includes('running')) {
            console.log('🎉 保活成功！');
            await sendTG('✅ 保活成功！\n💻 服务器状态：🚀 Running', serverInfo.name);
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
                await sendTG('🔄 Start 启动！\n💻 服务器状态：🚀 Running', serverInfo.name);
            } else {
                console.log('❌ 等待超时，服务器未能启动');
                await sendTG('❌ Start 启动失败，等待超时\n💻 服务器状态：💤 Offline', serverInfo.name);
            }
        } else {
            console.log(`⚠️ 未知状态：${statusText.trim()}`);
            await sendTG(`⚠️ 状态未知\n💻 服务器状态：❓ ${statusText.trim()}`, serverInfo.name);
        }

    } catch (e) {
        try {
            const screenshotPath = testInfo.outputPath('failure.png');
            await activePage.screenshot({ path: screenshotPath, fullPage: true });
            await testInfo.attach('failure', { path: screenshotPath, contentType: 'image/png' });
            console.log('📸 失败截图已保存');
        } catch { /* 截图失败不影响主流程 */ }
        await sendTG(`❌ 脚本异常：${e.message}`);
        throw e;

    } finally {
        await browser.close();
    }
});
