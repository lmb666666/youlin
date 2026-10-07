import type { AppConfig } from './types'

/**
 * 申请页（GET /apply，DESIGN §4.3）：
 * 服务端渲染的自包含 HTML（无外部资源，除可选的 Turnstile 脚本），
 * 文案由 site.* / apply.* 配置驱动；提交走 fetch POST /apply（JSON）。
 */

const DEFAULT_INTRO = '欢迎交换友链！提交后会尽快审核。'
const DEFAULT_SUCCESS = '申请已提交，等待站长审核。感谢你的来访！'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 嵌入 <script> 的 JSON：转义 < 防 </script> 逃逸 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** CSS 颜色值白名单过滤（防样式块注入） */
function cssColor(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9#%.,()\s/-]/g, '')
  return cleaned.length <= 64 ? cleaned : ''
}

interface FieldSpec {
  name: string
  label: string
  type: 'text' | 'url' | 'textarea'
  placeholder: string
  hint?: string
}

const FIELDS: FieldSpec[] = [
  { name: 'siteName', label: '站点名称', type: 'text', placeholder: '我的博客' },
  { name: 'link', label: '站点链接', type: 'url', placeholder: 'https://example.com/' },
  { name: 'author', label: '站长昵称', type: 'text', placeholder: '昵称或笔名' },
  { name: 'avatar', label: '头像链接', type: 'url', placeholder: 'https://…/avatar.webp' },
  { name: 'feed', label: 'RSS 订阅地址', type: 'url', placeholder: 'https://example.com/atom.xml', hint: '填写后参与朋友圈' },
  { name: 'desc', label: '站点简介', type: 'textarea', placeholder: '一两句话介绍你的站点' },
  { name: 'contact', label: '联系方式', type: 'text', placeholder: '邮箱 / Telegram（仅站长可见）' },
  { name: 'note', label: '备注', type: 'textarea', placeholder: '想说的话（可选）' },
]

const TOP_LINKS = ['siteName', 'link', 'author', 'avatar', 'feed']

