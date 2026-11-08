import type { AppConfig } from './types'

/**
 * 申请页（GET /apply）：
 * 服务端渲染的自包含 HTML（无外部资源，除可选的 Turnstile 脚本），
 * 文案由 site.* / apply.* 配置驱动；提交走 fetch POST /apply（JSON）。
 */

const DEFAULT_INTRO = '欢迎交换友链！提交后会尽快审核。'
const DEFAULT_SUCCESS = '申请已提交，等待站长审核。感谢你的来访！'
const DEFAULT_ACCENT = '#d97757'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 嵌入 <script> 的 JSON：转义 < 防 </script> 逃逸 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function luminance(hex: string): number {
  const raw = hex.slice(1)
  const channels = [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 强调色只接受 #rrggbb；前景色取对比度更高的一侧。 */
function accentPair(value: string): { bg: string; fg: string } {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return { bg: DEFAULT_ACCENT, fg: '#1f1e1d' }
  const bg = `#${match[1]!.toLowerCase()}`
  const fg = contrast(bg, '#1f1e1d') >= contrast(bg, '#fffaf5') ? '#1f1e1d' : '#fffaf5'
  return { bg, fg }
}

/** 只允许 http(s) 跳转；裸域名补 https，javascript:/data: 等协议直接丢弃 */
function safeHttpUrl(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : ''
  } catch {
    return ''
  }
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
  const intro = esc(cfg.apply.intro || cfg.site.description || DEFAULT_INTRO)
  const success = cfg.apply.successMessage || DEFAULT_SUCCESS
  const required = new Set([...cfg.apply.requiredFields, 'link'])
  const disabled = !cfg.apply.enabled
  const turnstileEnabled = cfg.apply.turnstile
  const siteKey = cfg.apply.turnstileSiteKey
  const turnstileReady = turnstileEnabled && siteKey !== ''
  // Turnstile 开着但没有 siteKey 时页面根本拿不到 token，不要渲染一个必然失败的提交表单
  const formUnavailable = disabled || (turnstileEnabled && !turnstileReady)
  const siteUrl = safeHttpUrl(cfg.site.url || '')
  const logo = cfg.site.logo
  const accent = accentPair(cfg.ui.accentColor)

  const fieldHtml = FIELDS.map((f) => {
    const isRequired = required.has(f.name)
    const star = isRequired ? ' <em>*</em>' : ''
    const hint = f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''
    const describedBy = `err-${f.name}`
    const control =
      f.type === 'textarea'
        ? `<textarea id="f-${f.name}" name="${f.name}" rows="3" placeholder="${esc(f.placeholder)}" aria-describedby="${describedBy}"${isRequired ? ' required' : ''}></textarea>`
        : `<input id="f-${f.name}" name="${f.name}" type="${f.type}" placeholder="${esc(f.placeholder)}" aria-describedby="${describedBy}"${isRequired ? ' required' : ''} autocomplete="off">`
    const colClass = TOP_LINKS.includes(f.name) ? '' : ' class="wide"'
    return `<label${colClass} for="f-${f.name}"><span>${esc(f.label)}${star}</span>${control}<span class="err" id="${describedBy}" data-err="${f.name}" aria-live="polite"></span>${hint}</label>`
  }).join('\n')

  const turnstileBlock = turnstileReady
    ? `<div class="cf-turnstile" data-sitekey="${esc(siteKey)}" data-theme="auto"></div>`
    : ''

  const body = formUnavailable
    ? `<p class="notice">${disabled ? '友链申请通道当前未开放。' : '人机验证未配置，暂无法提交。'}</p>`
    : `<form id="apply-form" novalidate>
${fieldHtml}
${turnstileBlock}
<button type="submit" id="submit-btn">提交申请</button>
<div id="result" class="result" role="status" aria-live="polite" hidden></div>
</form>`

  const turnstileScript = turnstileReady
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>友链申请 · ${siteName}</title>
${turnstileScript}
<style>
:root{color-scheme:light;--bg:#faf9f5;--card:#fffdf9;--text:#1f1e1d;--muted:#5f5d58;--subtle:#6f6b63;--border:#e8e3d8;--control:#948b7a;--accent:#d97757;--accent-fg:#1f1e1d;--accent-hover:#c15f3c;--err:#a53f36;--err-bg:#f9e9e6;--ok:#4a6f4f;--ok-bg:#eef4ec;--font:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Songti SC","Noto Serif CJK SC",serif}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#262624;--card:#30302e;--text:#f5f4ef;--muted:#b9b6ac;--subtle:#a09d94;--border:#3d3d3a;--control:#83837a;--accent:#d97757;--accent-fg:#1f1e1d;--accent-hover:#e08a6d;--err:#e6a49b;--err-bg:rgba(190,100,90,.16);--ok:#a8c9a8;--ok-bg:rgba(111,150,115,.16)}}
${accent.bg !== DEFAULT_ACCENT ? `:root{--accent:${accent.bg};--accent-fg:${accent.fg};--accent-hover:color-mix(in oklab,${accent.bg} 84%,#000)}` : ''}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:var(--bg);color:var(--text);font:15px/1.65 var(--font);display:flex;justify-content:center;align-items:flex-start;padding:40px 16px;background-image:radial-gradient(rgba(90,80,60,.045) 1px,transparent 1px);background-size:22px 22px}
.card{width:100%;max-width:560px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px}
.logo{width:56px;height:56px;border-radius:12px;object-fit:cover;display:block;margin-bottom:14px}
h1{font-family:var(--serif);font-size:26px;font-weight:600;letter-spacing:-.012em;margin:0 0 8px;line-height:1.2}
.intro{color:var(--muted);margin:0 0 22px;font-size:14px}
form{display:grid;grid-template-columns:1fr 1fr;gap:16px}
label{display:flex;flex-direction:column;gap:6px;font-size:13px}
label.wide,form>.cf-turnstile,form>.notice,button,.result{grid-column:1/-1}
label span{color:var(--muted);font-weight:500}
label em{color:var(--err);font-style:normal}
input,textarea{font:inherit;font-size:14px;color:inherit;background:var(--card);border:1px solid var(--control);border-radius:8px;padding:9px 11px;width:100%;transition:border-color .15s ease,box-shadow .15s ease}
input:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in oklab,var(--accent) 22%,transparent)}
input[aria-invalid="true"],textarea[aria-invalid="true"]{border-color:var(--err)}
.err{color:var(--err);font-size:12px;min-height:0}
.hint{margin:0;color:var(--subtle);font-size:12px}
button{font:inherit;font-size:14px;font-weight:600;background:var(--accent);color:var(--accent-fg);border:0;border-radius:9px;padding:11px 14px;cursor:pointer;transition:background .15s ease}
button:hover{background:var(--accent-hover)}
button:disabled{opacity:.6;cursor:default}
.notice{color:var(--muted);grid-column:1/-1;margin:0}
.result{border-radius:8px;padding:10px 12px;font-size:14px}
.result.ok{background:var(--ok-bg);color:var(--ok)}
.result.bad{background:var(--err-bg);color:var(--err)}
.foot{margin-top:18px;font-size:13px;color:var(--subtle)}
.foot a{color:inherit}
@media (max-width:560px){body{padding:20px 12px}form{grid-template-columns:1fr}.card{padding:22px}label.wide{grid-column:auto}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
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
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function show(kind, text){
    result.className = 'result ' + kind;
    result.textContent = text;
    result.hidden = false;
    result.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
  }
  function clearErrors(){
    form.querySelectorAll('[data-err]').forEach(function(el){ el.textContent = ''; });
    form.querySelectorAll('input,textarea').forEach(function(el){ el.removeAttribute('aria-invalid'); });
  }
  var FIELD_LABELS = ${jsonForScript(Object.fromEntries(FIELDS.map((f) => [f.name, f.label])))};
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    clearErrors();
    // 客户端必填预检：空表单不发请求
    var firstEmpty = null;
    form.querySelectorAll('[required]').forEach(function(el){
      var empty = (el.value || '').trim() === '';
      el.closest('label').querySelector('.err').textContent = empty ? '必填' : '';
      if (empty) {
        el.setAttribute('aria-invalid', 'true');
        if (!firstEmpty) firstEmpty = el;
      }
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
        form.querySelectorAll('input,textarea').forEach(function(el){ el.value = ''; el.removeAttribute('aria-invalid'); });
      } else {
        var msg = (payload && payload.error && payload.error.message) || ('提交失败（' + res.status + '）');
        var details = payload && payload.error && payload.error.details;
        if (details) {
          Object.keys(details).forEach(function(k){
            var el = document.querySelector('[data-err="' + k + '"]');
            if (el) el.textContent = details[k];
            var input = document.querySelector('[name="' + k + '"]');
            if (input) input.setAttribute('aria-invalid', 'true');
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