export function renderApplyPage(cfg: AppConfig): string {
  const siteName = esc(cfg.site.name || '我的博客')
  const intro = esc(cfg.apply.intro || DEFAULT_INTRO)
  const success = cfg.apply.successMessage || DEFAULT_SUCCESS
  const required = new Set(cfg.apply.requiredFields)
  const disabled = !cfg.apply.enabled
  const turnstileEnabled = cfg.apply.turnstile
  const siteKey = cfg.apply.turnstileSiteKey
  const turnstileReady = turnstileEnabled && siteKey !== ''
  const siteUrl = cfg.site.url || ''
  const logo = cfg.site.logo
  const accent = cssColor(cfg.ui.accentColor)

  const fieldHtml = FIELDS.map((f) => {
    const isRequired = required.has(f.name)
    const star = isRequired ? ' <em>*</em>' : ''
    const hint = f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''
    const control =
      f.type === 'textarea'
        ? `<textarea id="f-${f.name}" name="${f.name}" rows="3" placeholder="${esc(f.placeholder)}"${isRequired ? ' required' : ''}></textarea>`
        : `<input id="f-${f.name}" name="${f.name}" type="${f.type}" placeholder="${esc(f.placeholder)}"${isRequired ? ' required' : ''} autocomplete="off">`
    const colClass = TOP_LINKS.includes(f.name) ? '' : ' class="wide"'
    return `<label${colClass} for="f-${f.name}"><span>${esc(f.label)}${star}</span>${control}<span class="err" data-err="${f.name}"></span>${hint}</label>`
  }).join('\n')

  const turnstileBlock = turnstileReady
    ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-theme="auto"></div>`
    : turnstileEnabled
      ? `<p class="notice">人机验证未配置，暂无法提交。</p>`
      : ''

  const body = disabled
    ? `<p class="notice">友链申请通道当前未开放。</p>`
    : `<form id="apply-form" novalidate>
${fieldHtml}
${turnstileBlock}
<button type="submit" id="submit-btn">提交申请</button>
<div id="result" class="result" hidden></div>
</form>`

  const turnstileScript = turnstileEnabled
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>友链申请 · ${siteName}</title>
${turnstileScript}
<style>
:root{${accent ? `--accent:${accent};` : ''}--bg:#f6f7f9;--card:#fff;--text:#18181b;--muted:#71717a;--border:#e4e4e7;--accent:#18181b;--accent-fg:#fafafa;--err:#dc2626;--ok:#16a34a}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--card:#18181b;--text:#fafafa;--muted:#a1a1aa;--border:#27272a;--accent:#fafafa;--accent-fg:#18181b;--err:#f87171;--ok:#4ade80}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 ui-sans-serif,system-ui,"PingFang SC","Microsoft YaHei",sans-serif;display:flex;justify-content:center;padding:32px 16px}
.card{width:100%;max-width:560px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px}
.logo{width:56px;height:56px;border-radius:12px;object-fit:cover;display:block;margin-bottom:12px}
h1{font-size:20px;margin:0 0 6px}
.intro{color:var(--muted);margin:0 0 20px}
form{display:grid;grid-template-columns:1fr 1fr;gap:14px}
label{display:flex;flex-direction:column;gap:6px;font-size:13px}
label.wide,form>.cf-turnstile,form>.notice,button,.result{grid-column:1/-1}
label span{color:var(--muted)}
label em{color:var(--err);font-style:normal}
input,textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--border);border-radius:8px;padding:8px 10px;width:100%}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
.err{color:var(--err);font-size:12px}
.hint{margin:0;color:var(--muted);font-size:12px}
button{font:inherit;font-weight:600;background:var(--accent);color:var(--accent-fg);border:0;border-radius:8px;padding:10px 14px;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.notice{color:var(--muted);grid-column:1/-1}
.result{border-radius:8px;padding:10px 12px;font-size:14px}
.result.ok{background:color-mix(in oklab,var(--ok) 12%,transparent);color:var(--ok)}
.result.bad{background:color-mix(in oklab,var(--err) 12%,transparent);color:var(--err)}
.foot{margin-top:18px;font-size:13px;color:var(--muted)}
.foot a{color:inherit}
</style>
</head>
<body>
<main class="card">
${logo ? `<img class="logo" src="${esc(logo)}" alt="">` : ''}
<h1>申请友链 · ${siteName}</h1>
<p class="intro">${intro}</p>
${body}
${siteUrl ? `<p class="foot">← 返回 <a href="${esc(siteUrl)}">${siteName}</a></p>` : ''}
</main>
<script>
(function(){
  var form = document.getElementById('apply-form');
  if (!form) return;
  var btn = document.getElementById('submit-btn');
  var result = document.getElementById('result');
  function show(kind, text){ result.className = 'result ' + kind; result.textContent = text; result.hidden = false; result.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  var FIELD_LABELS = ${jsonForScript(Object.fromEntries(FIELDS.map((f) => [f.name, f.label])))};
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    // 客户端必填预检：空表单不发请求
    var firstEmpty = null;
    form.querySelectorAll('[required]').forEach(function(el){
      var empty = (el.value || '').trim() === '';
      el.closest('label').querySelector('.err').textContent = empty ? '必填' : '';
      if (empty && !firstEmpty) firstEmpty = el;
    });
    if (firstEmpty) {
      show('bad', '请填写带 * 的必填项');
      firstEmpty.focus();
      return;
    }
    var data = {};
    new FormData(form).forEach(function(v, k){ if (typeof v === 'string' && v.trim() !== '') data[k] = v.trim(); });
    var ts = document.querySelector('[name="cf-turnstile-response"]');
    if (ts && ts.value) data.turnstileToken = ts.value;
    btn.disabled = true; result.hidden = true;
    try {
      var res = await fetch('/apply', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      var payload = await res.json().catch(function(){ return null; });
      if (res.ok) {
        show('ok', ${jsonForScript(success)} + (payload && payload.backlink && payload.backlink.ok ? '（已检测到反链，谢谢！）' : ''));
        form.querySelectorAll('input,textarea').forEach(function(el){ el.value = ''; });
      } else {
        var msg = (payload && payload.error && payload.error.message) || ('提交失败（' + res.status + '）');
        var details = payload && payload.error && payload.error.details;
        if (details) {
          Object.keys(details).forEach(function(k){
            var el = document.querySelector('[data-err="' + k + '"]');
            if (el) el.textContent = details[k];
          });
        }
        show('bad', msg);
      }
    } catch (err) {
      show('bad', '网络错误，请稍后重试');
    } finally {
      btn.disabled = false;
      if (window.turnstile && window.turnstile.reset) { try { window.turnstile.reset(); } catch (e) {} }
    }
  });
})();
</script>
</body>
</html>`
}
