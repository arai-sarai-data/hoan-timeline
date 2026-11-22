/* 法案の生涯タイムライン — 依存ライブラリなし（グラフは自前SVG／HTML）
 * 画面遷移のハッシュは「#英数字とハイフン」だけ: #top #list #about #bill-k211-1
 * 絞り込みの状態はメモリと localStorage（try/catch）に保持し、URLには載せない。 */
(function () {
  "use strict";

  var root = document.documentElement;
  var app = document.getElementById("app");
  var tip = document.getElementById("tip");
  var themeBtn = document.getElementById("themeBtn");
  var META = null, SUM = null, STATS = null;
  var LIST = {};      // 回次 -> 一覧行
  var DETAIL = {};    // 回次 -> 詳細配列
  var KINDS = ["閣法", "衆法", "参法"];
  var KIND_LONG = { "閣法": "内閣提出", "衆法": "衆議院議員提出", "参法": "参議院議員提出" };
  var OUTCOMES = ["成立", "廃案", "否決", "撤回", "審議中", "その他", "不明"];
  // 積み上げの順＝検証済みカテゴリ色の順（青・橙・水・黄・桃）。不明はその他に含める
  var STACK = ["成立", "廃案", "撤回", "否決", "審議中", "その他"];
  var OCOLOR = { "成立": "--o-enacted", "廃案": "--o-dead", "撤回": "--o-withdrawn", "否決": "--o-rejected",
    "審議中": "--o-pending", "その他": "--o-other", "不明": "--o-other" };
  var ODESC = {
    "成立": "成立", "廃案": "審議未了で廃案", "否決": "本会議で否決", "撤回": "撤回",
    "審議中": "審議中・閉会中審査（継続）", "その他": "その他の状況", "不明": "状況不明"
  };
  // 一覧行: [id, kind, session, number, title, outcome, submitted, endDate, days, speeches, lastSession]
  var C = { id: 0, kind: 1, session: 2, number: 3, title: 4, outcome: 5, submitted: 6, endDate: 7, days: 8, speeches: 9, last: 10 };

  // ---------- 保存（iframe 内などで使えない場合は黙って無視） ----------
  var store = {
    get: function (k) { try { return window.localStorage.getItem("hoan-" + k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem("hoan-" + k, v); } catch (e) { /* 使えない環境 */ } },
    getJSON: function (k) { try { return JSON.parse(this.get(k) || "null"); } catch (e) { return null; } }
  };

  // ---------- ユーティリティ ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function css(v) { return getComputedStyle(root).getPropertyValue(v).trim(); }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + "（HTTP " + r.status + "）");
      return r.json();
    });
  }
  function fmtDate(d) {
    if (!d) return "—";
    var p = d.split("-");
    return p[0] + "年" + (+p[1]) + "月" + (+p[2]) + "日";
  }
  function fmtShort(d) { return d ? d.replace(/-/g, "/") : "—"; }
  function fmtMD(d) { return d ? (+d.slice(5, 7)) + "/" + (+d.slice(8, 10)) : ""; }
  function dayNum(d) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5; }
  function num(n) { return n == null ? "—" : Number(n).toLocaleString("ja-JP"); }
  function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : null; }
  function pctTxt(a, b) { var p = pct(a, b); return p == null ? "—" : p.toFixed(1) + "%"; }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function cat(o) { return o === "不明" ? "その他" : o; }
  function sw(o) { return '<i class="sw" style="background:var(' + (OCOLOR[o] || "--o-other") + ')"></i>'; }
  // 結末は白黒のスタンプ（色は政党・会派にだけ使う）
  function badge(o, cls) {
    return '<span class="badge o-' + esc(o) + (cls ? " " + cls : "") + '">' + esc(o) + "</span>";
  }
  function expandUrl(u) {
    if (!u) return u;
    var px = (META && META.urlPrefix) || {};
    for (var k in px) if (u.indexOf(k) === 0) return px[k] + u.slice(k.length);
    return u;
  }
  function svgEl(tag, attrs, text) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function trim(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }
  function skeleton(msg) {
    return '<div class="skel" aria-busy="true"><p>' + esc(msg || "読み込み中…") + '</p><i class="mid"></i><i class="big"></i><i></i><i></i></div>';
  }
  function errorBox(e) {
    return '<section class="panel error"><div class="empty"><b>データを読み込めませんでした</b><p>' + esc(e && e.message || e) +
      '</p><button type="button" class="btn" data-act="reload">もう一度読み込む</button></div></section>';
  }
  function noKindsBox() {
    return emptyBox("種類が選ばれていません", "閣法・衆法・参法のうち少なくとも1つを選んでください。", '<button type="button" class="btn primary" data-act="allkinds">すべての種類を選ぶ</button>');
  }
  function emptyBox(title, hint, btn) {
    return '<div class="empty"><b>' + esc(title) + "</b><p>" + esc(hint) + "</p>" + (btn || "") + "</div>";
  }

  // ---------- ツールチップ ----------
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var tx = x + 14, ty = y + 14;
    if (tx + w > window.innerWidth - 8) tx = x - w - 14;
    if (ty + h > window.innerHeight - 8) ty = y - h - 14;
    tip.style.left = Math.max(6, Math.min(tx, window.innerWidth - w - 6)) + "px";
    tip.style.top = Math.max(6, ty) + "px";
  }
  function hideTip() { tip.hidden = true; }
  // fn: () => html。on/off: ホバー中のハイライト処理
  function bindTip(el, fn, on, off) {
    function show(e) { showTip(typeof fn === "function" ? fn() : fn, e.clientX, e.clientY); if (on) on(); }
    el.addEventListener("pointerenter", show);
    el.addEventListener("pointermove", show);
    el.addEventListener("pointerdown", show);
    el.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") { hideTip(); if (off) off(); } });
    el.setAttribute("data-tip", "1");
  }
  document.addEventListener("scroll", hideTip, { passive: true });
  document.addEventListener("pointerdown", function (e) { if (!e.target.closest || !e.target.closest("[data-tip]")) hideTip(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideTip(); });

  // ---------- 配色（自動／ライト／ダーク） ----------
  var THEMES = ["auto", "light", "dark"], TLABEL = { auto: "自動", light: "ライト", dark: "ダーク" };
  var theme = store.get("theme"); if (THEMES.indexOf(theme) < 0) theme = "auto";
  function applyTheme() {
    if (theme === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
    themeBtn.textContent = "配色: " + TLABEL[theme];
  }
  themeBtn.addEventListener("click", function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    store.set("theme", theme); applyTheme(); rerender();
  });
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onMq = function () { if (theme === "auto") rerender(); };
    if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
  }
  applyTheme();

  // ---------- データ読み込み ----------
  function loadList(sessions) {
    return Promise.all(sessions.map(function (s) {
      if (LIST[s]) return LIST[s];
      return getJSON("data/list/s" + s + ".json").then(function (rows) { LIST[s] = rows; return rows; });
    })).then(function (arr) { return [].concat.apply([], arr); });
  }
  function loadSummary() {
    if (SUM && STATS) return Promise.resolve();
    return Promise.all([getJSON("data/summary.json"), getJSON("data/stats.json")]).then(function (a) { SUM = a[0]; STATS = a[1]; });
  }
  function SESS() { return META.sessions.slice().sort(function (a, b) { return a - b; }); }

  // =====================================================================
  // 索引（議員・会派・タグ・横断検索）
  // =====================================================================
  var IDX = null, FACTS = null, X = {};
  var MEM = {}, GRP = {}, GRPN = {}, TAG = {}, BILLROW = {};
  var memBills = [], grpBills = [], grpYes = [], grpNo = [], tagBills = [];
  var loadingIdx = null;
  function loadIndex() {
    if (IDX) return Promise.resolve(IDX);
    if (loadingIdx) return loadingIdx;
    loadingIdx = Promise.all([getJSON("data/index.json"), getJSON("data/facts.json")]).then(function (a) {
      IDX = a[0]; FACTS = a[1]; prepIndex(); return IDX;
    }).catch(function (e) { loadingIdx = null; throw e; });
    return loadingIdx;
  }
  function relLum(hex) {
    var c = hex.replace("#", ""); if (c.length === 3) c = c.replace(/./g, "$&$&");
    var v = [0, 2, 4].map(function (i) { var x = parseInt(c.slice(i, i + 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  // 背景色に対して白・黒のうちコントラスト比が高い方の文字色（WCAG AA 4.5:1 を確認済み）
  function textOn(hex) { var L = relLum(hex); return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? "#ffffff" : "#000000"; }
  function nz(s) { return String(s || "").normalize ? String(s || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase() : String(s || "").replace(/\s+/g, ""); }
  function prepIndex() {
    IDX.cols.forEach(function (c, i) { X[c] = i; });
    IDX.members.forEach(function (m, i) { MEM[m[1]] = i; memBills[i] = []; m.k = nz(m[0]); });
    IDX.groups.forEach(function (g, i) {
      GRP[g[1]] = i; GRPN[g[0]] = i; grpBills[i] = []; grpYes[i] = []; grpNo[i] = [];
      var col = IDX.families[g[2]][1]; g.color = col; g.tcol = textOn(col); g.fam = IDX.families[g[2]][0]; g.k = nz(g[0]);
    });
    IDX.tags.forEach(function (t, i) { TAG[t[0]] = i; tagBills[i] = []; t.k = nz(t[1]); });
    IDX.rows.forEach(function (r, ri) {
      BILLROW[r[X.id]] = ri;
      r.k = nz(r[X.title]);
      r[X.members].forEach(function (m) { memBills[m].push(ri); });
      r[X.groups].forEach(function (g) { grpBills[g].push(ri); });
      r[X.hrYes].forEach(function (g) { grpYes[g].push(ri); });
      r[X.hrNo].forEach(function (g) { grpNo[g].push(ri); });
      r[X.tags].forEach(function (t) { tagBills[t].push(ri); });
    });
  }
  function R(ri) { return IDX.rows[ri]; }
  function kindOf(r) { return IDX.kinds[r[X.kind]]; }
  function outOf(r) { return IDX.outcomes[r[X.outcome]]; }
  // 政党・会派のバッジ（色＋名前）。link=false なら span
  function pb(gi, cls, extra, nolink) {
    var g = IDX.groups[gi]; if (!g) return "";
    var st = ' style="--pc:' + g.color + ";--pt:" + g.tcol + '"';
    var inner = esc(g[0]) + (extra ? ' <span class="c">' + extra + "</span>" : "");
    return nolink ? '<span class="pb ' + (cls || "") + '"' + st + ">" + inner + "</span>"
      : '<a class="pb ' + (cls || "") + '" href="#' + g[1] + '"' + st + ">" + inner + "</a>";
  }
  function pbName(name, cls) { var gi = GRPN[name]; return gi == null ? '<span class="chip">' + esc(name) + "</span>" : pb(gi, cls); }
  function mlink(mi, cls) { var m = IDX.members[mi]; return '<a class="mn ' + (cls || "") + '" href="#' + m[1] + '">' + esc(m[0]) + "</a>"; }
  function tlink(ti, extra) {
    var t = IDX.tags[ti]; var c = t[2] === "kind" ? " k" : t[2] === "outcome" ? " o" : "";
    return '<a class="tg' + c + '" href="#tag-' + t[0] + '">' + esc(t[1]) + (extra != null ? ' <span class="c">' + extra + "</span>" : "") + "</a>";
  }
  function policyTags(r) { return r[X.tags].filter(function (t) { return IDX.tags[t][2] === "policy"; }); }
  // 議員の提出時の会派（提出会派が1つの法案から）
  function memGroups(mid) { return (FACTS.memberGroups[mid] || []).map(function (x) { return [GRP[x[0]], x[1]]; }).filter(function (x) { return x[0] != null; }); }
  function whoHtml(r, max) {
    var role = r[X.role], ms = r[X.members];
    if (role === 2) return '<span class="cab">内閣</span>';
    var h = "";
    if (role === 1) h += '<span class="muted">委員長提出</span> ';
    max = max || 3;
    h += ms.slice(0, max).map(function (m) { return mlink(m); }).join("、");
    if (ms.length > max) h += ' <span class="muted">ほか' + (ms.length - max) + "名</span>";
    if (!ms.length && role !== 1) h += '<span class="muted">提出者の記載なし</span>';
    return h;
  }

  // ---------- シェア ----------
  function siteBase() {
    var m = document.querySelector('meta[name="site-url"]'), u = m && m.getAttribute("content");
    if (u) return u.replace(/#.*$/, "");
    var h = String(location.href).split("#")[0];
    return /^https?:\/\//.test(h) ? h : "";
  }
  function xHref(text, hash) {
    var b = siteBase();
    return "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) + (b ? "&url=" + encodeURIComponent(b + "#" + hash) : "");
  }
  function xBtn(text, hash, label) { return '<a class="btn x" href="' + esc(xHref(text, hash)) + '" target="_blank" rel="noopener">' + esc(label || "Xでシェア") + "</a>"; }
  var copySeq = 0;
  function shareBlock(text, hash) {
    var id = "cp" + (++copySeq);
    return '<div class="share">' + xBtn(text, hash) +
      '<button type="button" class="btn" data-copy="' + id + '">テキストをコピー</button><span class="copy-st" id="' + id + 's" aria-live="polite"></span></div>' +
      '<label class="vh" for="' + id + '">シェア用のテキスト</label><textarea class="share-txt" id="' + id + '" readonly rows="4">' +
      esc(text + (siteBase() ? "\n" + siteBase() + "#" + hash : "")) + "</textarea>";
  }
  function copyFrom(id) {
    var ta = document.getElementById(id), st = document.getElementById(id + "s");
    if (!ta) return;
    function done(ok) {
      if (st) st.textContent = ok ? "コピーしました" : "自動でコピーできませんでした。テキストを選択したので、Ctrl+C（スマホは長押し）でコピーしてください。";
      if (!ok) { try { ta.focus(); ta.select(); } catch (e) { /* 無視 */ } }
    }
    function fallback() { var ok = false; try { ta.focus(); ta.select(); ok = document.execCommand("copy"); } catch (e) { ok = false; } done(ok); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(ta.value).then(function () { done(true); }, fallback); return; }
    } catch (e) { /* iframe 内などで使えない */ }
    fallback();
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-copy]");
    if (b) { e.preventDefault(); copyFrom(b.getAttribute("data-copy")); }
  });

  // =====================================================================
  // 概要（トップ）
  // =====================================================================
  var OV = store.getJSON("ov") || {};
  function ovDefaults() {
    var ss = SESS();
    if (ss.indexOf(OV.from) < 0) OV.from = ss[0];
    if (ss.indexOf(OV.to) < 0) OV.to = ss[ss.length - 1];
    if (!Array.isArray(OV.kinds) || !OV.kinds.length) OV.kinds = KINDS.slice();
    if (OV.from > OV.to) { var t = OV.from; OV.from = OV.to; OV.to = t; }
  }

  function renderTop() {
    app.innerHTML = skeleton("集計データを読み込み中…");
    Promise.all([loadSummary(), loadIndex()]).then(drawTop).catch(function (e) { app.innerHTML = errorBox(e); });
  }

  // トップの見出しと事実カード（facts.json の自動算出値をそのまま表示）
  function heroHtml(cnt, all) {
    var H = FACTS.headline;
    var h = '<section class="hx"><p class="hx-k">第' + H.from + "回〜第" + H.to + "回国会に提出された法律案 " + num(H.total) + "本</p>" +
      '<h1 class="hx-h"><span>内閣が出した法案は</span><span class="n">' + H.kakRate + "%が成立。</span><br><span>議員が出した法案は</span><span class=\"n\">" + H.giRate + "%。</span></h1>" +
      '<div class="hx-cmp">' +
      '<div class="hx-row"><div class="lb">閣法<small>内閣提出・' + num(H.kak) + '件中 成立' + num(H.kakEnacted) + '件</small></div><div class="hx-bar" role="img" aria-label="閣法の成立率 ' + H.kakRate + '%"><i style="width:' + H.kakRate + '%"></i></div><div class="pv">' + H.kakRate + "<small>%</small></div></div>" +
      '<div class="hx-row"><div class="lb">議員立法<small>衆法＋参法・' + num(H.gi) + '件中 成立' + num(H.giEnacted) + '件</small></div><div class="hx-bar" role="img" aria-label="議員立法の成立率 ' + H.giRate + '%"><i style="width:' + H.giRate + '%"></i></div><div class="pv">' + H.giRate + "<small>%</small></div></div>" +
      "</div>" +
      '<div class="lifeline"><div class="lifeline-bar" id="life" role="img" aria-label="全法案の結末の内訳">' +
      STACK.filter(function (o) { return cnt[o]; }).map(function (o) {
        return '<i data-o="' + o + '" style="flex:' + cnt[o] + ";background:var(" + OCOLOR[o] + ')"></i>';
      }).join("") + '</div><div class="lifeline-key">' +
      STACK.filter(function (o) { return cnt[o]; }).map(function (o) {
        return "<span>" + sw(o) + o + "<b>" + num(cnt[o]) + "</b>件（" + pctTxt(cnt[o], all.length) + "）</span>";
      }).join("") + "</div></div>" +
      '<div class="hx-foot">' + xBtn("国会に提出された法律案" + num(H.total) + "本。内閣提出（閣法）の成立率は" + H.kakRate + "%、議員提出（衆法・参法）は" + H.giRate + "%。（第" + H.from + "回〜第" + H.to + "回国会、衆議院・参議院の議案データから）", "top") +
      '<a class="btn primary" href="#list">全' + num(H.total) + '件の法案を検索・一覧で見る</a><a class="btn" href="#rankings">ランキング集</a></div></section>';
    return h;
  }
  function factCards() {
    var cs = FACTS.cards, n = cs.length;
    // 4列の格子が埋まるように、先頭2枚と（必要なら）末尾の数枚を2列幅にする
    var extra = 0; while ((n + 2 + extra) % 4 !== 0 && extra < 3) extra++;
    return '<div class="facts-grid">' + cs.map(function (c, i) {
      var feat = i < 2 || (i >= n - extra && i >= 2);
      var txt = c.head + "：" + num(c.big) + c.unit + "。" + c.text;
      return '<article class="fc' + (feat ? " feature" : "") + '"><div class="fc-n">' + num(c.big) + "<small>" + esc(c.unit) + "</small></div>" +
        '<h3 class="fc-h">' + esc(c.head) + '</h3><p class="fc-t">' + esc(c.text) + "</p>" +
        '<div class="fc-a"><a href="#' + esc(c.link) + '">' + esc(c.linkText) + '</a><a href="' + esc(xHref(txt + "（衆議院・参議院の議案データから自動算出）", c.link === "rank" ? "rank" : "top")) + '" target="_blank" rel="noopener">Xでシェア</a></div></article>';
    }).join("") + "</div>" +
      '<p class="note">すべて衆議院・参議院の議案データ（国会議案データベース）から自動で数えた値です。算出方法は「データについて」に載せています。</p>';
  }
  // TOP10（facts.json の rank）
  function rankLong(list) {
    var mx = list.length ? list[0].days : 1;
    return '<ol class="top10">' + list.map(function (b, i) {
      return '<li><span class="rk">' + (i + 1) + '</span><span class="nm"><a href="#bill-' + b.id + '">' + esc(b.title) + '</a></span><span class="vv">' + num(b.days) + "<small>日</small></span>" +
        '<span class="bar"><i style="width:' + (b.days / mx * 100).toFixed(1) + '%"></i></span>' +
        '<span class="sub">' + b.kind + "・第" + b.session + "回提出　" + fmtShort(b.submitted) + " → " + fmtShort(b.endDate) + " 成立</span></li>";
    }).join("") + "</ol>";
  }
  function rankMembers(list) {
    var mx = list.length ? list[0].n : 1;
    return '<ol class="top10">' + list.map(function (m, i) {
      var mi = MEM[m.id];
      var gs = memGroups(m.id).slice(0, 2).map(function (x) { return pb(x[0]); }).join("");
      return '<li><span class="rk">' + (i + 1) + '</span><span class="nm big">' + (mi != null ? mlink(mi) : esc(m.name)) + '</span><span class="vv">' + num(m.n) + "<small>件</small></span>" +
        '<span class="bar"><i style="width:' + (m.n / mx * 100).toFixed(1) + '%"></i></span>' +
        '<span class="sub">' + (gs || '<span>会派の記載なし（参法）</span>') + "<span>筆頭 " + num(m.first) + "件</span>" + (mi != null ? memberAchievements(mi).map(function (a) { return '<span class="achv">' + esc(a[0]) + "</span>"; }).join("") : "") + "</span></li>";
    }).join("") + "</ol>";
  }
  function rankSplit(list) {
    return '<ol class="top10 wide">' + list.map(function (b, i) {
      var pid = function (id) { return GRP[id]; };
      return '<li><span class="rk">' + (i + 1) + '</span><div class="nmw"><span class="nm"><a href="#bill-' + b.id + '">' + esc(b.title) + "</a></span>" +
        '<span class="sub">' + b.kind + "・第" + b.session + "回 " + badge(b.outcome) + "</span></div>" +
        '<div class="vy"><b class="yn y"><i></i>賛成 ' + b.yes.length + "</b>" + b.yes.map(function (g) { return pb(pid(g)); }).join("") +
        '</div><div class="vn"><b class="yn n"><i></i>反対 ' + b.no.length + "</b>" + b.no.map(function (g) { return pb(pid(g)); }).join("") + "</div></li>";
    }).join("") + "</ol>";
  }
  function rankSection(full) {
    var RK = FACTS.rank;
    return '<section class="sec"><div class="sec-hd"><h2>ランキング TOP10</h2><p>全期間（第' + FACTS.headline.from + "回〜第" + FACTS.headline.to + "回国会）</p></div>" +
      '<div class="grid2 row-gap">' +
      '<section class="panel"><div class="panel-hd"><h3 style="margin:0">審議日数ワースト（最長）TOP10</h3><p>提出から成立までの日数</p></div>' + rankLong(RK.long) + "</section>" +
      '<section class="panel"><div class="panel-hd"><h3 style="margin:0">提出者として名前がある法案が多い議員</h3></div>' + rankMembers(RK.members) +
      '<p class="note">委員長としての提出は数えていません。参法は元データに筆頭提出者だけが載っています。</p></section></div>' +
      '<section class="panel"><div class="panel-hd"><h3 style="margin:0">衆議院本会議で賛否が割れた法案</h3><p>最後の採決の賛成会派・反対会派</p></div>' + rankSplit(RK.split) +
      '<p class="note">賛成会派と反対会派の数が近い順（会派の数での比較。議席数ではありません）。数が同じなら会派の多い採決、新しい回次を先にしています。</p></section>' + (full ? "" : '<p style="margin:12px 0 0"><a class="btn" href="#rank">ランキングのページへ</a></p>') + "</section>";
  }
  // 分野タグ別の成立率（閣法・議員立法の2本）
  function tagRates(minN) {
    var ts = FACTS.tagStats.filter(function (t) { return t.group === "policy" && t.n >= (minN || 1); });
    return '<div class="legend"><span><i class="sw" style="background:var(--ink)"></i>閣法の成立率</span><span><i class="sw g"></i>議員立法（衆法＋参法）の成立率</span></div>' +
      '<div class="tbars">' + ts.map(function (t) {
        var ti = TAG[t.slug], gN = t.n - t.kak;
        var kr = t.kak ? t.kakEnacted / t.kak * 100 : null, gr = gN ? t.giEnacted / gN * 100 : null;
        return '<div class="trow"><div class="tl"><a href="#tag-' + t.slug + '">#' + esc(t.label) + "</a><small>" + num(t.n) + "件・成立 " + num(t.enacted) + "件</small></div>" +
          '<div class="tb" role="img" aria-label="' + esc(t.label) + " 閣法" + (kr == null ? "なし" : kr.toFixed(1) + "%") + " 議員立法" + (gr == null ? "なし" : gr.toFixed(1) + "%") + '">' +
          '<span><i style="width:' + (kr || 0).toFixed(1) + '%"></i></span><span class="g"><i style="width:' + (gr || 0).toFixed(1) + '%"></i></span></div>' +
          '<div class="tv">閣法 <b>' + (kr == null ? "—" : kr.toFixed(1) + "%") + "</b>（" + num(t.kak) + "件）<br>議員立法 <b>" + (gr == null ? "—" : gr.toFixed(1) + "%") + "</b>（" + num(gN) + "件）</div></div>";
      }).join("") + "</div>" +
      '<p class="note">分野は件名に含まれるキーワードによる自動分類で、1つの法案が複数の分野に入ることがあります。キーワードは各タグのページで確認できます。</p>';
  }

  // トップの入口（DBの一覧・暮らしテーマ・知ってた？）
  function entrances() {
    var life = IDX.tags.map(function (t, i) { return [t, i]; }).filter(function (x) { return x[0][2] === "life"; });
    var tv = FACTS.rankings.list.filter(function (x) { return x.cat === "trivia"; }).slice(0, 4);
    return '<section class="sec"><div class="sec-hd"><h2>暮らしテーマから法案を探す</h2><p>件名のキーワードによる自動分類</p></div><div class="lifegrid">' +
      life.map(function (x) {
        var S = FACTS.tagStats.filter(function (t) { return t.slug === x[0][0]; })[0] || { n: 0, enacted: 0 };
        return '<a class="lifecard" href="#tag-' + x[0][0] + '"><b>' + esc(x[0][1]) + "</b><span>" + num(S.n) + "件・成立率" + pctTxt(S.enacted, S.n) + "</span></a>";
      }).join("") + "</div></section>" +
      (tv.length ? '<section class="sec"><div class="sec-hd"><h2>知ってた？</h2><p>元データを数えただけの事実。くわしくは各ランキングから法案へ</p></div><div class="tvgrid">' +
        tv.map(function (x) { return '<a class="tvcard" href="#rank-' + x.id + '"><span class="tvf">' + esc(x.fact || "") + "</span><b>" + esc(x.title) + "</b></a>"; }).join("") +
        '</div><p class="chips" style="margin-top:10px"><a class="btn" href="#rankings">「知ってた？」とランキングをすべて見る</a></p></section>' : "");
  }
  function drawTop() {
    ovDefaults();
    var ss = SESS();
    var all = SUM.rows;
    var cnt = {}; all.forEach(function (r) { var o = cat(OUTCOMES[r[2]]); cnt[o] = (cnt[o] || 0) + 1; });
    var opt = function (sel) {
      return ss.map(function (x) { return '<option value="' + x + '"' + (x === sel ? " selected" : "") + ">第" + x + "回</option>"; }).join("");
    };
    var h = heroHtml(cnt, all) + entrances() +
      '<section class="sec"><div class="sec-hd"><h2>データが示す事実</h2><p>自動算出・出典リンクつき</p></div>' + factCards() + "</section>" +
      scoresTeaser() +
      rankSection(false) +
      '<section class="sec"><div class="sec-hd"><h2>分野タグ別の成立率</h2><p>件名による自動分類</p></div><div class="panel">' + tagRates(50) +
      '<p style="margin:12px 0 0"><a class="btn" href="#tags">すべての分野タグを見る</a></p></div></section>' +
      '<section class="sec"><div class="sec-hd"><h2>期間と種類で絞り込んで見る</h2><p>グラフにカーソルを合わせる（タップする）と数を表示</p></div>';

    h += '<div class="filterbar"><form class="filters" id="ovf" onsubmit="return false">' +
      '<div class="fld"><span>期間（国会回次）</span><div class="range"><select name="from" aria-label="開始の回次">' + opt(OV.from) +
      '</select><span>〜</span><select name="to" aria-label="終了の回次">' + opt(OV.to) + "</select></div></div>" +
      '<div class="fld"><span>すぐに選ぶ</span><div class="quick"><button type="button" class="btn" data-q="all">全期間</button>' +
      '<button type="button" class="btn" data-q="10">直近10回</button><button type="button" class="btn" data-q="187">第187回以降</button></div></div>' +
      '<div class="fld"><span>種類</span><div class="seg">' + KINDS.map(function (k) {
        return '<label><input type="checkbox" name="k" value="' + k + '"' + (OV.kinds.indexOf(k) >= 0 ? " checked" : "") + ">" + k + "</label>";
      }).join("") + "</div></div></form></div>";

    h += '<div class="kpis" id="kpis"></div>' +
      '<section class="panel"><div class="panel-hd"><h2>国会回次ごとの提出数と成立率</h2><p id="sesNote"></p></div>' +
      '<div class="legend" id="sesLegend"></div><div class="chart" id="sesChart"></div>' +
      '<p class="note">各法案は提出された回次に数えています。成立率＝成立した件数÷提出された件数。提出が10件未満の回次（短い臨時会・特別会など）は率が大きく振れるため、線でつながず白抜きの点で示しています。</p></section>' +
      '<div class="grid2 row-gap">' +
      '<section class="panel"><div class="panel-hd"><h2>閣法と議員立法の成立率</h2></div><p class="muted" style="margin:0 0 10px">選んだ期間のすべての種類を比べています（種類の絞り込みは使いません）。</p><div id="kindChart"></div></section>' +
      '<section class="panel"><div class="panel-hd"><h2>提出から成立までの日数</h2></div><div class="chart" id="hist"></div>' +
      '<p class="note">成立した法案のみ。日数＝最後に可決した本会議の日−提出日。30日刻み、720日以上はまとめています。</p></section></div>' +
      '<section class="panel"><div class="panel-hd"><h2>会派別の賛成率（衆議院本会議）</h2><p id="facNote"></p></div><div id="facChart"></div>' +
      '<p class="note">衆議院の議案データにある「賛成会派／反対会派」から、その会派が賛成した割合を数えています（賛成÷（賛成＋反対））。会派別の記録があるのは第187回国会以降です。会派名は当時の名称のままで、名称変更による統合はしていません。採決が10件未満の会派は表示しません。</p></section>' +
      "</section>";
    app.innerHTML = h;

    document.querySelectorAll("#life i").forEach(function (el) {
      var o = el.getAttribute("data-o");
      bindTip(el, "<b>" + o + "</b><br>" + num(cnt[o]) + " 件（全体の " + pctTxt(cnt[o], all.length) + "）");
    });
    var f = document.getElementById("ovf");
    function read() {
      OV.from = +f.from.value; OV.to = +f.to.value;
      OV.kinds = [].slice.call(f.querySelectorAll("input[name=k]:checked")).map(function (x) { return x.value; });
      if (OV.from > OV.to) { var t = OV.from; OV.from = OV.to; OV.to = t; f.from.value = OV.from; f.to.value = OV.to; }
      store.set("ov", JSON.stringify(OV));
      updateTop();
    }
    f.addEventListener("change", read);
    f.querySelectorAll("[data-q]").forEach(function (b) {
      b.addEventListener("click", function () {
        var q = b.getAttribute("data-q");
        f.to.value = ss[ss.length - 1];
        f.from.value = q === "all" ? ss[0] : q === "10" ? ss[Math.max(0, ss.length - 10)] : 187;
        read();
      });
    });
    updateTop();
  }

  function rankList(rows, maxDays) {
    if (!rows || !rows.length) return emptyBox("該当する法案はありません", "");
    var mx = maxDays || Math.max.apply(null, rows.map(function (r) { return r[C.days]; })) || 1;
    return '<ol class="rank">' + rows.map(function (r) {
      return '<li><a href="#bill-' + r[C.id] + '">' + esc(r[C.title]) + '</a><span class="d">' + num(r[C.days]) + "日</span>" +
        '<span class="bar"><i style="width:' + Math.max(0.6, r[C.days] / mx * 100) + '%"></i></span>' +
        '<span class="m">' + r[C.kind] + "・第" + r[C.session] + "回提出／" + fmtShort(r[C.submitted]) + " 提出 → " + fmtShort(r[C.endDate]) + " 成立</span></li>";
    }).join("") + "</ol>";
  }

  function updateTop() {
    hideTip();
    var inRange = SUM.rows.filter(function (r) { return r[0] >= OV.from && r[0] <= OV.to; });
    var rows = inRange.filter(function (r) { return OV.kinds.indexOf(KINDS[r[1]]) >= 0; });
    var rangeTxt = OV.from === OV.to ? "第" + OV.from + "回" : "第" + OV.from + "回〜第" + OV.to + "回";
    var kindTxt = OV.kinds.length === 3 ? "全種類" : OV.kinds.join("・") || "種類なし";
    // KPI
    var en = rows.filter(function (r) { return r[2] === 0; });
    var days = en.filter(function (r) { return r[3] != null; }).map(function (r) { return r[3]; });
    var kak = inRange.filter(function (r) { return r[1] === 0; }), gi = inRange.filter(function (r) { return r[1] !== 0; });
    var ok = function (a) { return a.filter(function (r) { return r[2] === 0; }).length; };
    var med = median(days);
    document.getElementById("kpis").innerHTML =
      kpi("提出された法律案", num(rows.length) + "<small>件</small>", rangeTxt + "・" + kindTxt) +
      kpi("成立率", rows.length ? pct(en.length, rows.length).toFixed(1) + "<small>%</small>" : "—", "成立 " + num(en.length) + " 件／提出 " + num(rows.length) + " 件") +
      '<div class="kpi"><div class="k">閣法と議員立法の成立率</div><div class="v pair"><div><span>閣法</span>' +
      (kak.length ? pct(ok(kak), kak.length).toFixed(0) + "<small>%</small>" : "—") + "</div><div><span>議員立法</span>" +
      (gi.length ? pct(ok(gi), gi.length).toFixed(0) + "<small>%</small>" : "—") + '</div></div><div class="s">議員立法＝衆法＋参法</div></div>' +
      kpi("提出から成立までの日数（中央値）", med == null ? "—" : num(med) + "<small>日</small>", days.length ? "成立 " + num(days.length) + " 件で算出、最長 " + num(Math.max.apply(null, days)) + " 日" : "成立した法案がありません");

    document.getElementById("sesNote").textContent = rangeTxt + "・" + kindTxt;
    var present = STACK.filter(function (o) { return rows.some(function (r) { return cat(OUTCOMES[r[2]]) === o; }); });
    document.getElementById("sesLegend").innerHTML = !rows.length ? "" : present.map(function (o) { return "<span>" + sw(o) + o + "</span>"; }).join("") +
      '<span><svg width="18" height="10" aria-hidden="true"><line x1="0" y1="5" x2="18" y2="5" stroke="var(--ink-2)" stroke-width="2"/></svg> 成立率（下段）</span><span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3" fill="none" stroke="var(--ink-3)" stroke-width="1.2"/></svg> 提出10件未満の回次の成立率</span>';
    drawSessions(document.getElementById("sesChart"), rows);
    drawKinds(document.getElementById("kindChart"), inRange);
    drawHist(document.getElementById("hist"), days, med);
    document.getElementById("facNote").textContent = rangeTxt + "・" + kindTxt;
    drawFactions(document.getElementById("facChart"));
  }
  function kpi(k, v, s) { return '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + (s || "") + "</div></div>"; }

  // 回次ごと: 上段＝結末の積み上げ棒、下段＝成立率の折れ線（同じ横軸・別々の縦軸目盛りを持つ2つのパネル）
  function drawSessions(el, rows) {
    var ss = SESS().filter(function (s) { return s >= OV.from && s <= OV.to; });
    if (!OV.kinds.length) { el.innerHTML = noKindsBox(); return; }
    if (!rows.length || !ss.length) { el.innerHTML = emptyBox("この条件に当てはまる法案はありません", "種類のチェックを増やすか、期間を広げてください。"); return; }
    var by = {}; ss.forEach(function (s) { by[s] = { t: 0 }; });
    rows.forEach(function (r) { var b = by[r[0]]; if (!b) return; var o = cat(OUTCOMES[r[2]]); b[o] = (b[o] || 0) + 1; b.t++; });
    var W = Math.max(300, el.clientWidth || 600), sm = W < 560;
    var m = { l: sm ? 34 : 42, r: 10 };
    var aT = 22, aH = sm ? 170 : 210, bT = aT + aH + 34, bH = sm ? 80 : 100, H = bT + bH + 30;
    var iw = W - m.l - m.r, n = ss.length, bw = iw / n;
    var gap = bw > 8 ? 2 : bw > 3 ? 1 : 0, w = Math.min(44, Math.max(1, bw - gap));
    var tot = ss.map(function (s) { return by[s].t; });
    var ticks = niceTicks(Math.max.apply(null, tot) || 1), top = ticks[ticks.length - 1];
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": "国会回次ごとの提出数（結末別の積み上げ）と成立率" });
    var grid = css("--grid"), line = css("--rule"), card = css("--card");
    svg.appendChild(svgEl("text", { x: m.l, y: 12, "class": "ttl" }, "提出数（件）"));
    ticks.forEach(function (t) {
      var y = aT + aH - t / top * aH;
      svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: t ? grid : line }));
      svg.appendChild(svgEl("text", { x: m.l - 6, y: y + 4, "text-anchor": "end" }, t));
    });
    svg.appendChild(svgEl("text", { x: m.l, y: bT - 10, "class": "ttl" }, "成立率（%）"));
    [0, 50, 100].forEach(function (t) {
      var y = bT + bH - t / 100 * bH;
      svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: t ? grid : line, "stroke-dasharray": t === 50 ? "3 3" : null }));
      svg.appendChild(svgEl("text", { x: m.l - 6, y: y + 4, "text-anchor": "end" }, t));
    });
    var cx = function (i) { return m.l + i * bw + bw / 2; };
    ss.forEach(function (s, i) {
      var x = cx(i) - w / 2, y0 = aT + aH, segs = STACK.filter(function (o) { return by[s][o]; });
      segs.forEach(function (o, j) {
        var hgt = by[s][o] / top * aH;
        var hh = Math.max(0.5, hgt - (j < segs.length - 1 && hgt > 3 ? 1.5 : 0));
        var yTop = y0 - hgt;
        var isTop = j === segs.length - 1;
        if (isTop && w >= 6 && hh > 3) svg.appendChild(svgEl("path", { d: roundTop(x, yTop, w, hh, Math.min(4, w / 2, hh)), fill: css(OCOLOR[o]) }));
        else svg.appendChild(svgEl("rect", { x: x, y: yTop, width: w, height: hh, fill: css(OCOLOR[o]) }));
        y0 -= hgt;
      });
    });
    // 成立率の折れ線
    // 提出10件未満の回次は率が大きく振れるので線をつながず、白抜きの点だけにする
    var SMALL = 10;
    var pts = ss.map(function (s, i) { return by[s].t ? [cx(i), bT + bH - (by[s]["成立"] || 0) / by[s].t * bH, by[s].t >= SMALL] : null; });
    var d = "", pen = false;
    pts.forEach(function (p) { if (!p || !p[2]) { return; } d += (pen ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); pen = true; });
    svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: css("--ink-2"), "stroke-width": 2, "stroke-linejoin": "round" }));
    pts.forEach(function (p) {
      if (p && !p[2]) svg.appendChild(svgEl("circle", { cx: p[0], cy: p[1], r: 2.5, fill: card, stroke: css("--ink-3"), "stroke-width": 1.2 }));
      else if (p && n <= 30) svg.appendChild(svgEl("circle", { cx: p[0], cy: p[1], r: 3, fill: css("--ink-2"), stroke: card, "stroke-width": 1.5 }));
    });
    // 横軸ラベル（回次）
    var lastX = -1e9, minGap = sm ? 30 : 36;
    ss.forEach(function (s, i) {
      var x = cx(i);
      var want = n <= 12 || s % 10 === 0 || i === 0 || i === n - 1;
      if (want && x - lastX >= minGap && (i === n - 1 || W - m.r - x > 14 || true)) {
        if (i === n - 1 && x - lastX < minGap) return;
        svg.appendChild(svgEl("text", { x: x, y: bT + bH + 16, "text-anchor": "middle" }, s));
        lastX = x;
      }
    });
    svg.appendChild(svgEl("text", { x: W - m.r, y: bT + bH + 29, "text-anchor": "end" }, "国会回次 →"));
    // ホバー層
    var cross = svgEl("rect", { x: 0, y: aT, width: Math.max(2, bw), height: bT + bH - aT, fill: css("--ink"), opacity: 0, "pointer-events": "none" });
    var dot = svgEl("circle", { r: 5, fill: css("--ink-2"), stroke: card, "stroke-width": 2, opacity: 0, "pointer-events": "none" });
    svg.insertBefore(cross, svg.firstChild);
    svg.appendChild(dot);
    ss.forEach(function (s, i) {
      var hit = svgEl("rect", { x: m.l + i * bw, y: aT, width: bw, height: bT + bH - aT, "class": "hit" });
      bindTip(hit, function () {
        var b = by[s];
        return "<b>第" + s + "回国会</b>" + '<div class="r"><span>提出</span><span>' + num(b.t) + " 件</span></div>" +
          STACK.filter(function (o) { return b[o]; }).map(function (o) { return '<div class="r"><span>' + sw(o) + o + "</span><span>" + num(b[o]) + "</span></div>"; }).join("") +
          '<div class="r"><span>成立率</span><span>' + pctTxt(b["成立"] || 0, b.t) + "</span></div>";
      }, function () {
        cross.setAttribute("x", m.l + i * bw); cross.setAttribute("opacity", 0.07);
        if (pts[i]) { dot.setAttribute("cx", pts[i][0]); dot.setAttribute("cy", pts[i][1]); dot.setAttribute("opacity", 1); }
      }, function () { cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); });
      svg.appendChild(hit);
    });
    svg.addEventListener("pointerleave", function () { cross.setAttribute("opacity", 0); dot.setAttribute("opacity", 0); });
    el.innerHTML = ""; el.appendChild(svg);
  }

  // 種類ごとの結末（100%積み上げ横棒・HTML）
  function drawKinds(el, rows) {
    if (!rows.length) { el.innerHTML = emptyBox("この期間に法案はありません", "期間を広げてください。"); return; }
    var h = '<div class="legend">' + STACK.map(function (o) { return "<span>" + sw(o) + o + "</span>"; }).join("") + "</div>";
    var data = KINDS.map(function (k, ki) {
      var c = { t: 0 }; rows.forEach(function (r) { if (r[1] !== ki) return; var o = cat(OUTCOMES[r[2]]); c[o] = (c[o] || 0) + 1; c.t++; });
      return { k: k, c: c };
    });
    h += '<div class="kbars">' + data.map(function (d, i) {
      return '<div class="krow"><div class="kl"><b>' + d.k + "</b><small>" + KIND_LONG[d.k] + "・" + num(d.c.t) + ' 件</small></div>' +
        '<div class="kb">' + (d.c.t ? STACK.filter(function (o) { return d.c[o]; }).map(function (o) {
          return '<i data-k="' + i + '" data-o="' + o + '" style="flex:' + d.c[o] + ";background:var(" + OCOLOR[o] + ')"></i>';
        }).join("") : '<span class="muted">提出なし</span>') + "</div>" +
        '<div class="kv"><b>' + (d.c.t ? pctTxt(d.c["成立"] || 0, d.c.t) : "—") + "</b><small>成立</small></div></div>";
    }).join("") + "</div>";
    el.innerHTML = h;
    el.querySelectorAll(".kb i").forEach(function (seg) {
      var d = data[+seg.getAttribute("data-k")], o = seg.getAttribute("data-o");
      bindTip(seg, "<b>" + d.k + "（" + KIND_LONG[d.k] + "）</b>" + '<div class="r"><span>' + sw(o) + o + "</span><span>" + num(d.c[o]) + " 件</span></div>" +
        '<div class="r"><span>割合</span><span>' + pctTxt(d.c[o], d.c.t) + "</span></div>");
    });
  }

  // 日数のヒストグラム（30日刻み、720日以上はまとめる）＋中央値の線
  function drawHist(el, days, med) {
    if (!OV.kinds.length) { el.innerHTML = noKindsBox(); return; }
    if (!days.length) { el.innerHTML = emptyBox("成立した法案がありません", "期間や種類を広げてください。"); return; }
    var step = 30, cap = 720, nb = cap / step + 1;
    var bins = []; for (var i = 0; i < nb; i++) bins.push(0);
    days.forEach(function (d) { bins[Math.min(nb - 1, Math.floor(d / step))]++; });
    var W = Math.max(280, el.clientWidth || 500), H = 250, m = { l: 40, r: 10, t: 22, b: 40 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var ticks = niceTicks(Math.max.apply(null, bins)), top = ticks[ticks.length - 1];
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": "提出から成立までの日数の分布（30日刻み）" });
    svg.appendChild(svgEl("text", { x: m.l, y: 12, "class": "ttl" }, "法案の数（件）"));
    ticks.forEach(function (t) {
      var y = m.t + ih - t / top * ih;
      svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: t ? css("--grid") : css("--rule") }));
      svg.appendChild(svgEl("text", { x: m.l - 6, y: y + 4, "text-anchor": "end" }, num(t)));
    });
    var bw = iw / nb, hl = [];
    bins.forEach(function (c, i) {
      var x = m.l + i * bw + 1, w = Math.max(1, bw - 2);
      var bh = c / top * ih, y = m.t + ih - bh;
      var mark = null;
      if (c > 0) { mark = svgEl("path", { d: roundTop(x, y, w, Math.max(bh, 1), Math.min(4, w / 2, bh)), fill: css("--bar") }); svg.appendChild(mark); }
      var lab = i === nb - 1 ? cap + "日以上" : (i * step) + "〜" + (i * step + step - 1) + "日";
      var hit = svgEl("rect", { x: m.l + i * bw, y: m.t, width: bw, height: ih, "class": "hit" });
      bindTip(hit, "<b>" + lab + "</b>" + '<div class="r"><span>成立した法案</span><span>' + num(c) + " 件</span></div>" +
        '<div class="r"><span>割合</span><span>' + pctTxt(c, days.length) + "</span></div>",
        function () { if (mark) mark.setAttribute("opacity", .75); }, function () { if (mark) mark.removeAttribute("opacity"); });
      hl.push(hit);
      if (i % (W < 420 ? 6 : 3) === 0 && i < nb - 1) svg.appendChild(svgEl("text", { x: m.l + i * bw, y: H - m.b + 15, "text-anchor": "middle" }, i * step));
    });
    svg.appendChild(svgEl("text", { x: W - m.r, y: H - m.b + 15, "text-anchor": "end" }, cap + "+"));
    svg.appendChild(svgEl("text", { x: m.l + iw / 2, y: H - 6, "text-anchor": "middle" }, "提出から成立までの日数（日）"));
    if (med != null) {
      var mx = m.l + Math.min(med, cap) / step * bw;
      svg.appendChild(svgEl("line", { x1: mx, x2: mx, y1: m.t - 4, y2: m.t + ih, stroke: css("--ink"), "stroke-width": 1.5, "stroke-dasharray": "4 3", "pointer-events": "none" }));
      var right = mx < m.l + iw * 0.6;
      svg.appendChild(svgEl("text", { x: mx + (right ? 6 : -6), y: m.t + 10, "text-anchor": right ? "start" : "end", "class": "val" }, "中央値 " + num(med) + "日"));
    }
    hl.forEach(function (x) { svg.appendChild(x); });
    el.innerHTML = ""; el.appendChild(svg);
  }

  // 会派別の賛成率（横棒・HTML）
  var facShowAll = false;
  function drawFactions(el) {
    var ki = OV.kinds.map(function (k) { return KINDS.indexOf(k); });
    var vs = SUM.votes.filter(function (v) { return v[0] >= OV.from && v[0] <= OV.to && ki.indexOf(v[1]) >= 0; });
    if (!ki.length) { el.innerHTML = noKindsBox(); return; }
    if (!vs.length) {
      el.innerHTML = emptyBox("この期間・種類には会派別の賛否の記録がありません", "会派別の記録は第187回国会以降にあります。期間を「第187回以降」にしてみてください。",
        '<button type="button" class="btn" id="fac187">第187回以降を表示</button>');
      var b = document.getElementById("fac187");
      if (b) b.onclick = function () { var f = document.getElementById("ovf"); f.from.value = 187; f.to.value = SESS()[SESS().length - 1]; f.dispatchEvent(new Event("change")); };
      return;
    }
    var st = {};
    vs.forEach(function (v) {
      v[3].forEach(function (g) { var s = st[g] = st[g] || { y: 0, n: 0, a: v[0], b: v[0] }; s.y++; s.a = Math.min(s.a, v[0]); s.b = Math.max(s.b, v[0]); });
      v[4].forEach(function (g) { var s = st[g] = st[g] || { y: 0, n: 0, a: v[0], b: v[0] }; s.n++; s.a = Math.min(s.a, v[0]); s.b = Math.max(s.b, v[0]); });
    });
    var list = Object.keys(st).map(function (g) { var s = st[g]; s.name = SUM.factions[+g]; s.t = s.y + s.n; s.r = s.y / s.t; return s; })
      .filter(function (s) { return s.t >= 10; })
      .sort(function (a, b) { return b.r - a.r || b.t - a.t; });
    if (!list.length) { el.innerHTML = emptyBox("採決が10件以上ある会派がありません", "期間を広げてください。"); return; }
    var LIM = 14, shown = facShowAll ? list : list.slice(0, LIM);
    var h = '<p class="muted" style="margin:0 0 8px">対象の採決 ' + num(vs.length) + " 件・" + list.length + " 会派（賛成率の高い順）。棒の色は会派の識別色です（評価ではありません）。会派名を選ぶと会派のページを開きます。</p>" +
      '<div class="fbars">' + shown.map(function (s, i) {
        var gi = GRPN[s.name], g = IDX.groups[gi];
        return '<div class="frow" data-i="' + i + '"><div class="fl">' + pbName(s.name) + '</div><div class="ft"><i style="width:' + (s.r * 100).toFixed(1) +
          '%;--pc:' + (g ? g.color : "var(--ink)") + '"></i></div><div class="fv"><b>' + Math.round(s.r * 100) + "%</b><small>" + num(s.t) + "件</small></div></div>";
      }).join("") + "</div>";
    if (list.length > LIM) h += '<p style="margin:10px 0 0"><button type="button" class="btn" id="facMore">' + (facShowAll ? "上位" + LIM + "会派だけ表示" : "残り" + (list.length - LIM) + "会派も表示") + "</button></p>";
    el.innerHTML = h;
    el.querySelectorAll(".frow").forEach(function (row) {
      var s = shown[+row.getAttribute("data-i")];
      bindTip(row, "<b>" + esc(s.name) + "</b>" + '<div class="r"><span>賛成</span><span>' + num(s.y) + " 件</span></div>" +
        '<div class="r"><span>反対</span><span>' + num(s.n) + " 件</span></div>" + '<div class="r"><span>賛成率</span><span>' + pctTxt(s.y, s.t) + "</span></div>" +
        '<div class="r"><span>記録のある回次</span><span>第' + s.a + (s.b !== s.a ? "〜" + s.b : "") + "回</span></div>");
    });
    var mb = document.getElementById("facMore");
    if (mb) mb.onclick = function () { facShowAll = !facShowAll; drawFactions(el); };
  }

  function roundTop(x, y, w, h, r) {
    r = Math.max(0, r);
    return "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y + "H" + (x + w - r) +
      "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + "Z";
  }
  function niceTicks(max) {
    var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    var st = steps.find(function (s) { return max / s <= 5; }) || 2000;
    var out = [];
    for (var v = 0; v < max + st; v += st) out.push(v);
    if (out.length < 2) out.push(st);
    return out;
  }

  // =====================================================================
  // 法案一覧（索引 index.json から。全回次を一度に絞り込める）
  // =====================================================================
  var LS = store.getJSON("list") || {};
  function lsDefaults() {
    if (LS.s !== "all" && META.sessions.indexOf(+LS.s) < 0) LS.s = "all";
    if (!Array.isArray(LS.kinds) || !LS.kinds.length) LS.kinds = KINDS.slice();
    if (OUTCOMES.indexOf(LS.o) < 0) LS.o = "";
    if (typeof LS.q !== "string") LS.q = "";
    if (typeof LS.t !== "string" || (LS.t && TAG[LS.t] == null)) LS.t = "";
    if (typeof LS.g !== "string" || (LS.g && GRP[LS.g] == null)) LS.g = "";
    if (!SORTS[LS.sort]) LS.sort = "new";
    if (LS.mode !== "card" && LS.mode !== "table") LS.mode = window.innerWidth < 640 ? "card" : "table";
    LS.page = LS.page || 0;
  }
  function saveLS() { store.set("list", JSON.stringify({ s: LS.s, kinds: LS.kinds, o: LS.o, q: LS.q, t: LS.t, g: LS.g, sort: LS.sort, mode: LS.mode })); }
  var kOrder = { "閣法": 0, "衆法": 1, "参法": 2 };
  function byNew(a, b) { return (b[X.session] - a[X.session]) || (a[X.kind] - b[X.kind]) || (a[X.number] - b[X.number]); }
  function nullLast(key, dir) {
    return function (a, b) {
      var x = a[X[key]], y = b[X[key]];
      if (x == null && y == null) return byNew(a, b);
      if (x == null) return 1; if (y == null) return -1;
      return ((x < y ? -1 : x > y ? 1 : 0) * dir) || byNew(a, b);
    };
  }
  var SORTS = {
    "new": ["新しい回次から", byNew],
    "old": ["古い回次から", function (a, b) { return -byNew(a, b); }],
    "long": ["日数が長い順", nullLast("days", -1)],
    "short": ["日数が短い順", nullLast("days", 1)],
    "subs": ["提出者が多い順", function (a, b) { return (b[X.members].length - a[X.members].length) || byNew(a, b); }],
    "ment": ["会議録の発言が多い順", nullLast("speeches", -1)],
    "title": ["件名の順", function (a, b) { return a[X.title].localeCompare(b[X.title], "ja") || byNew(a, b); }]
  };
  // キーワード: 件名・提出者名・提出会派名・賛否の会派名のどれかに部分一致
  function rowMatches(r, q) {
    if (!q) return true;
    if (r.k.indexOf(q) >= 0) return true;
    var ms = r[X.members];
    for (var i = 0; i < ms.length; i++) if (IDX.members[ms[i]].k.indexOf(q) >= 0) return true;
    var gs = r[X.groups];
    for (i = 0; i < gs.length; i++) if (IDX.groups[gs[i]].k.indexOf(q) >= 0) return true;
    return false;
  }

  function renderList() {
    app.innerHTML = skeleton("一覧を読み込み中…");
    loadIndex().then(drawList).catch(function (e) { app.innerHTML = errorBox(e); });
  }
  function drawList() {
    lsDefaults();
    var ss = META.sessions;
    var pol = IDX.tags.map(function (t, i) { return [t, i]; }).filter(function (x) { return x[0][2] === "policy"; });
    var gs = IDX.groups.map(function (g, i) { return [g, i, grpBills[i].length]; }).filter(function (x) { return x[2] > 0; })
      .sort(function (a, b) { return b[2] - a[2]; });
    app.innerHTML = '<section class="hero"><h1>法案一覧</h1><p class="lead">件名・議員名・会派名のキーワード、回次・種類・結末・分野タグ・提出会派で絞り込めます。</p></section>' +
      '<div class="filterbar"><form class="filters" id="lf" onsubmit="return false">' +
      '<label class="fld grow"><span>キーワード（件名・議員名・会派名）</span><input type="search" name="q" value="' + esc(LS.q) + '" placeholder="例: 個人情報／岡田克也／公明党" enterkeyhint="search"></label>' +
      '<label class="fld"><span>国会回次</span><select name="s"><option value="all">全回次</option>' +
      ss.map(function (x) { return '<option value="' + x + '"' + (String(x) === LS.s ? " selected" : "") + ">第" + x + "回" + (x === META.latestSession ? "（最新）" : "") + "</option>"; }).join("") +
      "</select></label>" +
      '<div class="fld"><span>種類</span><div class="seg">' + KINDS.map(function (k) {
        return '<label><input type="checkbox" name="k" value="' + k + '"' + (LS.kinds.indexOf(k) >= 0 ? " checked" : "") + ">" + k + "</label>";
      }).join("") + "</div></div>" +
      '<label class="fld"><span>結末</span><select name="o"><option value="">すべて</option>' +
      OUTCOMES.map(function (o) { return '<option value="' + o + '"' + (o === LS.o ? " selected" : "") + ">" + o + "</option>"; }).join("") +
      "</select></label>" +
      '<label class="fld"><span>分野・暮らしテーマ（自動分類）</span><select name="t"><option value="">すべて</option><optgroup label="政策分野">' +
      pol.map(function (x) { return '<option value="' + x[0][0] + '"' + (x[0][0] === LS.t ? " selected" : "") + ">" + esc(x[0][1]) + "</option>"; }).join("") + '</optgroup><optgroup label="暮らしテーマ">' +
      IDX.tags.map(function (t, i) { return [t, i]; }).filter(function (x) { return x[0][2] === "life"; }).map(function (x) { return '<option value="' + x[0][0] + '"' + (x[0][0] === LS.t ? " selected" : "") + ">" + esc(x[0][1]) + "</option>"; }).join("") + "</optgroup>" +
      "</select></label>" +
      '<label class="fld"><span>提出会派</span><select name="g"><option value="">すべて</option>' +
      gs.map(function (x) { return '<option value="' + x[0][1] + '"' + (x[0][1] === LS.g ? " selected" : "") + ">" + esc(x[0][0]) + "（" + x[2] + "）</option>"; }).join("") +
      "</select></label>" +
      "</form></div>" +
      '<div class="list-hd"><div class="cnt" id="lcnt"></div><div class="chips">' +
      '<label class="fld" style="flex-direction:row;align-items:center;gap:6px"><span>並べ替え</span><select id="lsort">' +
      Object.keys(SORTS).map(function (k) { return '<option value="' + k + '"' + (k === LS.sort ? " selected" : "") + ">" + SORTS[k][0] + "</option>"; }).join("") +
      '</select></label><div class="seg" role="group" aria-label="表示の形"><button type="button" data-mode="card" aria-pressed="' + (LS.mode === "card") +
      '">カード</button><button type="button" data-mode="table" aria-pressed="' + (LS.mode === "table") + '">表</button></div></div></div>' +
      '<div id="lmini"></div><div id="lbody"></div>';

    var f = document.getElementById("lf");
    function update() {
      var before = JSON.stringify([LS.s, LS.o, LS.q, LS.kinds, LS.t, LS.g]);
      LS.s = f.s.value; LS.o = f.o.value; LS.q = f.q.value; LS.t = f.t.value; LS.g = f.g.value;
      LS.kinds = [].slice.call(f.querySelectorAll("input[name=k]:checked")).map(function (x) { return x.value; });
      if (JSON.stringify([LS.s, LS.o, LS.q, LS.kinds, LS.t, LS.g]) === before) return;
      LS.page = 0; saveLS(); listDraw();
    }
    f.addEventListener("change", update);
    var t; f.q.addEventListener("input", function () { clearTimeout(t); t = setTimeout(update, 200); });
    document.getElementById("lsort").addEventListener("change", function (e) { LS.sort = e.target.value; LS.page = 0; saveLS(); listPaint(); });
    document.querySelectorAll("[data-mode]").forEach(function (b) {
      b.addEventListener("click", function () {
        LS.mode = b.getAttribute("data-mode"); saveLS();
        document.querySelectorAll("[data-mode]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        listPaint();
      });
    });
    listDraw();
  }

  var listRows = [];
  function listDraw() {
    var q = nz(LS.q), s = LS.s === "all" ? null : +LS.s;
    var ti = LS.t ? TAG[LS.t] : null, gi = LS.g ? GRP[LS.g] : null;
    listRows = IDX.rows.filter(function (r) {
      return (s == null || r[X.session] === s) && LS.kinds.indexOf(kindOf(r)) >= 0 && (!LS.o || outOf(r) === LS.o) &&
        (ti == null || r[X.tags].indexOf(ti) >= 0) && (gi == null || r[X.groups].indexOf(gi) >= 0) && rowMatches(r, q);
    });
    listPaint();
  }

  function billCard(r) {
    var d = r[X.days], o = outOf(r), ocv = OCOLOR[o] || "--o-other";
    var gs = r[X.groups].map(function (g) { return pb(g); }).join("");
    var endTxt = r[X.endDate] ? " → " + fmtShort(r[X.endDate]) + " " + o : "";
    return '<div class="bcard" style="--o-c:var(' + ocv + ')"><div class="chips"><span class="chip">' + kindOf(r) + " 第" + r[X.session] + "回 第" + r[X.number] + "号</span>" + badge(o) + "</div>" +
      '<a class="t" href="#bill-' + r[X.id] + '">' + esc(r[X.title]) + "</a>" +
      '<div class="who">' + whoHtml(r, 3) + (gs ? " " + gs : "") + "</div>" +
      '<div class="chips">' + policyTags(r).map(function (t) { return tlink(t); }).join("") + "</div>" +
      '<div class="dt">' + fmtShort(r[X.submitted]) + " 提出" + endTxt + (d != null ? "（" + num(d) + "日）" : "") +
      (r[X.speeches] != null ? "／会議録 " + num(r[X.speeches]) + " 発言" : "") + "</div>" +
      (d != null ? '<div class="dbar" title="提出から結末までの日数（720日で満杯）"><i style="width:' + Math.max(1.5, Math.min(100, d / 720 * 100)) + "%;background:var(--ink)\"></i></div>" : "") +
      "</div>";
  }

  function listPaint() {
    hideTip();
    var body = document.getElementById("lbody"); if (!body) return;
    var rows = listRows.slice().sort(SORTS[LS.sort][1]);
    var cnt = {}; rows.forEach(function (r) { var o = cat(outOf(r)); cnt[o] = (cnt[o] || 0) + 1; });
    document.getElementById("lcnt").innerHTML = "<b>" + num(rows.length) + "</b>件" +
      (rows.length ? '<span class="muted">（' + STACK.filter(function (o) { return cnt[o]; }).map(function (o) { return o + " " + num(cnt[o]); }).join("、") + "）</span>" : "");
    document.getElementById("lmini").innerHTML = rows.length ? '<div class="minibar" role="img" aria-label="結末の内訳">' + STACK.filter(function (o) { return cnt[o]; }).map(function (o) {
      return '<i data-o="' + o + '" style="flex:' + cnt[o] + ";background:var(" + OCOLOR[o] + ')"></i>';
    }).join("") + "</div>" : "";
    document.querySelectorAll("#lmini i").forEach(function (el) {
      var o = el.getAttribute("data-o"); bindTip(el, "<b>" + o + "</b><br>" + num(cnt[o]) + " 件（" + pctTxt(cnt[o], rows.length) + "）");
    });
    if (!rows.length) {
      body.innerHTML = '<section class="panel">' + emptyBox("条件に合う法案はありません",
        LS.kinds.length ? "キーワードを短くする、分野タグや会派を「すべて」にする、結末を「すべて」にするなどを試してください。" : "種類のチェックがすべて外れています。少なくとも1つ選んでください。",
        '<button type="button" class="btn primary" id="lreset">条件をリセット</button>') + "</section>";
      document.getElementById("lreset").onclick = function () { LS = { s: "all", mode: LS.mode }; saveLS(); drawList(); };
      return;
    }
    var per = LS.mode === "card" ? 48 : 100, pages = Math.max(1, Math.ceil(rows.length / per));
    if (LS.page >= pages) LS.page = 0;
    var p = LS.page, page = rows.slice(p * per, p * per + per);
    var h;
    if (LS.mode === "card") {
      h = '<div class="cards">' + page.map(billCard).join("") + "</div>";
    } else {
      h = '<div class="table-wrap"><table><thead><tr><th class="num">回次</th><th>種類</th><th>件名</th><th class="hide-sm">提出者・会派</th><th>結末</th>' +
        '<th class="hide-sm">提出日</th><th class="num">日数</th><th class="num hide-sm">会議録発言</th></tr></thead><tbody>' +
        page.map(function (r) {
          return "<tr><td class=num>" + r[X.session] + "</td><td class=nowrap>" + kindOf(r) +
            '</td><td class="t"><a href="#bill-' + r[X.id] + '">' + esc(r[X.title]) + "</a></td>" +
            '<td class="hide-sm">' + whoHtml(r, 2) + '<div class="chips" style="margin-top:3px">' + r[X.groups].map(function (g) { return pb(g); }).join("") + "</div></td><td>" + badge(outOf(r)) +
            '</td><td class="nowrap hide-sm">' + fmtShort(r[X.submitted]) +
            "</td><td class=num>" + (r[X.days] == null ? "—" : num(r[X.days])) + '</td><td class="num hide-sm">' +
            (r[X.speeches] == null ? '<span class="muted">未取得</span>' : num(r[X.speeches])) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    h += '<div class="pager"><button type="button" class="btn" id="pv"' + (p === 0 ? " disabled" : "") + '>前へ</button><span>' + (p + 1) + " / " + pages +
      " ページ</span><button type=\"button\" class=\"btn\" id=\"nx\"" + (p >= pages - 1 ? " disabled" : "") + ">次へ</button></div>" +
      '<p class="note">日数＝提出から結末（成立・否決・撤回）までの日数。廃案（審議未了）は元データに会期終了日がないため「—」です。分野タグは件名による自動分類。会派のバッジは提出会派（衆法のみ元データに記載）。</p>';
    body.innerHTML = h;
    document.getElementById("pv").onclick = function () { LS.page--; listPaint(); document.getElementById("lcnt").scrollIntoView({ block: "start" }); };
    document.getElementById("nx").onclick = function () { LS.page++; listPaint(); document.getElementById("lcnt").scrollIntoView({ block: "start" }); };
  }
  // 他のページから一覧の条件を指定して開く
  function openList(cond) {
    LS = { s: "all", kinds: KINDS.slice(), o: cond.o || "", q: cond.q || "", t: cond.t || "", g: cond.g || "", sort: LS.sort, mode: LS.mode, page: 0 };
    saveLS();
    if (location.hash === "#list") route(false); else location.hash = "#list";
  }
  // =====================================================================
  // 法案ページ
  // =====================================================================
  function unpack(b) {
    if (b._u) return b;
    b.events = b.events.map(function (e) {
      return { date: e[0], house: e[1], type: e[2], session: e[3], src: e[4], detail: e[5] };
    });
    b.links = b.links.map(function (l) { return { label: l[0], url: expandUrl(l[1]) }; });
    b.votesHC.forEach(function (v) { v.voteUrl = expandUrl(v.voteUrl); });
    b._u = true;
    return b;
  }
  function committee(c) { return /(委員会|会|調査会)$/.test(c) ? c : c + "委員会"; }
  function evText(e) {
    var d = e.detail;
    switch (e.type) {
      case "提出": return "提出";
      case "予備審査受理": return "予備審査のため受理";
      case "受理": return "議案を受理";
      case "予備付託": return "予備付託" + (d ? "（" + committee(d) + "）" : "");
      case "付託": return "委員会に付託" + (d ? "（" + committee(d) + "）" : "");
      case "委員会議決": return "委員会で議決" + (d ? "：" + d : "");
      case "本会議議決": return "本会議で議決" + (d ? "：" + d : "");
      case "公布": return "公布" + (d ? "（" + d + "）" : "");
      case "撤回": return "撤回";
      default: return e.type + (d ? "：" + d : "");
    }
  }
  function evShort(e) {
    var d = e.detail || "";
    switch (e.type) {
      case "予備審査受理": return "予備審査";
      case "受理": return "受理";
      case "予備付託": return "予備付託";
      case "付託": return d ? committee(d).replace(/委員会$/, "委") : "付託";
      case "委員会議決": return "委員会 " + d;
      case "本会議議決": return "本会議 " + d;
      default: return e.type;
    }
  }
  function houseName(h) { return h === "衆" ? "衆議院" : h === "参" ? "参議院" : "両院"; }
  function srcName(s) { return s === "算出" ? "両院データから算出" : s === "衆参" ? "衆・参データ" : s === "衆" ? "衆議院データ" : s === "参" ? "参議院データ" : s; }

  function renderBill(id) {
    var m = /^([ksa])(\d+)-(\d+)$/.exec(id);
    if (!m) { app.innerHTML = '<section class="panel">' + emptyBox("法案のIDが正しくありません", "法案一覧から選び直してください。", '<a class="btn" href="#list">法案一覧へ</a>') + "</section>"; return; }
    var s = +m[2];
    app.innerHTML = skeleton("法案の経過を読み込み中…");
    var p = DETAIL[s] ? Promise.resolve(DETAIL[s]) : getJSON("data/bills/s" + s + ".json").then(function (d) { DETAIL[s] = d; return d; });
    Promise.all([p, loadIndex()]).then(function (a) {
      var b = a[0].find(function (x) { return x.id === id; });
      if (!b) { app.innerHTML = '<section class="panel">' + emptyBox("この法案は見つかりませんでした", "第" + s + "回国会のデータに「" + id + "」がありません。法案一覧から選び直してください。", '<a class="btn" href="#list">法案一覧へ</a>') + "</section>"; return; }
      drawBill(unpack(b));
    }).catch(function (e) { app.innerHTML = errorBox(e); });
  }

  function houseSummary(b, H) {
    var ev = b.events.filter(function (e) { return e.house === H; });
    if (!ev.length) return null;
    var rec = ev.filter(function (e) { return e.type === "受理"; })[0] || ev.filter(function (e) { return e.type === "予備審査受理"; })[0] || ev[0];
    var com = ev.filter(function (e) { return e.type === "付託"; }).pop();
    var fl = ev.filter(function (e) { return e.type === "本会議議決"; }).pop();
    return { rec: rec, com: com, fl: fl, days: fl ? dayNum(fl.date) - dayNum(rec.date) : null };
  }
  function lastVoteHR(b) { var v = b.votesHR.filter(function (x) { return x.yes.length || x.no.length; }); return v[v.length - 1] || null; }
  // シェア用の文（元データの値だけ。評価の言葉は入れない）
  function billShareText(b, r) {
    var who = r[X.role] === 2 ? "内閣" : r[X.members].length ? IDX.members[r[X.members][0]][0] + "議員" + (r[X.members].length > 1 ? "ほか" + (r[X.members].length - 1) + "名" : "") : (b.submitter || "");
    var gs = b.submitterGroups.length ? "（" + b.submitterGroups.join("・") + "）" : "";
    var v = lastVoteHR(b);
    var t = "【" + b.title + "】" + b.kind + "・第" + b.session + "回国会提出／結末: " + b.outcome +
      (b.days != null ? "（提出から" + num(b.days) + "日）" : "") + "／提出: " + who + gs;
    if (v) t += "／衆院本会議: 賛成" + v.yes.length + "会派・反対" + v.no.length + "会派";
    return t + "（出典: 衆議院・参議院の議案データ）";
  }

  function drawBill(b) {
    document.title = b.title + "｜法案の生涯タイムライン";
    var r = R(BILLROW[b.id]);
    var endLabel = { "成立": "成立日", "否決": "否決日", "撤回": "撤回日" }[b.outcome] || "結末日";
    var ms = r ? r[X.members] : [], role = r ? r[X.role] : 3;
    var gsIdx = b.submitterGroups.map(function (g) { return GRPN[g]; }).filter(function (x) { return x != null; });
    // 提出者（名前を主役に）
    var who;
    if (role === 2) who = '<div class="names"><span class="cab">内閣</span></div>';
    else {
      var show = 12;
      who = '<div class="names">' + (role === 1 ? '<span class="cab">' + esc(b.submitter || (b.hc && b.hc.submitter) || "委員長") + "</span>" : "") +
        ms.slice(0, show).map(function (m, i) { return mlink(m, i === 0 && role !== 1 ? "" : "sm"); }).join("") +
        (ms.length > show ? '<span class="muted">ほか' + (ms.length - show) + "名（下の「提出者の詳細」に全員）</span>" : "") +
        (!ms.length && role !== 1 ? '<span class="muted">提出者の記載なし</span>' : "") + "</div>";
    }
    var groups = gsIdx.length ? '<div class="chips">' + gsIdx.map(function (g) { return pb(g, "lg"); }).join("") + "</div>" :
      (b.kind === "参法" ? '<span class="muted">参議院データには提出会派の記載がありません</span>' : "");
    var daysTxt = b.days != null ? num(b.days) + "<small>日</small>" : (b.daysToLastEvent != null ? "—" : "—");
    var dlTxt = b.days != null ? "提出から" + (b.outcome === "成立" ? "成立" : b.outcome) + "まで<br>" + fmtShort(b.submitted) + " → " + fmtShort(b.endDate) :
      (b.outcome === "廃案" ? "廃案（審議未了）は会期終了日が元データにないため日数なし" + (b.daysToLastEvent != null ? "<br>最後の記録まで " + num(b.daysToLastEvent) + " 日" : "") :
        (b.daysToLastEvent != null ? "最後の記録まで " + num(b.daysToLastEvent) + " 日" : ""));
    var share = billShareText(b, r || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, [], role, [], [], [], [], "", ""]);
    var h = '<p class="bk"><a href="#list">← 法案一覧へ</a></p>' +
      '<section class="bill-top"><div class="chips"><a class="tg k" href="#tag-' + IDX.tags[TAG[{ "閣法": "kind-kakuho", "衆法": "kind-shuho", "参法": "kind-sanho" }[b.kind]]][0] + '">' + b.kind + "（" + KIND_LONG[b.kind] + '）</a><span class="chip">第' + b.session + "回国会 第" + b.number + "号</span>" +
      (r ? policyTags(r).map(function (t) { return tlink(t); }).join("") : "") + '<span class="muted">（分野は自動分類）</span></div>' +
      "<h1>" + esc(b.title) + "</h1>" +
      '<div class="bill-res">' + badge(b.outcome, "stamp") + '<div class="days">' + daysTxt + '</div><div class="dl">' + dlTxt + "</div></div>" +
      '<div class="who-big"><span class="lbl">' + (role === 1 ? "提出者（委員長提出。名前は元データの提出者一覧）" : "提出者") + "</span>" + who +
      (gsIdx.length || b.kind === "参法" ? '<span class="lbl">提出会派</span>' + groups : "") + "</div>" +
      shareBlock(share, "bill-" + b.id) + "</section>";

    // まとめカード（スクリーンショット用）
    var v = lastVoteHR(b);
    h += '<section class="sec" style="margin-top:0"><div class="sec-hd"><h2>まとめカード</h2><p>スクリーンショットでそのまま共有できる形</p></div>' +
      '<div class="scard" id="scard"><div class="sc-k"><span class="chip">' + b.kind + "・第" + b.session + "回国会 第" + b.number + "号</span>" + badge(b.outcome) +
      (r ? policyTags(r).map(function (t) { return '<span class="tg">' + esc(IDX.tags[t][1]) + "</span>"; }).join("") : "") + "</div>" +
      '<p class="sc-t">' + esc(b.title) + "</p>" +
      '<div class="sc-m"><div class="sc-big">' + (b.days != null ? num(b.days) + "<small>日</small>" : esc(b.outcome)) + "</div>" +
      '<div class="sc-who"><span>' + (b.days != null ? "提出 " + fmtShort(b.submitted) + " → " + b.outcome + " " + fmtShort(b.endDate) : "提出 " + fmtShort(b.submitted)) + "</span>" +
      "<span>提出: <b>" + (role === 2 ? "内閣</b>" : ms.length ? esc(IDX.members[ms[0]][0]) + (ms.length > 1 ? "</b> ほか" + (ms.length - 1) + "名" : "</b>") : esc(b.submitter || "—") + "</b>") + "</span>" +
      (gsIdx.length ? '<div class="chips">' + gsIdx.map(function (g) { return pb(g, "", "", true); }).join("") + "</div>" : "") + "</div></div>" +
      (v ? '<div class="sc-v"><div><span class="yn y"><i></i>衆院本会議で賛成 ' + v.yes.length + "会派</span>" + v.yes.map(function (g) { return GRPN[g] != null ? pb(GRPN[g], "", "", true) : esc(g); }).join("") +
        '</div><div><span class="yn n"><i></i>反対 ' + v.no.length + "会派</span>" + (v.no.length ? v.no.map(function (g) { return GRPN[g] != null ? pb(GRPN[g], "", "", true) : esc(g); }).join("") : '<span class="muted">なし</span>') + "</div></div>" :
        '<div class="sc-v"><div class="muted">衆議院データに会派別の賛否の記載なし</div></div>') +
      '<div class="sc-s"><span>出典: 国会議案データベース（衆議院・参議院の議案データ）</span><b>法案の生涯タイムライン</b></div></div></section>';

    h += '<section class="panel"><div class="panel-hd"><h2>経過の要点</h2></div><p class="muted" style="margin:0">' + esc(ODESC[b.outcome] || b.outcome) + "（元データの最終審議状況: " + esc(b.status || "記載なし") + "）</p>" +
      '<dl class="facts">' +
      fact("提出から" + (b.outcome === "成立" ? "成立" : "結末") + "まで", b.days != null ? num(b.days) + "<small> 日</small>" : (b.daysToLastEvent != null ? "—<small>（最後の記録まで " + num(b.daysToLastEvent) + " 日）</small>" : "—")) +
      fact("提出日", fmtDate(b.submitted)) +
      fact(endLabel, b.endDate ? fmtDate(b.endDate) : (b.outcome === "廃案" ? "<small>元データに日付なし（会期終了）</small>" : "—")) +
      fact("公布", b.promulgated ? fmtDate(b.promulgated) + (b.lawNo ? "<br><small>" + esc(b.lawNo) + "</small>" : "") : "—") +
      "</dl>";
    var hs = [["衆", "hr"], ["参", "hc"]].map(function (x) {
      var s = houseSummary(b, x[0]);
      if (!s) return '<div class="' + x[1] + '">' + houseName(x[0]) + '：<span class="muted">記録なし</span></div>';
      return '<div class="' + x[1] + '">' + houseName(x[0]) + "：" + (s.days != null ? "受理から本会議まで <b>" + num(s.days) + "</b> 日" : "本会議の議決なし") +
        '<br><span class="muted">' + (s.com ? esc(committee(s.com.detail || "")) + "で審査" : "付託の記録なし") + (s.fl ? "・本会議 " + fmtShort(s.fl.date) + " " + esc(s.fl.detail || "") : "") + "</span></div>";
    });
    h += '<div class="house-sum">' + hs.join("") + "</div></section>";

    var wide = (app.clientWidth || window.innerWidth) >= 680;
    h += '<section class="panel"><div class="panel-hd"><h2>経過のタイムライン</h2><p>第' + b.sessions.join("・") + "回国会に記録</p></div>" +
      '<div class="legend"><span><i class="sw" style="background:var(--hr)"></i>衆議院</span><span><i class="sw" style="background:var(--hc)"></i>参議院</span>' +
      '<span><i class="sw" style="background:var(--common)"></i>提出・公布</span>' +
      (wide ? '<span>細い線＝付託待ち　太い帯＝委員会で審査中　◆＝本会議の議決</span>' : '<span>○ 受理・付託　● 委員会の議決　◆ 本会議の議決</span>') + "</div>" +
      (wide ? '<div class="chart" id="tl"></div><details class="more"><summary>経過を日付順の一覧で見る（' + b.events.length + "件）</summary>" + vtimeline(b) + "</details>" : vtimeline(b)) +
      '<p class="note">' + (wide ? "印にカーソルを合わせる（タップする）と内容を表示。背景の帯は各国会で記録がある期間です（会期そのものではありません）。" : "") +
      "出典: 衆議院・参議院の議案データ。</p></section>";

    h += '<section class="panel"><div class="panel-hd"><h2>会派ごとの賛否</h2></div><div class="votes"><div><h3 style="margin-top:0">衆議院 本会議</h3>' + votesHR(b) +
      '</div><div><h3 style="margin-top:0">参議院 本会議</h3>' + votesHC(b) + "</div></div></section>";

    h += '<section class="panel"><div class="panel-hd"><h2>提出者の詳細</h2></div><p style="margin:0">元データの提出者: ' + esc(b.submitter || "—") + "</p>" +
      (b.submitterList ? '<details class="more"' + (ms.length <= 12 ? "" : " open") + '><summary>提出者一覧（' + ms.length + "名）</summary><p class=\"chips\">" + ms.map(function (m) { return mlink(m); }).join("　") + "</p></details>" : "") +
      (b.supporters ? '<details class="more"><summary>議案提出の賛成者</summary><p>' + esc(b.supporters) + "</p></details>" : "") +
      (b.hc && (b.hc.proposer || b.hc.submitter) ? '<p class="muted">参議院データ: ' + esc([b.hc.category, b.hc.proposer, b.hc.submitter].filter(Boolean).join("／")) + "</p>" : "") +
      (b.hc && b.hc.remarks ? '<details class="more"><summary>参議院データの備考</summary><p style="white-space:pre-wrap">' + esc(b.hc.remarks) + "</p></details>" : "") +
      "</section>";

    h += '<section class="panel"><div class="panel-hd"><h2>国会会議録での言及</h2></div>' + mentionsHtml(b) + "</section>";
    h += '<section class="panel"><div class="panel-hd"><h2>出典：衆議院・参議院の議案ページ</h2><p>外部サイトが開きます</p></div><ul class="links">' +
      b.links.map(function (l) { return '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + "</a></li>"; }).join("") +
      "</ul></section>";
    app.innerHTML = h;
    if (wide) drawTimeline(document.getElementById("tl"), b);
  }
  function fact(k, v, hero) { return "<div><dt>" + k + "</dt><dd" + (hero ? ' class="hero"' : "") + ">" + v + "</dd></div>"; }

  // 縦タイムライン（日付｜衆議院｜参議院）。間隔が空いた所に「n日」を挟む
  function vtimeline(b) {
    var h = '<div class="vt-head"><span>日付</span><span class="hr">衆議院</span><span class="hc">参議院</span></div><ol class="vt">';
    var prev = null, prevSes = null;
    b.events.forEach(function (e) {
      if (prevSes !== null && e.session !== prevSes) h += '<li class="ses"><div>第' + e.session + "回国会に継続</div></li>";
      if (prev && e.date !== prev) {
        var g = dayNum(e.date) - dayNum(prev);
        if (g >= 7) h += '<li class="gap"><div class="d">' + num(g) + '日後</div><div class="c hr"></div><div class="c hc"></div></li>';
      }
      var cls = e.house === "衆" ? "hr" : e.house === "参" ? "hc" : "cm";
      var shape = e.type === "本会議議決" ? " sq" : (/議決/.test(e.type) || e.type === "提出" || e.type === "公布" || e.type === "撤回") ? " solid" : "";
      var cell = '<div class="c ' + cls + " ev" + shape + '">' + esc(evText(e)) + "</div>";
      var d = '<div class="d">' + fmtShort(e.date).slice(5) + "<small>" + e.date.slice(0, 4) + "</small></div>";
      if (cls === "hr") h += "<li>" + d + cell + '<div class="c hc"></div></li>';
      else if (cls === "hc") h += "<li>" + d + '<div class="c hr"></div>' + cell + "</li>";
      else h += "<li>" + d + cell + "</li>";
      prev = e.date; prevSes = e.session;
    });
    return h + "</ol>";
  }

  function votesHR(b) {
    if (!b.votesHR.length) return '<p class="muted">衆議院データに会派別の賛否の記載がありません' + (b.session < 187 ? "（会派別の記録は第187回国会以降）" : "") + "。</p>";
    return b.votesHR.map(function (v) {
      var ny = v.yes.length, nn = v.no.length, t = ny + nn;
      var h = '<p class="vote-meta"><b>第' + v.session + "回 " + fmtShort(v.date) + " " + esc(v.result) + "</b>" + (v.manner ? "（" + esc(v.manner) + "）" : "") + "</p>";
      if (t) {
        h += '<div class="vote-sum" role="img" aria-label="賛成' + ny + "会派、反対" + nn + '会派">' +
          (ny ? '<i class="y" style="flex:' + ny + '"></i>' : "") + (nn ? '<i class="n" style="flex:' + nn + '"></i>' : "") + "</div>" +
          '<div class="vote-key"><span class="yn y"><i></i>賛成 ' + ny + ' 会派</span><span class="yn n"><i></i>反対 ' + nn + " 会派</span><span class=muted>（会派の数。議席数ではありません）</span></div>" +
          '<div class="vcols"><div><span class="yn y"><i></i>賛成</span>' + (ny ? v.yes.map(function (g) { return pbName(g); }).join("") : '<span class="muted">なし</span>') +
          '</div><div><span class="yn n"><i></i>反対</span>' + (nn ? v.no.map(function (g) { return pbName(g); }).join("") : '<span class="muted">なし</span>') + "</div></div>";
      }
      return h;
    }).join('<hr style="border:0;border-top:1px solid var(--rule);margin:14px 0">');
  }
  function votesHC(b) {
    if (!b.votesHC.length) return '<p class="muted">参議院データに本会議の採決の記載がありません' + (b.inHC ? "" : "（参議院データ〈第153回以降〉にこの法案がありません）") + "。</p>";
    return b.votesHC.map(function (v) {
      return '<p class="vote-meta"><b>第' + v.session + "回 " + fmtShort(v.date) + " " + esc(v.result || "") + "</b>" + (v.manner ? "（" + esc(v.manner) + "）" : "") +
        (v.method ? "<br>採決方法: " + esc(v.method) : "") + "</p>" +
        (v.voteUrl ? '<p style="margin:6px 0 0"><a href="' + esc(v.voteUrl) + '" target="_blank" rel="noopener">参議院の投票結果（会派・議員別）</a></p>' : "");
    }).join("") + '<p class="note">参議院データには会派別の賛否の列がありません。押しボタン投票の場合は、参議院の投票結果ページで会派・議員別に確認できます。</p>';
  }

  function mentionsHtml(b) {
    var m = b.mentions;
    if (!m) return '<p><span class="missing">未取得</span></p>' +
      '<p class="note">自動更新（GitHub Actions）が国会会議録検索システムの検索用APIで件名を検索し、発言数と会議の一覧を順次取得します。</p>';
    var q = m.query || {};
    var api = "https://kokkai.ndl.go.jp/api/speech?any=" + encodeURIComponent(q.any || b.title) + "&sessionFrom=" + q.sessionFrom +
      "&sessionTo=" + q.sessionTo + "&recordPacking=json&maximumRecords=100";
    var h = '<div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0 0 12px">' +
      kpi("件名を含む発言", num(m.speeches) + "<small>件</small>", "第" + q.sessionFrom + (q.sessionTo !== q.sessionFrom ? "〜" + q.sessionTo : "") + "回国会の会議録") +
      kpi("発言があった会議", num(m.meetingsInScanned) + (m.partial ? "<small>+</small>" : ""), m.partial ? "先頭 " + num(m.speechesScanned) + " 発言の範囲で集計" : "全発言から集計") + "</div>";
    if (m.meetings && m.meetings.length) {
      var mx = Math.max.apply(null, m.meetings.map(function (x) { return x.n; })) || 1;
      h += '<div class="table-wrap"><table class="mtable"><thead><tr><th>日付</th><th>会議</th><th class="num">該当発言</th><th>会議録</th></tr></thead><tbody>' +
        m.meetings.map(function (x) {
          return '<tr><td class="nowrap">' + fmtShort(x.date) + "</td><td>" + esc(x.house) + " " + esc(x.meeting) + " " + esc(x.issue) +
            '</td><td class="num"><span style="display:inline-block;width:' + Math.round(x.n / mx * 40) + 'px;height:6px;border-radius:3px;background:var(--bar);margin-right:6px;vertical-align:middle"></span>' + x.n +
            '</td><td class="nowrap"><a href="' + esc(x.url) + '" target="_blank" rel="noopener">原文</a>／<a href="' +
            esc(x.firstSpeechUrl) + '" target="_blank" rel="noopener">該当発言</a></td></tr>';
        }).join("") + "</tbody></table></div>";
    }
    h += '<p class="note">検索条件: 件名「' + esc(q.any) + "」を含む発言（会議録冒頭の議事日程等を含む）。取得日時: " + esc(m.fetchedAt) +
      (m.via !== "github-actions" ? "（構築時に試験取得した値。次回の自動更新で置き換わります）" : "") +
      '。<a href="' + esc(api) + '" target="_blank" rel="noopener">APIの検索結果（JSON）</a>。出典: 国会会議録検索システム（国立国会図書館）。</p>';
    return h;
  }

  // 横向きタイムライン SVG: 上段＝提出・公布、中段＝衆議院、下段＝参議院
  function drawTimeline(el, b) {
    var ev = b.events;
    if (!ev.length) { el.innerHTML = emptyBox("日付の記録がありません", "元データに経過の日付がない法案です。"); return; }
    var t0 = dayNum(ev[0].date), t1 = dayNum(ev[ev.length - 1].date);
    if (t1 - t0 < 21) { var pad = (21 - (t1 - t0)) / 2; t0 -= pad; t1 += pad; } // 短すぎる期間は最低3週間の幅で表示
    var span = Math.max(1, t1 - t0);
    var W = Math.max(600, el.clientWidth || 900);
    var m = { l: 72, r: 34 };
    var iw = W - m.l - m.r;
    var lanes = [
      { k: "衆", name: "衆議院", y: 86, c: css("--hr") },
      { k: "参", name: "参議院", y: 170, c: css("--hc") }
    ];
    var axisY = 222, H = 250;
    function X(d) { return m.l + (dayNum(d) - t0) / span * iw; }
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img",
      "aria-label": b.title + " の経過タイムライン（" + fmtDate(ev[0].date) + "〜" + fmtDate(ev[ev.length - 1].date) + "）" });
    var card = css("--card"), grid = css("--grid"), ink2 = css("--ink-2"), common = css("--common");

    // 国会ごとの記録期間の帯
    var bySes = {}, order = [];
    ev.forEach(function (e) { if (!bySes[e.session]) { bySes[e.session] = [e.date, e.date]; order.push(e.session); } var s = bySes[e.session]; if (e.date < s[0]) s[0] = e.date; if (e.date > s[1]) s[1] = e.date; });
    var lastSesX = -1e9, sesLabels = [];
    order.forEach(function (s, i) {
      var x0 = X(bySes[s][0]) - 8, x1 = X(bySes[s][1]) + 8;
      svg.appendChild(svgEl("rect", { x: x0, y: 50, width: Math.max(16, x1 - x0), height: axisY - 50, rx: 6, fill: grid, opacity: i % 2 ? 0.55 : 0.9 }));
      if (order.length > 1 && x0 - lastSesX > 50) { sesLabels.push(svgEl("text", { x: x0 + 4, y: axisY - 6, "font-size": 11 }, "第" + s + "回")); lastSesX = x0; }
    });
    sesLabels.forEach(function (t) { svg.appendChild(t); });
    // 月の目盛り
    monthTicks(t0, t1, iw).forEach(function (t) {
      var x = m.l + (t.n - t0) / span * iw;
      svg.appendChild(svgEl("line", { x1: x, x2: x, y1: axisY, y2: axisY + 5, stroke: css("--ink-3") }));
      svg.appendChild(svgEl("text", { x: x, y: axisY + 18, "text-anchor": "middle" }, t.label));
    });
    svg.appendChild(svgEl("line", { x1: m.l - 8, x2: W - m.r + 8, y1: axisY, y2: axisY, stroke: css("--rule") }));

    // 提出・公布・撤回など（両院共通）は縦の点線＋上部ラベル
    var topLabels = [];
    ev.filter(function (e) { return !e.house; }).forEach(function (e) {
      var x = X(e.date);
      svg.appendChild(svgEl("line", { x1: x, x2: x, y1: 36, y2: axisY, stroke: common, "stroke-dasharray": "3 3", "stroke-width": 1 }));
      var g = svgEl("g", {});
      g.appendChild(svgEl("circle", { cx: x, cy: 36, r: 5, fill: common, stroke: card, "stroke-width": 2 }));
      var hit = svgEl("circle", { cx: x, cy: 36, r: 13, "class": "hit" });
      bindTip(hit, "<b>" + fmtDate(e.date) + "</b><br>" + esc(evText(e)));
      g.appendChild(hit); svg.appendChild(g);
      var lbl = (e.type === "提出" ? "提出" : e.type) + " " + fmtShort(e.date);
      var wTxt = lbl.length * 7 + 6;
      var anchor = x - wTxt / 2 < 4 ? "start" : x + wTxt / 2 > W - 4 ? "end" : "middle";
      var xa = anchor === "start" ? x - 4 : anchor === "end" ? x + 4 : x - wTxt / 2;
      var row = 0; while (topLabels.some(function (L) { return L.row === row && !(xa + wTxt < L.a || xa > L.b); }) && row < 1) row++;
      if (topLabels.some(function (L) { return L.row === row && !(xa + wTxt < L.a || xa > L.b); })) return;
      topLabels.push({ row: row, a: xa, b: xa + wTxt });
      svg.appendChild(svgEl("text", { x: anchor === "start" ? x - 4 : anchor === "end" ? x + 4 : x, y: 22 - row * 0 - (row ? -0 : 0) + (row ? 0 : 0) - (row * 12), "text-anchor": anchor, "class": "lab" }, lbl));
    });

    lanes.forEach(function (L) {
      svg.appendChild(svgEl("text", { x: 8, y: L.y + 4, "class": "ttl", fill: L.c }, L.name));
      svg.appendChild(svgEl("line", { x1: m.l - 8, x2: W - m.r + 8, y1: L.y, y2: L.y, stroke: css("--rule"), "stroke-width": 1 }));
      var le = ev.filter(function (e) { return e.house === L.k; });
      if (!le.length) { svg.appendChild(svgEl("text", { x: m.l, y: L.y - 8, "font-size": 11 }, "この院の記録はありません")); return; }
      // 段階の帯: 受理→付託＝細線、付託→委員会議決＝太帯、委員会議決→本会議＝中線、回次をまたぐ＝点線
      for (var i = 0; i < le.length - 1; i++) {
        var a = le[i], z = le[i + 1], xa = X(a.date), xz = X(z.date);
        if (xz - xa < 0.5) continue;
        var cont = a.session !== z.session;
        var kind = cont ? "cont" : a.type === "付託" ? "com" : a.type === "委員会議決" ? "floor" : (a.type === "本会議議決" ? "after" : "wait");
        var hgt = { com: 12, floor: 5, wait: 3, after: 2, cont: 2 }[kind];
        var seg = svgEl("rect", { x: xa, y: L.y - hgt / 2, width: xz - xa, height: hgt, rx: Math.min(3, hgt / 2), fill: L.c,
          opacity: kind === "wait" || kind === "after" ? 0.45 : kind === "cont" ? 0.35 : 1 });
        svg.appendChild(seg);
        if (kind === "com" && xz - xa > 4) {
          (function (a, z) {
            var hit = svgEl("rect", { x: xa, y: L.y - 10, width: xz - xa, height: 20, "class": "hit" });
            bindTip(hit, "<b>" + houseName(L.k) + "・委員会で審査</b><br>" + esc(committee(a.detail || "")) + "<br>" + fmtShort(a.date) + " 〜 " + fmtShort(z.date) + "（" + num(dayNum(z.date) - dayNum(a.date)) + "日）");
            svg.appendChild(hit);
          })(a, z);
        }
      }
      // 印とラベル（ラベルは重ならない位置の段に置き、置けなければ省略＝ツールチップで見る）
      var rows = [[], []], stack = {};
      le.forEach(function (e) {
        var x = X(e.date), key = e.date;
        var off = stack[key] || 0; stack[key] = off + 1;
        var y = L.y - off * 0;
        var xs = x + off * 7;
        var g = svgEl("g", {});
        if (e.type === "本会議議決") {
          g.appendChild(svgEl("rect", { x: xs - 6, y: y - 6, width: 12, height: 12, rx: 2, fill: L.c, stroke: card, "stroke-width": 2, transform: "rotate(45 " + xs + " " + y + ")" }));
        } else {
          var solid = /議決/.test(e.type) || e.type === "撤回";
          g.appendChild(svgEl("circle", { cx: xs, cy: y, r: 5.5, fill: solid ? L.c : card, stroke: solid ? card : L.c, "stroke-width": 2 }));
        }
        var hit = svgEl("circle", { cx: xs, cy: y, r: 13, "class": "hit" });
        bindTip(hit, "<b>" + fmtDate(e.date) + "</b><br>" + houseName(e.house) + "：" + esc(evText(e)) + "<br><span style=\"color:var(--ink-3)\">第" + e.session + "回国会・出典: " + srcName(e.src) + "</span>");
        g.appendChild(hit);
        svg.appendChild(g);
        if ((e.type === "受理" || e.type === "予備審査受理") && le.length > 3) return; // 記録が多いときは受理は印のみ
        var lbl = evShort(e), dl = fmtMD(e.date);
        var wTxt = Math.max(lbl.length * 11.5, dl.length * 7) + 8;
        var anchor = xs - wTxt / 2 < 2 ? "start" : xs + wTxt / 2 > W - 2 ? "end" : "middle";
        var a0 = anchor === "start" ? xs - 4 : anchor === "end" ? xs - wTxt + 4 : xs - wTxt / 2;
        var placed = -1;
        for (var r = 0; r < rows.length; r++) {
          if (!rows[r].some(function (iv) { return !(a0 + wTxt < iv[0] || a0 > iv[1]); })) { placed = r; break; }
        }
        if (placed < 0) return;
        rows[placed].push([a0, a0 + wTxt]);
        var tx = anchor === "start" ? xs - 4 : anchor === "end" ? xs + 4 : xs;
        var above = placed === 0;
        var ly = above ? y - 26 : y + 22;
        svg.appendChild(svgEl("text", { x: tx, y: ly, "text-anchor": anchor, "class": "lab" }, lbl));
        svg.appendChild(svgEl("text", { x: tx, y: ly + 13, "text-anchor": anchor, "font-size": 10.5 }, dl));
      });
    });
    el.innerHTML = ""; el.appendChild(svg);
  }
  function monthTicks(t0, t1, iw) {
    var a = new Date(t0 * 864e5), z = new Date(t1 * 864e5);
    var months = (z.getUTCFullYear() - a.getUTCFullYear()) * 12 + z.getUTCMonth() - a.getUTCMonth() + 1;
    var maxTicks = Math.max(2, Math.floor(iw / 80));
    var step = [1, 2, 3, 6, 12, 24, 36, 60].find(function (s) { return months / s <= maxTicks; }) || 60;
    var out = [], y = a.getUTCFullYear(), mo = a.getUTCMonth() + 1;
    if (step >= 12) { mo = 0; y += 1; } else { mo = Math.ceil(mo / step) * step; }
    for (var i = 0; i < 200; i++) {
      var yy = y + Math.floor(mo / 12), mm = mo % 12;
      var n = Date.UTC(yy, mm, 1) / 864e5;
      if (n > t1) break;
      if (n >= t0) out.push({ n: n, label: (mm === 0 || step >= 12 || !out.length) ? yy + "年" + (mm + 1) + "月" : (mm + 1) + "月" });
      mo += step;
    }
    return out;
  }

  // =====================================================================
  // 共通部品（議員・会派・タグのページ）
  // =====================================================================
  function outCount(ris) { var c = {}; ris.forEach(function (ri) { var o = cat(outOf(R(ri))); c[o] = (c[o] || 0) + 1; }); return c; }
  function outBar(c, total) {
    return '<div class="minibar" role="img" aria-label="結末の内訳">' + STACK.filter(function (o) { return c[o]; }).map(function (o) {
      return '<i data-o="' + o + '" style="flex:' + c[o] + ";background:var(" + OCOLOR[o] + ')"></i>';
    }).join("") + '</div><div class="lifeline-key">' + STACK.filter(function (o) { return c[o]; }).map(function (o) {
      return "<span>" + sw(o) + o + "<b>" + num(c[o]) + "</b>件（" + pctTxt(c[o], total) + "）</span>";
    }).join("") + "</div>";
  }
  function bindOutBar(scope, c, total) {
    scope.querySelectorAll(".minibar i").forEach(function (el) {
      var o = el.getAttribute("data-o"); bindTip(el, "<b>" + o + "</b><br>" + num(c[o]) + " 件（" + pctTxt(c[o], total) + "）");
    });
  }
  function stat(v, unit, label) { return "<div><b>" + v + (unit ? "<small>" + unit + "</small>" : "") + "</b><span>" + label + "</span></div>"; }
  function billLi(ri, note, noWho) {
    var r = R(ri), gs = r[X.groups].map(function (g) { return pb(g); }).join("");
    return '<li>' + badge(outOf(r)) + '<a class="t" href="#bill-' + r[X.id] + '">' + esc(r[X.title]) + '</a><span class="d">' + (r[X.days] != null ? num(r[X.days]) + "日" : "") + "</span>" +
      '<span class="m">' + kindOf(r) + "・第" + r[X.session] + "回 " + fmtShort(r[X.submitted]) + " 提出" + (note ? "・" + note : "") + "　" + (noWho ? (r[X.members].length > 1 ? '<span class="muted">提出者' + r[X.members].length + "名</span> " : "") : whoHtml(r, 2) + " ") + gs + "</span></li>";
  }
  // 法案の一覧（per 件ずつ「さらに表示」）
  function pagedList(el, ris, per, note, noWho) {
    var shown = 0;
    el.innerHTML = '<ol class="blist"></ol><p class="more-p" style="margin:10px 0 0"></p>';
    var ol = el.querySelector("ol"), mp = el.querySelector(".more-p");
    function more() {
      var next = ris.slice(shown, shown + per);
      ol.insertAdjacentHTML("beforeend", next.map(function (ri) { return billLi(ri, note ? note(ri) : "", noWho); }).join(""));
      shown += next.length;
      mp.innerHTML = shown < ris.length ? '<button type="button" class="btn">さらに表示（残り' + num(ris.length - shown) + "件）</button>" : "";
      var b = mp.querySelector("button"); if (b) b.onclick = more;
    }
    if (!ris.length) { el.innerHTML = emptyBox("該当する法案はありません", ""); return; }
    more();
  }
  // 回次ごとの件数（結末別の積み上げ棒）
  function sesBars(el, ris) {
    if (!ris.length) { el.innerHTML = emptyBox("法案がありません", ""); return; }
    var by = {}, lo = 1e9, hi = 0;
    ris.forEach(function (ri) { var r = R(ri), s = r[X.session]; lo = Math.min(lo, s); hi = Math.max(hi, s); var b = by[s] = by[s] || { t: 0 }; var o = cat(outOf(r)); b[o] = (b[o] || 0) + 1; b.t++; });
    var ss = SESS().filter(function (s) { return s >= lo && s <= hi; });
    var W = Math.max(300, el.clientWidth || 600), H = 190, m = { l: 34, r: 8, t: 20, b: 30 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b, n = ss.length, bw = iw / n, w = Math.min(36, Math.max(2, bw - (bw > 6 ? 2 : 0.5)));
    var ticks = niceTicks(Math.max.apply(null, ss.map(function (s) { return by[s] ? by[s].t : 0; })) || 1), top = ticks[ticks.length - 1];
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": "国会回次ごとの法案の数（結末別）" });
    svg.appendChild(svgEl("text", { x: m.l, y: 11, "class": "ttl" }, "法案の数（件）"));
    ticks.forEach(function (t) {
      var y = m.t + ih - t / top * ih;
      svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: t ? css("--grid") : css("--ink") }));
      svg.appendChild(svgEl("text", { x: m.l - 6, y: y + 4, "text-anchor": "end" }, t));
    });
    var lastX = -1e9;
    ss.forEach(function (s, i) {
      var b = by[s], x = m.l + i * bw + (bw - w) / 2, y0 = m.t + ih;
      if (b) STACK.filter(function (o) { return b[o]; }).forEach(function (o) {
        var hh = b[o] / top * ih;
        svg.appendChild(svgEl("rect", { x: x, y: y0 - hh, width: w, height: Math.max(0.8, hh - (hh > 3 ? 1 : 0)), fill: css(OCOLOR[o]), stroke: css("--ink"), "stroke-width": o === "成立" ? 0 : 0.6 }));
        y0 -= hh;
      });
      var cx = m.l + i * bw + bw / 2;
      if ((n <= 14 || s % 10 === 0 || i === 0 || i === n - 1) && cx - lastX > 28) { svg.appendChild(svgEl("text", { x: cx, y: H - m.b + 15, "text-anchor": "middle" }, s)); lastX = cx; }
      var hit = svgEl("rect", { x: m.l + i * bw, y: m.t, width: bw, height: ih, "class": "hit" });
      bindTip(hit, function () {
        if (!b) return "<b>第" + s + "回国会</b><br>0 件";
        return "<b>第" + s + "回国会</b>" + STACK.filter(function (o) { return b[o]; }).map(function (o) { return '<div class="r"><span>' + sw(o) + o + "</span><span>" + num(b[o]) + "</span></div>"; }).join("") +
          '<div class="r"><span>計</span><span>' + num(b.t) + " 件</span></div>";
      });
      svg.appendChild(hit);
    });
    svg.appendChild(svgEl("text", { x: W - m.r, y: H - 2, "text-anchor": "end" }, "国会回次 →"));
    el.innerHTML = ""; el.appendChild(svg);
  }
  // 会派の賛成率の推移（衆議院本会議）。2系列（閣法・議員立法）、縦軸は1本（0〜100%）
  function rateLine(el, gv) {
    var ss = Object.keys(gv || {}).map(Number).sort(function (a, b) { return a - b; });
    if (!ss.length) { el.innerHTML = emptyBox("衆議院本会議の会派別の賛否の記録がありません", "会派別の記録があるのは第187回国会以降です。"); return; }
    var all = SESS().filter(function (s) { return s >= ss[0] && s <= ss[ss.length - 1]; });
    var W = Math.max(300, el.clientWidth || 600), H = 240, m = { l: 40, r: 12, t: 22, b: 30 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b, n = all.length, step = n > 1 ? iw / (n - 1) : 0;
    var X0 = function (i) { return n > 1 ? m.l + i * step : m.l + iw / 2; };
    var Y = function (p) { return m.t + ih - p / 100 * ih; };
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": "回次ごとの賛成率（閣法・議員立法）" });
    svg.appendChild(svgEl("text", { x: m.l, y: 11, "class": "ttl" }, "賛成率（%）"));
    [0, 25, 50, 75, 100].forEach(function (t) {
      svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: t ? css("--grid") : css("--ink"), "stroke-dasharray": t === 50 ? "3 3" : null }));
      svg.appendChild(svgEl("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end" }, t));
    });
    var series = [{ k: 0, name: "閣法", dash: null }, { k: 2, name: "議員立法", dash: "6 4" }];
    var ink = css("--ink"), card = css("--card");
    series.forEach(function (S) {
      var d = "", pen = false;
      all.forEach(function (s, i) {
        var c = gv[s], t = c ? c[S.k] + c[S.k + 1] : 0;
        if (!t) { pen = false; return; }
        var p = c[S.k] / t * 100;
        d += (pen ? "L" : "M") + X0(i).toFixed(1) + "," + Y(p).toFixed(1); pen = true;
      });
      svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: ink, "stroke-width": 2, "stroke-dasharray": S.dash, "stroke-linejoin": "round" }));
      all.forEach(function (s, i) {
        var c = gv[s], t = c ? c[S.k] + c[S.k + 1] : 0;
        if (!t) return;
        var p = c[S.k] / t * 100;
        svg.appendChild(svgEl("circle", { cx: X0(i), cy: Y(p), r: 4, fill: S.dash ? card : ink, stroke: S.dash ? ink : card, "stroke-width": 2 }));
      });
    });
    var lastX = -1e9;
    all.forEach(function (s, i) {
      var x = X0(i);
      if ((n <= 14 || s % 5 === 0 || i === 0 || i === n - 1) && x - lastX > 30) { svg.appendChild(svgEl("text", { x: x, y: H - m.b + 16, "text-anchor": "middle" }, s)); lastX = x; }
      var hw = n > 1 ? step : iw;
      var hit = svgEl("rect", { x: x - hw / 2, y: m.t, width: hw, height: ih, "class": "hit" });
      bindTip(hit, function () {
        var c = gv[s];
        if (!c) return "<b>第" + s + "回国会</b><br>記録なし";
        return "<b>第" + s + "回国会</b>" + series.map(function (S) {
          var t = c[S.k] + c[S.k + 1];
          return '<div class="r"><span>' + S.name + "</span><span>" + (t ? pctTxt(c[S.k], t) + "（賛成" + c[S.k] + "／反対" + c[S.k + 1] + "）" : "採決なし") + "</span></div>";
        }).join("");
      });
      svg.appendChild(hit);
    });
    svg.appendChild(svgEl("text", { x: W - m.r, y: H - 2, "text-anchor": "end" }, "国会回次 →"));
    el.innerHTML = ""; el.appendChild(svg);
  }
  function gvTotal(gv) { var t = [0, 0, 0, 0], a = 1e9, b = 0; Object.keys(gv || {}).forEach(function (s) { gv[s].forEach(function (v, i) { t[i] += v; }); a = Math.min(a, +s); b = Math.max(b, +s); }); return { ky: t[0], kn: t[1], gy: t[2], gn: t[3], y: t[0] + t[2], n: t[1] + t[3], a: a, b: b }; }
  function withIndex(fn) {
    return function (arg) {
      app.innerHTML = skeleton("読み込み中…");
      loadIndex().then(function () { fn(arg); }).catch(function (e) { app.innerHTML = errorBox(e); });
    };
  }
  function notFound(what) {
    app.innerHTML = '<section class="panel">' + emptyBox(what + "が見つかりませんでした", "URLが古いか、データの更新で変わった可能性があります。検索から探し直してください。", '<a class="btn" href="#top">トップへ</a>') + "</section>";
  }

  // =====================================================================
  // 議員ページ（#m-xxxxxxxx）
  // =====================================================================
  var renderMember = withIndex(function (id) {
    var mi = MEM[id]; if (mi == null) return notFound("この議員");
    var m = IDX.members[mi], all = memBills[mi];
    var asM = all.filter(function (ri) { return R(ri)[X.role] === 0; });
    var asC = all.filter(function (ri) { return R(ri)[X.role] === 1; });
    var first = asM.filter(function (ri) { return R(ri)[X.members][0] === mi; });
    var en = asM.filter(function (ri) { return outOf(R(ri)) === "成立"; });
    var gs = memGroups(id), c = outCount(asM);
    var ses = asM.map(function (ri) { return R(ri)[X.session]; });
    var sa = Math.min.apply(null, ses.length ? ses : [0]), sb = Math.max.apply(null, ses.length ? ses : [0]);
    document.title = m[0] + "｜議員｜法案の生涯タイムライン";
    // 一緒に提出した議員
    var co = {};
    asM.forEach(function (ri) { R(ri)[X.members].forEach(function (x) { if (x !== mi) co[x] = (co[x] || 0) + 1; }); });
    var coL = Object.keys(co).map(Number).sort(function (a, b) { return co[b] - co[a] || IDX.members[a][0].localeCompare(IDX.members[b][0], "ja"); }).slice(0, 12);
    var ach = memberAchievements(mi);
    var txt = m[0] + "議員が提出者として名前がある法律案は" + num(asM.length) + "件（うち成立" + num(en.length) + "件）。" + (ach.length ? ach.map(function (a) { return a[0]; }).join("・") + "。" : "") +
      (ses.length ? "第" + sa + "回〜第" + sb + "回国会。" : "") + "（衆議院・参議院の議案データから）";
    var h = '<section class="ent-top"><p class="kick">議員（法案の提出者）</p><h1>' + esc(m[0]) + "</h1>" +
      (ach.length ? '<div class="chips ach">' + ach.map(function (a) { return '<span class="achv" title="' + esc(a[1]) + '">' + esc(a[0]) + "</span>"; }).join("") + "</div>" : "") +
      (gs.length ? '<div class="chips">' + gs.map(function (x) { return pb(x[0], "xl", x[1] + "件"); }).join("") + "</div>" +
        '<p class="colornote">提出時の会派：提出会派が1つだけの法案（提出者全員がその会派）から数えた件数。</p>' :
        '<p class="colornote">提出時の会派は元データから特定できません（参法には提出会派の記載がなく、複数会派の共同提出からは推定しません）。</p>') +
      '<div class="ent-stats">' + stat(num(asM.length), "件", "提出者として名前がある法案") + stat(num(first.length), "件", "うち筆頭提出者") +
      stat(num(en.length), "件", "うち成立") +
      (asC.length ? stat(num(asC.length), "件", "委員長として提出") : "") + "</div>" +
      (asM.length ? '<div style="margin-top:14px">' + outBar(c, asM.length) + "</div>" : "") +
      shareBlock(txt, m[1]) + "</section>";
    h += '<div class="grid2 row-gap"><section class="panel"><div class="panel-hd"><h2>回次ごとの提出</h2><p>議員として提出した法案</p></div><div class="chart" id="mses"></div></section>' +
      '<section class="panel"><div class="panel-hd"><h2>一緒に提出した議員</h2><p>同じ法案の提出者に名前がある回数</p></div>' +
      (coL.length ? '<div class="mgrid">' + coL.map(function (x) { return '<div class="mrow"><a class="n" href="#' + IDX.members[x][1] + '">' + esc(IDX.members[x][0]) + '</a><span class="c">' + co[x] + "件</span></div>"; }).join("") + "</div>" :
        '<p class="muted">共同提出の記録はありません（参法は元データに筆頭提出者だけが載っています）。</p>') + "</section></div>";
    h += '<section class="panel"><div class="panel-hd"><h2>提出した法案</h2><p>' + num(all.length) + "件（新しい回次から）</p></div><div id=\"mlist\"></div></section>";
    app.innerHTML = h;
    bindOutBar(app, c, asM.length);
    sesBars(document.getElementById("mses"), asM);
    pagedList(document.getElementById("mlist"), all, 40, function (ri) {
      var r = R(ri); return r[X.role] === 1 ? "委員長として" : r[X.members][0] === mi ? "筆頭" : "共同提出";
    }, true);
  });

  // =====================================================================
  // 会派ページ（#g-xxxxxxxx）
  // =====================================================================
  var renderGroup = withIndex(function (id) {
    var gi = GRP[id]; if (gi == null) return notFound("この会派");
    var g = IDX.groups[gi], sub = grpBills[gi], gv = IDX.groupVotes[gi] || IDX.groupVotes[String(gi)];
    var T = gvTotal(gv), en = sub.filter(function (ri) { return outOf(R(ri)) === "成立"; });
    document.title = g[0] + "｜会派｜法案の生涯タイムライン";
    var c = outCount(sub);
    var txt = "会派「" + g[0] + "」：提出した法律案" + num(sub.length) + "件（うち成立" + num(en.length) + "件）" +
      (T.y + T.n ? "、衆議院本会議の採決" + num(T.y + T.n) + "件での賛成率" + pctTxt(T.y, T.y + T.n) : "") + "。（衆議院の議案データから）";
    var same = IDX.groups.map(function (x, i) { return i; }).filter(function (i) { return i !== gi && IDX.groups[i][2] === g[2] && (grpBills[i].length || IDX.groupVotes[i]); });
    var h = '<section class="ent-top g" style="--pc:' + g.color + '"><p class="kick">会派（元データの名称のまま）　識別色の区分: ' + esc(g.fam) + "</p><h1>" + esc(g[0]) + "</h1>" +
      '<div class="ent-stats">' + stat(num(sub.length), "件", "提出した法案（提出会派）") + stat(num(en.length), "件", "うち成立") +
      stat(sub.length ? pct(en.length, sub.length).toFixed(1) : "—", "%", "提出法案の成立率") +
      stat(num(T.y + T.n), "件", "衆院本会議の採決（賛否の記録）") + stat(T.y + T.n ? pct(T.y, T.y + T.n).toFixed(1) : "—", "%", "賛成率") +
      (T.kn + T.ky ? stat(pct(T.ky, T.ky + T.kn).toFixed(1), "%", "閣法への賛成率") : "") + "</div>" +
      (sub.length ? '<div style="margin-top:14px">' + outBar(c, sub.length) + "</div>" : "") +
      shareBlock(txt, g[1]) + "</section>";
    h += '<section class="panel"><div class="panel-hd"><h2>賛成率の推移（衆議院本会議）</h2><p>' + (T.y + T.n ? "第" + T.a + "回〜第" + T.b + "回国会" : "") + "</p></div>" +
      '<div class="legend"><span><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="var(--ink)" stroke-width="2"/><circle cx="11" cy="5" r="3.5" fill="var(--ink)"/></svg> 閣法への賛成率</span>' +
      '<span><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 4"/><circle cx="11" cy="5" r="3.5" fill="var(--card)" stroke="var(--ink)" stroke-width="2"/></svg> 議員立法への賛成率</span></div>' +
      '<div class="chart" id="gline"></div><p class="note">賛成率＝賛成÷（賛成＋反対）。衆議院の議案データの「賛成会派／反対会派」から数えています（会派別の記録は第187回国会以降）。点の間が空いている回次は採決の記録がありません。</p></section>';
    if (sub.length) h += '<section class="panel"><div class="panel-hd"><h2>回次ごとの提出法案</h2><p>この会派が提出会派に入っている法案</p></div><div class="chart" id="gses"></div></section>';
    h += '<section class="panel"><div class="panel-hd"><h2>法案</h2></div><div class="seg" role="group" aria-label="一覧の種類" id="gtabs">' +
      '<button type="button" data-t="sub" aria-pressed="true">提出した ' + num(sub.length) + "</button>" +
      '<button type="button" data-t="yes" aria-pressed="false">賛成した ' + num(grpYes[gi].length) + "</button>" +
      '<button type="button" data-t="no" aria-pressed="false">反対した ' + num(grpNo[gi].length) + "</button></div>" +
      '<p class="note" style="margin:8px 0 10px">賛成・反対は各法案の衆議院本会議での最後の採決（会派別の記録があるもの）。</p><div id="glist"></div></section>';
    if (same.length) h += '<section class="panel"><div class="panel-hd"><h2>同じ識別色の会派</h2><p>会派名の部分一致による色の区分（名称変更の統合ではありません）</p></div><div class="chips">' + same.map(function (i) { return pb(i, "lg"); }).join("") + "</div></section>";
    app.innerHTML = h;
    bindOutBar(app, c, sub.length);
    rateLine(document.getElementById("gline"), gv);
    if (sub.length) sesBars(document.getElementById("gses"), sub);
    var lists = { sub: sub, yes: grpYes[gi], no: grpNo[gi] };
    function show(k) {
      document.querySelectorAll("#gtabs button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-t") === k)); });
      pagedList(document.getElementById("glist"), lists[k], 40);
    }
    document.querySelectorAll("#gtabs button").forEach(function (b) { b.onclick = function () { show(b.getAttribute("data-t")); }; });
    show("sub");
  });

  // =====================================================================
  // 会派一覧（#groups）
  // =====================================================================
  var GS = { sort: "sub", dir: -1, q: "" };
  var renderGroups = withIndex(function () {
    document.title = "会派｜法案の生涯タイムライン";
    var rows = IDX.groups.map(function (g, i) {
      var T = gvTotal(IDX.groupVotes[i]), sub = grpBills[i], en = sub.filter(function (ri) { return outOf(R(ri)) === "成立"; }).length;
      var ss = sub.map(function (ri) { return R(ri)[X.session]; });
      if (T.y + T.n) { ss.push(T.a); ss.push(T.b); }
      return { i: i, name: g[0], sub: sub.length, en: en, er: sub.length ? en / sub.length : -1, v: T.y + T.n, yr: T.y + T.n ? T.y / (T.y + T.n) : -1,
        a: ss.length ? Math.min.apply(null, ss) : null, b: ss.length ? Math.max.apply(null, ss) : null };
    }).filter(function (x) { return x.sub || x.v; });
    app.innerHTML = '<section class="hero"><h1>会派</h1><p class="lead">法案を提出した会派、衆議院本会議で賛否の記録がある会派の一覧です。会派名は元データの表記のまま（名称変更による統合はしていません）。</p>' +
      '<p class="colornote">色は会派名を共通の規則（政党名の部分一致）で区分した識別色です。評価を表すものではありません。</p></section>' +
      '<div class="filterbar"><form class="filters" onsubmit="return false"><label class="fld grow"><span>会派名で絞り込み</span><input type="search" id="gsq" value="' + esc(GS.q) + '" placeholder="例: 民主"></label></form></div>' +
      '<div class="table-wrap"><table id="gtab"><thead><tr><th>会派</th>' +
      [["sub", "提出法案"], ["er", "提出法案の成立率"], ["v", "衆院本会議の採決"], ["yr", "賛成率"], ["b", "記録のある回次"]].map(function (c) {
        return '<th class="sortable' + (c[0] === "er" || c[0] === "yr" ? "" : " num") + '" data-k="' + c[0] + '"><button type="button">' + c[1] + "</button></th>";
      }).join("") + "</tr></thead><tbody></tbody></table></div>" +
      '<p class="note">提出法案＝その会派が「提出会派」に入っている法案（衆法のみ元データに記載）。賛成率＝賛成÷（賛成＋反対）、第187回国会以降の衆議院本会議。</p>';
    function paint() {
      var q = nz(GS.q);
      var list = rows.filter(function (x) { return !q || IDX.groups[x.i].k.indexOf(q) >= 0; }).sort(function (a, b) {
        var x = a[GS.sort], y = b[GS.sort]; if (x == null) x = -1; if (y == null) y = -1;
        return ((x < y ? -1 : x > y ? 1 : 0) * GS.dir) || (b.sub - a.sub) || a.name.localeCompare(b.name, "ja");
      });
      document.querySelectorAll("#gtab th[data-k]").forEach(function (th) {
        if (th.getAttribute("data-k") === GS.sort) th.setAttribute("aria-sort", GS.dir < 0 ? "descending" : "ascending"); else th.removeAttribute("aria-sort");
      });
      document.querySelector("#gtab tbody").innerHTML = list.length ? list.map(function (x) {
        return "<tr><td>" + pb(x.i, "lg") + '</td><td class="num">' + num(x.sub) + "</td><td>" + (x.sub ? '<div class="ib"><span><i style="width:' + (x.er * 100).toFixed(1) + '%"></i></span><b>' + (x.er * 100).toFixed(1) + "%</b></div>" : '<span class="muted">—</span>') +
          '</td><td class="num">' + num(x.v) + "</td><td>" + (x.v ? '<div class="ib"><span><i style="width:' + (x.yr * 100).toFixed(1) + '%"></i></span><b>' + (x.yr * 100).toFixed(1) + "%</b></div>" : '<span class="muted">—</span>') +
          '</td><td class="num">' + (x.a != null ? "第" + x.a + (x.b !== x.a ? "〜" + x.b : "") + "回" : "") + "</td></tr>";
      }).join("") : '<tr><td colspan="6">' + emptyBox("該当する会派はありません", "絞り込みの語を短くしてください。") + "</td></tr>";
    }
    document.querySelectorAll("#gtab th[data-k] button").forEach(function (b) {
      b.onclick = function () { var k = b.parentNode.getAttribute("data-k"); if (GS.sort === k) GS.dir = -GS.dir; else { GS.sort = k; GS.dir = -1; } paint(); };
    });
    document.getElementById("gsq").addEventListener("input", function (e) { GS.q = e.target.value; paint(); });
    paint();
  });

  // =====================================================================
  // 議員一覧（#members）
  // =====================================================================
  var MS = { sort: "n", q: "", shown: 120 };
  var memStat = null;
  function memberStats() {
    if (memStat) return memStat;
    memStat = IDX.members.map(function (m, i) {
      var asM = memBills[i].filter(function (ri) { return R(ri)[X.role] === 0; });
      var en = asM.filter(function (ri) { return outOf(R(ri)) === "成立"; }).length;
      return { i: i, n: asM.length, en: en, chair: memBills[i].length - asM.length };
    });
    return memStat;
  }
  // 議員個人には事実の達成バッジだけを付ける（ワーストや否定的なラベルは付けない）
  var achRank = null;
  function memberAchievements(mi) {
    var st = memberStats();
    if (!achRank) {
      achRank = st.map(function (x) {
        return { n: x.n ? 1 + st.filter(function (y) { return y.n > x.n; }).length : null, en: x.en ? 1 + st.filter(function (y) { return y.en > x.en; }).length : null };
      });
    }
    var r = achRank[mi], out = [];
    if (r.n && r.n <= 10) out.push(["提出数TOP10入り（" + r.n + "位）", "議員として提出者に名前がある法案の数で全議員中" + r.n + "位"]);
    if (r.en && r.en <= 10) out.push(["成立数TOP10入り（" + r.en + "位）", "提出した法案が成立した件数で全議員中" + r.en + "位"]);
    return out;
  }
  var renderMembers = withIndex(function () {
    document.title = "議員｜法案の生涯タイムライン";
    var st = memberStats();
    app.innerHTML = '<section class="hero"><h1>議員（法案の提出者）</h1><p class="lead">元データの「提出者」に名前がある議員 ' + num(st.length) + " 名。名前を選ぶと、その議員が提出者になった法案と結末の内訳を表示します。</p></section>" +
      '<div class="filterbar"><form class="filters" onsubmit="return false"><label class="fld grow"><span>議員名で絞り込み</span><input type="search" id="msq" value="' + esc(MS.q) + '" placeholder="例: 岡田"></label>' +
      '<label class="fld"><span>並べ替え</span><select id="mss"><option value="n">提出した法案が多い順</option><option value="en">成立した法案が多い順</option><option value="name">名前の順</option></select></label></form></div>' +
      '<div class="list-hd"><div class="cnt" id="mcnt"></div></div><div class="mgrid" id="mgrid"></div><p id="mmore" style="margin:12px 0 0"></p>' +
      '<p class="note">提出した法案＝議員として提出者に名前がある法案（委員長としての提出は別に数えます）。参法は元データに筆頭提出者だけが載っています。会派のバッジは提出時の会派（提出会派が1つの法案から）。漢字の異体字などの名寄せはしていません。</p>';
    document.getElementById("mss").value = MS.sort;
    function paint() {
      var q = nz(MS.q);
      var list = st.filter(function (x) { return (x.n || x.chair) && (!q || IDX.members[x.i].k.indexOf(q) >= 0); }).sort(function (a, b) {
        if (MS.sort === "name") return IDX.members[a.i][0].localeCompare(IDX.members[b.i][0], "ja");
        return (MS.sort === "en" ? (b.en - a.en) || (b.n - a.n) : (b.n - a.n) || (b.en - a.en)) || IDX.members[a.i][0].localeCompare(IDX.members[b.i][0], "ja");
      });
      document.getElementById("mcnt").innerHTML = "<b>" + num(list.length) + "</b>名";
      var page = list.slice(0, MS.shown);
      document.getElementById("mgrid").innerHTML = page.length ? page.map(function (x) {
        var m = IDX.members[x.i];
        return '<div class="mrow"><a class="n" href="#' + m[1] + '">' + esc(m[0]) + '</a><span class="c">' + num(x.n) + "件<small class=muted>（成立" + num(x.en) + "）</small></span>" +
          '<span class="g">' + memGroups(m[1]).slice(0, 2).map(function (g) { return pb(g[0]); }).join("") + (x.chair ? '<span class="muted">委員長として' + x.chair + "件</span>" : "") + "</span></div>";
      }).join("") : emptyBox("該当する議員はいません", "名前の一部（姓だけなど）で探してください。");
      document.getElementById("mmore").innerHTML = list.length > MS.shown ? '<button type="button" class="btn" id="mmb">さらに表示（残り' + num(list.length - MS.shown) + "名）</button>" : "";
      var b = document.getElementById("mmb"); if (b) b.onclick = function () { MS.shown += 240; paint(); };
    }
    document.getElementById("msq").addEventListener("input", function (e) { MS.q = e.target.value; MS.shown = 120; paint(); });
    document.getElementById("mss").addEventListener("change", function (e) { MS.sort = e.target.value; paint(); });
    paint();
  });

  // =====================================================================
  // 分野タグ（#tags / #tag-xxx）
  // =====================================================================
  var renderTags = withIndex(function () {
    document.title = "分野タグ｜法案の生涯タイムライン";
    var cloud = function (grp) {
      return '<div class="tagcloud">' + IDX.tags.map(function (t, i) { return [t, i]; }).filter(function (x) { return x[0][2] === grp; })
        .map(function (x) { return tlink(x[1], num(tagBills[x[1]].length)); }).join("") + "</div>";
    };
    app.innerHTML = '<section class="hero"><h1>分野タグ</h1><p class="lead">法案を政策分野・種類・結末のタグで分類しています。政策分野は件名に含まれるキーワードによる<b>自動分類</b>で、1つの法案に複数の分野が付くことがあります。</p></section>' +
      '<section class="panel"><div class="panel-hd"><h2>政策分野（自動分類）</h2></div>' + cloud("policy") + "</section>" +
      '<section class="panel"><div class="panel-hd"><h2>暮らしテーマ（自動分類）</h2><p>政策分野とは別の、暮らしの目線での分類</p></div>' + cloud("life") + "</section>" +
      '<div class="grid2 row-gap"><section class="panel"><div class="panel-hd"><h2>種類</h2></div>' + cloud("kind") + '</section><section class="panel"><div class="panel-hd"><h2>結末</h2></div>' + cloud("outcome") + "</section></div>" +
      '<section class="panel"><div class="panel-hd"><h2>分野ごとの成立率</h2><p>閣法と議員立法を分けて表示</p></div>' + tagRates(1) + "</section>";
  });
  var renderTag = withIndex(function (slug) {
    var ti = TAG[slug]; if (ti == null) return notFound("このタグ");
    var t = IDX.tags[ti], ris = tagBills[ti], S = FACTS.tagStats.filter(function (x) { return x.slug === slug; })[0];
    document.title = "#" + t[1] + "｜分野タグ｜法案の生涯タイムライン";
    var gN = S.n - S.kak, c = outCount(ris);
    var rule = IDX.tagRules && IDX.tagRules[slug];
    var gc = {}, mc = {};
    ris.forEach(function (ri) { var r = R(ri); r[X.groups].forEach(function (g) { gc[g] = (gc[g] || 0) + 1; }); if (r[X.role] === 0) r[X.members].forEach(function (m) { mc[m] = (mc[m] || 0) + 1; }); });
    var gl = Object.keys(gc).map(Number).sort(function (a, b) { return gc[b] - gc[a]; }).slice(0, 14);
    var ml = Object.keys(mc).map(Number).sort(function (a, b) { return mc[b] - mc[a] || IDX.members[a][0].localeCompare(IDX.members[b][0], "ja"); }).slice(0, 12);
    var txt = "「" + t[1] + "」" + (t[2] === "policy" ? "分野（件名による自動分類）" : t[2] === "life" ? "（暮らしテーマ・件名による自動分類）" : "") + "の法律案" + num(S.n) + "件、成立" + num(S.enacted) + "件（成立率" + pctTxt(S.enacted, S.n) + "）。" +
      (S.kak && gN ? "閣法の成立率" + pctTxt(S.kakEnacted, S.kak) + "、議員立法" + pctTxt(S.giEnacted, gN) + "。" : "") + "（衆議院・参議院の議案データから）";
    var h = '<section class="ent-top"><p class="kick">' + (t[2] === "policy" ? "政策分野タグ（件名による自動分類）" : t[2] === "life" ? "暮らしテーマ（件名による自動分類）" : t[2] === "kind" ? "種類タグ" : "結末タグ") + "</p><h1>#" + esc(t[1]) + "</h1>" +
      '<div class="ent-stats">' + stat(num(S.n), "件", "法案") + stat(num(S.enacted), "件", "うち成立") + stat(S.n ? pct(S.enacted, S.n).toFixed(1) : "—", "%", "成立率") +
      (S.kak ? stat(pct(S.kakEnacted, S.kak).toFixed(1), "%", "閣法の成立率（" + num(S.kak) + "件）") : "") +
      (gN ? stat(pct(S.giEnacted, gN).toFixed(1), "%", "議員立法の成立率（" + num(gN) + "件）") : "") +
      (S.medianDays != null ? stat(num(S.medianDays), "日", "成立までの日数（中央値）") : "") + "</div>" +
      '<div style="margin-top:14px">' + outBar(c, ris.length) + "</div>" + shareBlock(txt, "tag-" + slug) + "</section>";
    if (rule) h += '<section class="panel"><div class="panel-hd"><h2>この分野に入れるキーワード</h2><p>件名にどれか1つが含まれれば付与</p></div><p class="chips">' +
      rule.kw.map(function (k) { return '<span class="chip">' + esc(k) + "</span>"; }).join("") + "</p>" +
      (rule.exclude.length ? '<p class="note">次の語は数えません: ' + rule.exclude.map(esc).join("、") + "</p>" : "") +
      '<p class="note">機械的な規則のため、法案の中身と分野が合わない場合があります。</p></section>';
    h += '<section class="panel"><div class="panel-hd"><h2>回次ごとの法案の数</h2></div><div class="chart" id="tses"></div></section>';
    h += '<div class="grid2 row-gap"><section class="panel"><div class="panel-hd"><h2>提出会派</h2><p>この分野で法案を提出した会派（衆法）</p></div>' +
      (gl.length ? '<div class="chips">' + gl.map(function (g) { return pb(g, "lg", gc[g] + "件"); }).join("") + "</div>" : '<p class="muted">提出会派の記載がある法案はありません。</p>') + "</section>" +
      '<section class="panel"><div class="panel-hd"><h2>提出者に名前が多い議員</h2></div>' +
      (ml.length ? '<div class="mgrid">' + ml.map(function (m) { return '<div class="mrow"><a class="n" href="#' + IDX.members[m][1] + '">' + esc(IDX.members[m][0]) + '</a><span class="c">' + mc[m] + "件</span></div>"; }).join("") + "</div>" : '<p class="muted">議員提出の法案はありません。</p>') + "</section></div>";
    h += '<section class="panel"><div class="panel-hd"><h2>法案</h2><p>' + num(ris.length) + "件（新しい回次から）</p></div><div id=\"tlist\"></div>" +
      (t[2] === "policy" || t[2] === "life" ? '<p style="margin:10px 0 0"><button type="button" class="btn" id="tolist">法案一覧で絞り込む</button>' + (t[2] === "life" ? ' <a class="btn" href="#rank-' + slug + '-opp">このテーマの会派別（野党時）</a> <a class="btn" href="#rank-' + slug + '-ruling">（与党時）</a>' : "") + "</p>" : "") + "</section>";
    app.innerHTML = h;
    bindOutBar(app, c, ris.length);
    sesBars(document.getElementById("tses"), ris);
    pagedList(document.getElementById("tlist"), ris, 40);
    var tb = document.getElementById("tolist"); if (tb) tb.onclick = function () { openList({ t: slug }); };
  });

  // =====================================================================
  // ランキング（#rank）
  // =====================================================================
  var renderRank = withIndex(function () {
    document.title = "ランキング｜法案の生涯タイムライン";
    var st = memberStats().filter(function (x) { return x.en > 0; }).sort(function (a, b) { return (b.en - a.en) || (b.n - a.n) || IDX.members[a.i][0].localeCompare(IDX.members[b.i][0], "ja"); }).slice(0, 10);
    var gr = IDX.groups.map(function (g, i) { var en = grpBills[i].filter(function (ri) { return outOf(R(ri)) === "成立"; }).length; return { i: i, n: grpBills[i].length, en: en }; })
      .filter(function (x) { return x.n; }).sort(function (a, b) { return (b.n - a.n) || (b.en - a.en); }).slice(0, 10);
    var mx1 = st.length ? st[0].en : 1, mx2 = gr.length ? gr[0].n : 1;
    app.innerHTML = '<section class="hero"><h1>ランキング</h1><p class="lead">すべて元データから数えた順位です。同じ規則を全会派・全議員に当てはめています。</p></section>' +
      rankSection(true) +
      '<section class="sec"><div class="sec-hd"><h2>廃案の多い分野 TOP10</h2><p>廃案（審議未了）÷その分野の法案数</p></div><div class="panel"><ol class="top10">' +
      FACTS.scores.deadTags.slice(0, 10).map(function (t, i) {
        return '<li><span class="rk">' + (i + 1) + '</span><span class="nm big"><a href="#tag-' + t.slug + '">#' + esc(t.label) + '</a></span><span class="vv">' + t.rate.toFixed(1) + "<small>%</small></span>" +
          '<span class="bar"><i style="width:' + t.rate + '%"></i></span><span class="sub">' + num(t.n) + "件のうち廃案 " + num(t.dead) + "件</span></li>";
      }).join("") + '</ol><p class="note">分野は件名による自動分類。廃案＝衆議院データの最終審議状況が「未了」の法案。</p></div></section>' +
      '<section class="sec"><div class="sec-hd"><h2>そのほかの TOP10</h2></div><div class="grid2">' +
      '<section class="panel"><div class="panel-hd"><h3 style="margin:0">提出した法案が成立した件数が多い議員</h3></div><ol class="top10">' + st.map(function (x, i) {
        var m = IDX.members[x.i];
        return '<li><span class="rk">' + (i + 1) + '</span><span class="nm big">' + mlink(x.i) + '</span><span class="vv">' + num(x.en) + "<small>件</small></span>" +
          '<span class="bar"><i style="width:' + (x.en / mx1 * 100).toFixed(1) + '%"></i></span><span class="sub">' + memGroups(m[1]).slice(0, 2).map(function (g) { return pb(g[0]); }).join("") + "<span>提出 " + num(x.n) + "件中</span></span></li>";
      }).join("") + '</ol><p class="note">議員として提出者に名前がある法案のうち、成立した件数。</p></section>' +
      '<section class="panel"><div class="panel-hd"><h3 style="margin:0">提出した法案が多い会派</h3></div><ol class="top10">' + gr.map(function (x, i) {
        return '<li><span class="rk">' + (i + 1) + '</span><span class="nm">' + pb(x.i, "lg") + '</span><span class="vv">' + num(x.n) + "<small>件</small></span>" +
          '<span class="bar"><i style="width:' + (x.n / mx2 * 100).toFixed(1) + '%"></i></span><span class="sub">成立 ' + num(x.en) + "件（成立率 " + pctTxt(x.en, x.n) + "）</span></li>";
      }).join("") + '</ol><p class="note">提出会派に入っている法案の数（衆法のみ元データに記載）。会派名は当時の名称のまま。</p></section></div></section>';
  });

  // =====================================================================
  // 政党・会派の成績表（#scores）と対決比較（#vs-g-xxx-g-yyy）
  // 与党時・野党時に分けて並べる。ティア・偏差値・順位・ベスト/ワーストは同じ区分の中だけで付ける。
  // =====================================================================
  var STS = ["与党", "野党"];
  var TIER_TXT = "偏差値 65以上=S、58以上=A、52以上=B、46以上=C、40以上=D、40未満=E";
  var SC = { unit: "party" };
  var SRC_STRUCT = {
    jizen: ["imidas「与党の事前審査」", "https://imidas.jp/genre/detail/C-102-0056.html"],
    kenpo: ["日本国憲法 第56条第2項（衆議院）", "https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/shiryo/dl-constitution.htm"],
    kokkaiho: ["国会法 第56条第1項（衆議院）", "https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/shiryo/dl-dietlaw.htm"],
    giin: ["imidas「議員立法」", "https://imidas.jp/genre/detail/C-102-0065.html"]
  };
  function srcLink(k) { var s = SRC_STRUCT[k]; return '<a class="src" href="' + esc(s[1]) + '" target="_blank" rel="noopener">出典: ' + esc(s[0]) + "</a>"; }
  function famColor(fi) { var f = IDX.families[fi] || IDX.families[IDX.families.length - 1]; return f[1]; }
  function partyBadge(p, cls) {
    var col = famColor(p.fam);
    return '<span class="pb ' + (cls || "") + '" style="--pc:' + col + ";--pt:" + textOn(col) + '">' + esc(p.name) + "</span>";
  }
  function unitBadge(x, isParty, cls) { return isParty ? partyBadge(x, cls) : (GRP[x.id] != null ? pb(GRP[x.id], cls) : esc(x.name)); }
  function tierBox(t) { return t ? '<span class="tier t-' + t + '">' + t + "</span>" : '<span class="tier t-na">—</span>'; }
  function ratioTxt(a, b) { if (!b) return null; var r = a / b; return r >= 10 ? Math.round(r) + "倍" : r.toFixed(1) + "倍"; }
  function pf(v) { return v == null ? "—" : v.toFixed(1) + "%"; }
  function nOf(p) { return p ? p[0] : 0; }
  function stMark(st) { return '<span class="stm ' + (st === "与党" ? "r" : "o") + '" aria-hidden="true"></span>'; }
  function cardUnits(isParty) { return isParty ? FACTS.card.parties : FACTS.card.groups; }
  function cardMeta(isParty) { return isParty ? FACTS.card.partiesMeta : FACTS.card.groupsMeta; }
  function periodTxt(p) {
    var f = p.from ? fmtDate(p.from) : "データの最初（第139回）", t = p.to ? fmtDate(p.to) : "現在";
    return f + "〜" + t;
  }
  function srcOf(id) { return FACTS.card.sources.filter(function (s) { return s.id === id; })[0]; }

  function structBox() {
    var C = FACTS.card, H = FACTS.headline, B = C.billSide;
    return '<section class="struct"><h2>先に知っておきたい、法案の通り方の構造</h2><ol>' +
      "<li><b>与党の政策は主に閣法（内閣提出）として出る。</b>政府法案は閣議決定の前に与党が審査する慣行があり（与党の事前審査）、内閣は政府法案の成立を与党に頼っています。このため与党の議員立法は少なめです。" +
      "閣法の成立率は" + pf(H.kakRate) + "、議員立法（衆法＋参法）は" + pf(H.giRate) + "。" + srcLink("jizen") + "</li>" +
      "<li><b>本会議は出席議員の過半数で決まる。</b>与党が過半数を持つ間は、与党が賛成しない法案は可決に届きにくい構造です。" +
      "このデータでは、与党の会派だけで提出した衆法の成立率" + pf(B.ruling.rate) + "（" + num(B.ruling.n) + "件）、野党の会派だけで提出した衆法" + pf(B.opp.rate) + "（" + num(B.opp.n) + "件）、与党と野党の共同提出" + pf(B.mixed.rate) + "（" + num(B.mixed.n) + "件）。" + srcLink("kenpo") + "</li>" +
      "<li><b>議員が法律案を出すには、衆議院で20人以上（予算を伴うものは50人以上）の賛成が要る。</b>議席の少ない会派は単独では提出しにくく、提出数そのものが議席数に左右されます。" + srcLink("kokkaiho") + "</li>" +
      "<li><b>委員長提出は別枠。</b>委員会の委員長（会長）が提出する法案は、元データに提出会派がないため政党の数に入りません（もともと成立率から除外）。" +
      "委員長提出は" + num(C.chair.n) + "件、うち成立" + num(C.chair.en) + "件（" + pf(C.chair.rate) + "）。</li>" +
      "</ol><p class=\"note\">だから、成立率だけを1本の順位にすると「与党かどうか」「何人いるか」の差を比べることになります。下の表は与党時・野党時に分け、同じ区分の中だけで順位を付けています。</p></section>";
  }
  function criteriaBox() {
    var C = FACTS.card, PM = C.partiesMeta, GM = C.groupsMeta;
    return '<details class="more crit"><summary>基準と計算式</summary><ul class="links">' +
      "<li>提出法案＝その会派が元データの「提出会派」に入っている法律案（衆法のみ記載。閣法・参法・委員長提出は含みません）。参法" + num(C.member.sanho) + "件は提出会派の記載がないため入りません。</li>" +
      "<li>与党時・野党時＝法案の提出日（なければ回次の召集日）に、その会派の政党が与党（連立・閣外協力を含む）だったかどうか。下の「与党・野党の表」（出典つき）で決めています。</li>" +
      "<li>会派→政党＝全サイト共通の色の規則（政党名の部分一致）。「その他」「無所属」の色になる会派は、政党が1つに決まるもの（例: 民主党・無所属クラブ→民主党）だけ対応表で決め、それ以外の「その他」は会派名をそのまま政党として扱います。同名の別政党は区別していません。</li>" +
      "<li>成立率＝成立÷提出。審議中も分母に入ります。単独提出＝提出会派が1つだけの法案。共同（同じ側）＝与党どうし・野党どうしの共同、与野党共同＝与党と野党の会派が一緒に出したもの。</li>" +
      "<li>全会一致率＝成立した法案のうち、記録のある本会議の採決態様（衆議院・参議院）がすべて「全会一致」だった割合（採決態様の記録がある成立法案が分母）。全会一致の法案は対立の少ない法案と言えますが、この値の高い低いに良し悪しの方向はありません。</li>" +
      "<li>ティア・偏差値・順位: 同じ区分（与党時どうし・野党時どうし）の中で、提出" + C.minN + "件以上の単位だけ。対象が" + C.minTierUnits + "つ未満の区分にはティアを付けません。偏差値＝50＋10×（成立率−区分内の平均）÷区分内の標準偏差。" + TIER_TXT + "。" +
      "政党単位: 与党時 対象" + PM["与党"].eligible + "・平均" + PM["与党"].mean + "%、野党時 対象" + PM["野党"].eligible + "・平均" + PM["野党"].mean + "%。" +
      "会派単位: 与党時 対象" + GM["与党"].eligible + "・平均" + GM["与党"].mean + "%、野党時 対象" + GM["野党"].eligible + "・平均" + GM["野党"].mean + "%。</li>" +
      "<li>議席数＝衆議院の会派別所属議員数（原則として召集日現在）。取得できた回次・会派だけを使い、その回次に出した法案だけで成立率を計算しています（下の「議席数の出典」）。</li></ul></details>";
  }
  function unitToggle() {
    return '<div class="tagbar" id="scUnit" role="group" aria-label="単位"><button type="button" data-u="party" aria-pressed="' + (SC.unit === "party") + '">政党単位</button>' +
      '<button type="button" data-u="group" aria-pressed="' + (SC.unit === "group") + '">会派単位（当時の会派名）</button></div>';
  }
  function cellRate(x, n) { return '<div class="ib"><span><i style="width:' + (x || 0) + '%"></i></span><b>' + pf(x) + "</b></div>" + (n != null ? '<small class="nn">' + num(n) + "件</small>" : ""); }
  function scoreTable(st, isParty) {
    var items = cardUnits(isParty).filter(function (x) { return x.st[st]; });
    var el = items.filter(function (x) { return x.st[st].rank; }).sort(function (a, b) { return a.st[st].rank - b.st[st].rank || b.st[st].n - a.st[st].n; });
    var rest = items.filter(function (x) { return !x.st[st].rank; }).sort(function (a, b) { return b.st[st].n - a.st[st].n; });
    var row = function (x) {
      var s = x.st[st];
      return "<tr><td class=\"num rk\">" + (s.rank || "") + "</td><td>" + tierBox(s.tier) + "</td><td>" + unitBadge(x, isParty, "lg") + "</td>" +
        "<td>" + cellRate(s.rate) + "</td><td>" + cellRate(s.soloRate, nOf(s.solo)) + "</td>" +
        '<td class="num">' + num(nOf(s.joint)) + " / " + num(nOf(s.cross)) + "</td>" +
        "<td>" + cellRate(s.unRate, s.enM) + "</td>" +
        '<td class="num">' + num(s.en) + '</td><td class="num">' + num(s.n) + (s.pend ? '<small class="nn">審議中' + s.pend + "</small>" : "") + "</td>" +
        '<td class="num">' + (!isParty ? '<span class="muted">政党単位で表示</span>' : s.seats != null ? num(Math.round(s.seats)) + '<small class="nn">' + s.seatSes + "回次の平均</small>" : '<span class="muted">未取得</span>') + "</td>" +
        '<td class="num hide-sm">第' + s.from + (s.to !== s.from ? "〜" + s.to : "") + "回</td></tr>";
    };
    var head = '<thead><tr><th class="num">順位</th><th>ティア</th><th>' + (isParty ? "政党" : "会派") + "</th><th>成立率</th><th>単独提出の成立率</th>" +
      '<th class="num">共同（同じ側／与野党）</th><th>成立のうち全会一致</th><th class="num">成立</th><th class="num">提出</th><th class="num">議席数</th><th class="num hide-sm">記録の回次</th></tr></thead>';
    return '<div class="table-wrap"><table class="stable">' + head + "<tbody>" + (el.length ? el.map(row).join("") : '<tr><td colspan="11" class="muted">対象なし</td></tr>') + "</tbody></table></div>" +
      (rest.length ? '<details class="more"><summary>' + st + "時の提出が" + FACTS.card.minN + "件未満のため順位・ティアの対象外（" + rest.length + "）</summary>" +
        '<div class="table-wrap"><table class="stable">' + head + "<tbody>" + rest.map(row).join("") + "</tbody></table></div></details>" : "");
  }
  function tierBoard(st, isParty) {
    var meta = cardMeta(isParty)[st];
    if (!meta.tiers) return '<p class="note">' + st + "時に提出" + FACTS.card.minN + "件以上の" + (isParty ? "政党" : "会派") + "は" + meta.eligible + "つだけのため、ティアは付けていません（順位と数値だけ表示）。</p>";
    var el = cardUnits(isParty).filter(function (x) { return x.st[st] && x.st[st].tier; });
    return '<div class="tierboard">' + FACTS.card.tiers.map(function (t) {
      var xs = el.filter(function (x) { return x.st[st].tier === t[0]; }).sort(function (a, b) { return a.st[st].rank - b.st[st].rank; });
      return '<div class="trow2">' + tierBox(t[0]) + '<div class="tb2">' + (xs.length ? xs.map(function (x) {
        return '<span class="tcell">' + unitBadge(x, isParty, "lg") + "<small>" + pf(x.st[st].rate) + "</small></span>";
      }).join("") : '<span class="muted">該当なし</span>') + "</div></div>";
    }).join("") + "</div>";
  }
  function bestWorst(st, isParty) {
    var el = cardUnits(isParty).filter(function (x) { return x.st[st] && x.st[st].rank; }).sort(function (a, b) { return a.st[st].rank - b.st[st].rank || b.st[st].n - a.st[st].n; });
    if (el.length < 2) return "";
    var b = el[0], w = el[el.length - 1], label = (isParty ? "政党" : "会派");
    var diff = w.st[st].rate > 0 ? "この差 " + ratioTxt(b.st[st].rate, w.st[st].rate) : "低い側の成立率は0%";
    var card = function (x, kind) {
      var s = x.st[st];
      return '<article class="bw ' + kind + '"><p class="bw-k">' + st + "時の" + label + "の成立率 " + (kind === "best" ? "ベスト" : "ワースト") + "（" + st + "の中で）</p>" +
        '<div class="bw-n">' + s.rate.toFixed(1) + "<small>%</small></div><div>" + unitBadge(x, isParty, "xl") + "</div>" +
        '<p class="fc-t">' + st + "時の提出" + num(s.n) + "件のうち成立" + num(s.en) + "件" + (s.dev != null ? "。偏差値" + s.dev.toFixed(1) + "・ティア" + s.tier : "") + "。単独提出の成立率" + pf(s.soloRate) + "。</p></article>";
    };
    var txt = "【" + st + "時の" + label + "の議員立法 成立率】ベスト" + b.name + " " + pf(b.st[st].rate) + "、ワースト" + w.name + " " + pf(w.st[st].rate) + "（" + diff + "、" + st + "どうしで比較・提出" + FACTS.card.minN + "件以上）#国会 #議員立法 法案の生涯タイムライン";
    return '<div class="bwrow">' + card(b, "best") + '<div class="bw-x"><b>' + esc(diff) + "</b><span>ベスト÷ワースト</span>" + xBtn(txt, "scores") + "</div>" + card(w, "worst") + "</div>";
  }
  function statusSections() {
    var isP = SC.unit === "party";
    return STS.map(function (st) {
      return '<section class="sec"><div class="sec-hd"><h2>' + stMark(st) + st + "だった時の成績表</h2><p>" + (st === "与党" ? "与党の会派どうしで比べる（与党の政策の多くは閣法として別に出ます）" : "野党の会派どうしで比べる") + "</p></div>" +
        bestWorst(st, isP) + tierBoard(st, isP) + '<div style="margin-top:14px">' + scoreTable(st, isP) + "</div></section>";
    }).join("");
  }

  // ---------- 散布図（与党時＝塗りの丸、野党時＝白抜きの四角。色は政党カラー） ----------
  function scatter(el, pts, xs) {
    el.innerHTML = "";
    if (!pts.length) { el.innerHTML = '<p class="muted">表示できる点がありません。</p>'; return; }
    var W = Math.max(300, el.clientWidth || 600), sm = W < 560, H = sm ? 320 : 380;
    var m = { l: 44, r: sm ? 14 : 24, t: 14, b: 42 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": xs.aria });
    var X = function (v) { return m.l + xs.f(v) * iw; }, Y = function (p) { return m.t + ih - p / 100 * ih; };
    [0, 25, 50, 75, 100].forEach(function (t) {
      svg.appendChild(svgEl("line", { x1: m.l, x2: m.l + iw, y1: Y(t), y2: Y(t), stroke: css("--grid"), "stroke-width": 1 }));
      svg.appendChild(svgEl("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end", "font-size": 11, fill: css("--ink-3") }, t + "%"));
    });
    xs.ticks.forEach(function (t) {
      var x = X(t);
      svg.appendChild(svgEl("line", { x1: x, x2: x, y1: m.t, y2: m.t + ih, stroke: css("--grid"), "stroke-width": 1 }));
      svg.appendChild(svgEl("text", { x: x, y: m.t + ih + 16, "text-anchor": "middle", "font-size": 11, fill: css("--ink-3") }, num(t)));
    });
    svg.appendChild(svgEl("line", { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: css("--ink"), "stroke-width": 1.5 }));
    svg.appendChild(svgEl("text", { x: m.l + iw, y: H - 6, "text-anchor": "end", "font-size": 12, "font-weight": 700, fill: css("--ink-2") }, xs.label));
    svg.appendChild(svgEl("text", { x: m.l, y: m.t - 2, "font-size": 12, "font-weight": 700, fill: css("--ink-2") }, ""));
    var ring = css("--card"), boxes = pts.map(function (p) { var cx = X(p.x), cy = Y(p.y); return [cx - 8, cy - 8, cx + 8, cy + 8]; });
    // 大きい点（提出が多い）から描き、ラベルは重ならないものだけ
    pts.sort(function (a, b) { return b.n - a.n; }).forEach(function (p) {
      var cx = X(p.x), cy = Y(p.y), col = famColor(p.fam), g = svgEl("g", { "class": "pt", tabindex: 0 });
      var low = relLum(col) < 0.06 && relLum(ring) < 0.06; // 暗い政党色を暗い背景に置く時だけ細い縁取りを足す
      if (p.st === "与党") {
        if (low) g.appendChild(svgEl("circle", { cx: cx, cy: cy, r: 9.5, fill: "none", stroke: css("--ink-3"), "stroke-width": 1 }));
        g.appendChild(svgEl("circle", { cx: cx, cy: cy, r: 7, fill: col, stroke: ring, "stroke-width": 2 }));
      } else {
        g.appendChild(svgEl("rect", { x: cx - 7, y: cy - 7, width: 14, height: 14, fill: ring, stroke: low ? css("--ink-3") : ring, "stroke-width": low ? 1 : 5 }));
        g.appendChild(svgEl("rect", { x: cx - 6, y: cy - 6, width: 12, height: 12, fill: ring, stroke: col, "stroke-width": 3 }));
      }
      g.appendChild(svgEl("circle", { cx: cx, cy: cy, r: 14, fill: "transparent" }));
      svg.appendChild(g);
      bindTip(g, function () { return p.tip; });
      if (p.n >= (sm ? 60 : 30)) {
        var lw = (p.name.length + 3) * 11 + 4, self = [cx - 8, cy - 8, cx + 8, cy + 8];
        var hit = function (bx) { return boxes.some(function (o) { return o.join() !== self.join() && !(bx[2] < o[0] || bx[0] > o[2] || bx[3] < o[1] || bx[1] > o[3]); }); };
        var cands = [[cx + 10, cy + 4], [cx - 10 - lw, cy + 4], [cx - lw / 2, cy - 12], [cx - lw / 2, cy + 20]];
        var lx = null, ly, bx;
        for (var ci = 0; ci < cands.length; ci++) {
          var c0 = cands[ci]; bx = [c0[0], c0[1] - 11, c0[0] + lw, c0[1] + 3];
          if (bx[0] >= m.l && bx[2] <= m.l + iw && bx[1] >= m.t && bx[3] <= m.t + ih - 2 && !hit(bx)) { lx = c0[0]; ly = c0[1]; break; }
        }
        if (lx != null) {
          boxes.push(bx);
          svg.appendChild(svgEl("text", { x: lx, y: ly, "font-size": 11, "font-weight": 700, fill: css("--ink-2"), "pointer-events": "none" }, p.name + (p.st === "与党" ? "（与）" : "（野）")));
        }
      }
    });
    el.appendChild(svg);
  }
  function logScale(lo, hi) {
    var a = Math.log10(lo), b = Math.log10(hi);
    return function (v) { return (Math.log10(Math.max(v, lo)) - a) / (b - a); };
  }
  function scatterPts(kind) {
    var out = [];
    FACTS.card.parties.forEach(function (p) {
      STS.forEach(function (st) {
        var s = p.st[st]; if (!s) return;
        if (kind === "n" && s.n >= 5) out.push({ name: p.name, fam: p.fam, st: st, x: s.n, y: s.rate, n: s.n,
          tip: "<b>" + esc(p.name) + "（" + st + "時）</b><div class=\"r\"><span>提出</span><span>" + num(s.n) + "件</span></div><div class=\"r\"><span>成立</span><span>" + num(s.en) + "件</span></div><div class=\"r\"><span>成立率</span><span>" + pf(s.rate) + "</span></div><div class=\"r\"><span>単独提出の成立率</span><span>" + pf(s.soloRate) + "（" + num(nOf(s.solo)) + "件）</span></div>" });
        if (kind === "seat" && s.seats != null && s.seatN >= 5) out.push({ name: p.name, fam: p.fam, st: st, x: s.seats, y: s.seatRate, n: s.seatN,
          tip: "<b>" + esc(p.name) + "（" + st + "時）</b><div class=\"r\"><span>平均議席数</span><span>" + s.seats + "（" + s.seatSes + "回次）</span></div><div class=\"r\"><span>その回次の提出</span><span>" + num(s.seatN) + "件</span></div><div class=\"r\"><span>成立率</span><span>" + pf(s.seatRate) + "</span></div>" });
      });
    });
    return out;
  }
  function drawScatters() {
    var a = document.getElementById("scN"), b = document.getElementById("scS");
    if (a) {
      var pa = scatterPts("n"), mx = Math.max.apply(null, pa.map(function (p) { return p.x; }).concat([10]));
      var top = [10, 20, 50, 100, 200, 500, 1000, 2000].filter(function (t) { return t >= mx; })[0] || mx;
      scatter(a, pa, { f: logScale(5, top), ticks: [5, 10, 20, 50, 100, 200, 500, 1000].filter(function (t) { return t <= top; }), label: "提出数（件・対数目盛）", aria: "政党ごとの提出数と成立率の散布図" });
    }
    if (b) {
      var pb2 = scatterPts("seat"), mx2 = Math.max.apply(null, pb2.map(function (p) { return p.x; }).concat([50]));
      var t2 = Math.ceil(mx2 / 50) * 50, ticks = []; for (var t = 0; t <= t2; t += (t2 > 200 ? 50 : 25)) ticks.push(t);
      scatter(b, pb2, { f: function (v) { return v / t2; }, ticks: ticks, label: "衆議院の議席数（取得できた回次の平均）", aria: "政党ごとの議席数と成立率の散布図" });
    }
  }
  function scatterLegend() {
    return '<div class="legend"><span>' + stMark("与党") + "与党だった時（塗りの丸）</span><span>" + stMark("野党") + "野党だった時（白抜きの四角）</span><span>色＝政党の識別色（評価ではありません）</span></div>";
  }

  // ---------- 内閣の成績（閣法） ----------
  function cabinetTable() {
    var C = FACTS.card;
    return '<div class="table-wrap"><table class="stable ctab"><thead><tr><th>政権期（与党の組み合わせ）</th><th>期間</th><th class="num">閣法の提出</th><th class="num">成立</th><th>成立率</th><th>成立のうち全会一致</th></tr></thead><tbody>' +
      C.cabinet.map(function (x) {
        var p = C.periods[x.p];
        return "<tr><th scope=\"row\">" + esc(p.label) + "</th><td>" + periodTxt(p) + '<small class="nn">第' + x.from + (x.to !== x.from ? "〜" + x.to : "") + "回</small></td>" +
          '<td class="num">' + num(x.n) + '</td><td class="num">' + num(x.en) + (x.pend ? '<small class="nn">審議中' + x.pend + "</small>" : "") + "</td><td>" + cellRate(x.rate) + "</td><td>" + cellRate(x.unRate, x.enM) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="note">閣法は内閣が提出する法律案で、政党の成績表には入れていません。政権期は提出日で分けています。第153回より前は参議院の採決態様の記録がないため、全会一致率は衆議院の記録がある法案だけで計算しています（記録がない期間は「—」）。</p>';
  }
  // ---------- 与党・野党の表と出典 ----------
  function rulingTable() {
    var C = FACTS.card;
    var srcs = function (ids) { return ids.map(function (id) { var s = srcOf(id); return s ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="' + esc(s.note) + '">' + esc(s.title) + "</a>" : ""; }).join("<br>"); };
    var per = '<div class="table-wrap"><table class="stable ptab"><thead><tr><th>期間（提出日）</th><th>与党（連立・閣外協力を含む）</th><th>出典</th></tr></thead><tbody>' +
      C.periods.map(function (p) {
        return "<tr><td>" + periodTxt(p) + "</td><td><b>" + esc(p.label) + "</b>" + (p.outside.length ? '<small class="nn">閣外協力: ' + esc(p.outside.join("・")) + "</small>" : "") + '</td><td class="srcs">' + srcs(p.src) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    var ses = '<details class="more"><summary>国会回次ごとの与党（' + C.sessions.length + "回次）</summary><div class=\"table-wrap\"><table class=\"stable stab2\"><thead><tr><th class=\"num\">回次</th><th>召集日（不明なら最初の提出日）</th><th>与党</th></tr></thead><tbody>" +
      C.sessions.map(function (r) {
        var p = r[2] != null ? C.periods[r[2]] : null, q = r[3] != null ? C.periods[r[3]] : null;
        return '<tr><td class="num">第' + r[0] + "回</td><td>" + (r[1] ? fmtDate(r[1]) : "—") + "</td><td>" + (p ? esc(p.label) : "—") + (q ? '<small class="nn">会期中に変更 → ' + esc(q.label) + "（" + fmtDate(q.from) + "）。法案ごとに提出日で判定</small>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div></details>";
    return per + ses;
  }
  function seatSources() {
    var C = FACTS.card, ss = C.seatSessions;
    var all = FACTS.card.sessions.map(function (r) { return r[0]; });
    var missing = all.filter(function (s) { return ss.indexOf(s) < 0; });
    var ranges = function (a) {
      var out = [], s = null, p = null;
      a.forEach(function (x) { var i = all.indexOf(x); if (s == null) { s = x; p = i; } else if (i === p + 1) { p = i; } else { out.push([s, all[p]]); s = x; p = i; } });
      if (s != null) out.push([s, all[p]]);
      return out.map(function (r) { return r[0] === r[1] ? "第" + r[0] + "回" : "第" + r[0] + "〜" + r[1] + "回"; }).join("、");
    };
    return '<ul class="links">' + C.seatSources.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + "</a>：" + esc(s.note) + "</li>"; }).join("") + "</ul>" +
      '<p class="note">取得できた回次: ' + ranges(ss) + "（全会派そろうのは " + ranges(C.seatComplete) + "）。未取得: " + (missing.length ? ranges(missing) : "なし") + "。未取得の回次・会派は「未取得」とし、推計で埋めていません。GitHub Actions の毎日の更新で、衆議院の現在の会派別所属議員数を最新の回次として追記します。</p>";
  }

  var renderScores = withIndex(function () {
    document.title = "政党・会派の成績表｜法案の生涯タイムライン";
    var C = FACTS.card, B = C.billSide;
    var h = '<section class="hero"><h1>政党・会派の成績表</h1><p class="lead">提出した法案がどれだけ成立したかを、<b>与党だった時</b>と<b>野党だった時</b>に分けて並べます。通しやすい法案だけを出していないか（単独提出か共同提出か、全会一致の割合、提出数）と、議席数も同時に見られます。</p></section>' +
      structBox() +
      '<div class="kpis">' + kpi("与党の会派だけで提出", pf(B.ruling.rate), "成立率・衆法 " + num(B.ruling.n) + "件") + kpi("野党の会派だけで提出", pf(B.opp.rate), "成立率・衆法 " + num(B.opp.n) + "件") +
      kpi("与党と野党の共同提出", pf(B.mixed.rate), "成立率・衆法 " + num(B.mixed.n) + "件") + kpi("委員長提出（別枠）", num(C.chair.n) + "<small>件</small>", "成立 " + num(C.chair.en) + "件・政党の数には入れない") + "</div>" +
      criteriaBox() + unitToggle() + '<div id="scBody">' + statusSections() + "</div>" +
      '<section class="sec"><div class="sec-hd"><h2>提出数×成立率</h2><p>たくさん出すほど成立率は下がるか。政党単位・提出5件以上</p></div>' + scatterLegend() + '<div class="scatter" id="scN"></div>' +
      '<p class="note">横軸は対数目盛。点にふれる（タップする）と数値が出ます。与党時と野党時は同じ政党でも別の点です。</p></section>' +
      '<section class="sec"><div class="sec-hd"><h2>議席数×成立率</h2><p>人数が多いほど通りやすいか。議席数が取得できた回次の法案だけ</p></div>' + scatterLegend() + '<div class="scatter" id="scS"></div>' +
      '<p class="note">横軸＝その政党の衆議院の会派の議席数（取得できた回次の平均）。縦軸＝同じ回次に提出した法案の成立率。提出5件以上の点だけ。議席数が未取得の期間（例: 第171〜192回）の法案は入っていません。</p></section>' +
      '<section class="sec"><div class="sec-hd"><h2>内閣の成績（閣法）</h2><p>政党の成績ではなく、政権期ごとの内閣提出法案</p></div>' + cabinetTable() + "</section>" +
      '<section class="sec"><div class="sec-hd"><h2>与党・野党の表</h2><p>出典で確認できた日付だけで区切っています</p></div>' + rulingTable() + "</section>" +
      '<section class="sec"><div class="sec-hd"><h2>議席数の出典と取得できた範囲</h2></div>' + seatSources() + "</section>" +
      '<p class="chips"><a class="btn primary" href="#vs">2会派の対決比較へ</a><a class="btn" href="#rankings">ランキング集へ</a></p>';
    app.innerHTML = h;
    drawScatters();
    document.querySelectorAll("#scUnit button").forEach(function (b) {
      b.onclick = function () {
        SC.unit = b.getAttribute("data-u");
        document.querySelectorAll("#scUnit button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        document.getElementById("scBody").innerHTML = statusSections();
      };
    });
  });
  // トップ用の短い版
  function scoresTeaser() {
    var C = FACTS.card, B = C.billSide;
    var best = function (st) {
      var el = C.parties.filter(function (x) { return x.st[st] && x.st[st].rank; }).sort(function (a, b) { return a.st[st].rank - b.st[st].rank || b.st[st].n - a.st[st].n; });
      return '<div class="tease"><h3>' + stMark(st) + st + "だった時（" + st + "どうしで比較）</h3><ol class=\"top10\">" + el.slice(0, 3).map(function (x, i) {
        var s = x.st[st];
        return '<li><span class="rk">' + (i + 1) + '</span><span class="nm">' + partyBadge(x, "lg") + '</span><span class="vv">' + s.rate.toFixed(1) + '<small>%</small></span><span class="sub">提出' + num(s.n) + "件・単独提出の成立率" + pf(s.soloRate) + "</span></li>";
      }).join("") + "</ol></div>";
    };
    return '<section class="sec"><div class="sec-hd"><h2>政党の成績表：与党時と野党時に分けて</h2><p>同じ区分の中だけで比べる</p></div>' +
      '<p class="lead-s">与党の会派だけで出した衆法の成立率は' + pf(B.ruling.rate) + "、野党の会派だけで出した衆法は" + pf(B.opp.rate) + "。与党の政策の多くは閣法（成立率" + pf(FACTS.headline.kakRate) + "）として別に出ます。</p>" +
      '<div class="grid2">' + best("与党") + best("野党") + "</div>" +
      '<p class="chips" style="margin-top:12px"><a class="btn primary" href="#scores">成績表をすべて見る</a><a class="btn" href="#vs">2会派を対決比較する</a><a class="btn" href="#rankings">ランキング集</a></p></section>';
  }

  // ---------- 対決比較（同じ区分どうし） ----------
  function vsDefault() {
    var el = FACTS.card.groups.filter(function (x) { return x.st["野党"] && x.st["野党"].n >= FACTS.card.minN; }).sort(function (a, b) { return b.st["野党"].to - a.st["野党"].to || b.st["野党"].n - a.st["野党"].n; });
    return [el[0] ? el[0].id : IDX.groups[0][1], el[1] ? el[1].id : IDX.groups[1][1]];
  }
  var renderVs = withIndex(function (arg) {
    document.title = "対決比較｜法案の生涯タイムライン";
    var ids = arg ? arg.split(/-(?=g-)/) : vsDefault();
    var a = GRP[ids[0]], b = GRP[ids[1]];
    if (a == null || b == null) { ids = vsDefault(); a = GRP[ids[0]]; b = GRP[ids[1]]; }
    var CG = {}; FACTS.card.groups.forEach(function (x) { CG[x.id] = x; });
    var opts = IDX.groups.map(function (g) { return g[1]; }).filter(function (id) { return CG[id] || (IDX.groupVotes[GRP[id]]); })
      .sort(function (x, y) { var t = function (id) { var c = CG[id]; return c ? STS.reduce(function (s, k) { return s + (c.st[k] ? c.st[k].n : 0); }, 0) : 0; }; return t(y) - t(x); });
    var sel = function (name, cur) {
      return '<select name="' + name + '">' + opts.map(function (id) { return '<option value="' + id + '"' + (id === cur ? " selected" : "") + ">" + esc(IDX.groups[GRP[id]][0]) + "</option>"; }).join("") + "</select>";
    };
    var A = CG[ids[0]] || { st: {} }, B = CG[ids[1]] || { st: {} };
    var same = 0, both = 0;
    IDX.rows.forEach(function (r) {
      var pa = r[X.hrYes].indexOf(a) >= 0 ? 1 : r[X.hrNo].indexOf(a) >= 0 ? -1 : 0;
      var pb2 = r[X.hrYes].indexOf(b) >= 0 ? 1 : r[X.hrNo].indexOf(b) >= 0 ? -1 : 0;
      if (pa && pb2) { both++; if (pa === pb2) same++; }
    });
    var metric = function (label, va, vb, fmt, dir, sub) {
      var mx = fmt === pf ? 100 : (Math.max(va || 0, vb || 0) || 1);
      var big = (va || 0) >= (vb || 0) ? va : vb, small = (va || 0) >= (vb || 0) ? vb : va;
      var diff = va == null || vb == null ? "片方は記録なし" : dir ? "差 " + Math.abs(va - vb).toFixed(1) + "ポイント" : small ? "この差 " + ratioTxt(big, small) : (big ? "片方は0" : "");
      var win = dir && va !== vb && va != null && vb != null ? (va > vb ? "a" : "b") : "";
      return '<div class="vsrow"><div class="vl' + (win === "a" ? " win" : "") + '"><b>' + (va == null ? "—" : fmt(va)) + '</b><span class="hb"><i style="width:' + ((va || 0) / mx * 100).toFixed(1) + '%;--pc:' + IDX.groups[a].color + '"></i></span></div>' +
        '<div class="vm"><span>' + label + "</span><small>" + diff + (sub ? "・" + sub : "") + "</small></div>" +
        '<div class="vr' + (win === "b" ? " win" : "") + '"><span class="hb"><i style="width:' + ((vb || 0) / mx * 100).toFixed(1) + '%;--pc:' + IDX.groups[b].color + '"></i></span><b>' + (vb == null ? "—" : fmt(vb)) + "</b></div></div>";
    };
    var nf = function (v) { return num(v); };
    var block = function (st) {
      var sa = A.st[st], sb = B.st[st];
      if (!sa && !sb) return "";
      var g = function (s, k) { return s ? s[k] : null; };
      return '<div class="vsst"><h3>' + stMark(st) + st + "だった時どうし</h3>" +
        '<div class="vshd sm"><div>' + tierBox(g(sa, "tier")) + '<span class="muted">' + (sa ? st + "内" + (sa.rank ? sa.rank + "位" : "順位対象外") : "この区分の記録なし") + '</span></div><div class="vs-big">VS</div><div><span class="muted">' + (sb ? st + "内" + (sb.rank ? sb.rank + "位" : "順位対象外") : "この区分の記録なし") + "</span>" + tierBox(g(sb, "tier")) + "</div></div>" +
        metric("成立率", g(sa, "rate"), g(sb, "rate"), pf, true) +
        metric("単独提出の成立率", g(sa, "soloRate"), g(sb, "soloRate"), pf, true, "単独 " + num(sa ? nOf(sa.solo) : 0) + "件 対 " + num(sb ? nOf(sb.solo) : 0) + "件") +
        metric("成立のうち全会一致の割合（高い／低い）", g(sa, "unRate"), g(sb, "unRate"), pf, false) +
        metric("提出数", g(sa, "n"), g(sb, "n"), nf, false) + "</div>";
    };
    var rt = function (S) { return STS.map(function (st) { return S.st[st] ? st + "時" + pf(S.st[st].rate) : ""; }).filter(Boolean).join("・") || "—"; };
    var txt = "【対決比較】" + IDX.groups[a][0] + " vs " + IDX.groups[b][0] + "：議員立法の成立率 " + rt(A) + " 対 " + rt(B) + (both ? "、同じ法案で賛否が一致 " + pctTxt(same, both) : "") + "（与党時・野党時を分けて比較）#国会 法案の生涯タイムライン";
    var h = '<section class="hero"><h1>対決比較</h1><p class="lead">2つの会派を、与党だった時どうし・野党だった時どうしで並べます（与党時と野党時は混ぜて比べません）。</p></section>' +
      '<div class="filterbar"><form class="filters" id="vsf" onsubmit="return false"><label class="fld"><span>会派A</span>' + sel("a", ids[0]) + '</label><span class="vs-x">VS</span><label class="fld"><span>会派B</span>' + sel("b", ids[1]) + "</label></form></div>" +
      '<section class="vsbox"><div class="vshd"><div>' + pb(a, "xl") + '</div><div class="vs-big">VS</div><div>' + pb(b, "xl") + "</div></div>" +
      block("与党") + block("野党") +
      ((A.st["与党"] && B.st["野党"] && !A.st["野党"] && !B.st["与党"]) || (A.st["野党"] && B.st["与党"] && !A.st["与党"] && !B.st["野党"]) ? '<p class="note">この2会派は同じ区分（与党時・野党時）の記録が重ならないため、成立率の大小は比べていません。</p>' : "") +
      '<div class="vsagree"><b>' + (both ? pctTxt(same, both) : "—") + "</b><span>同じ法案で賛否が一致した割合（衆院本会議の最後の採決で両方に記録がある " + num(both) + " 件）</span></div>" +
      shareBlock(txt, "vs-" + ids[0] + "-" + ids[1]) + "</section>" +
      '<p class="note">太字の枠は、同じ区分の中で成立率（全体・単独提出）が上回った側。全会一致の割合と件数は大小だけを示します。ティアは同じ区分の中で提出' + FACTS.card.minN + "件以上の会派のみ。基準は「成績表」と同じです。</p>";
    app.innerHTML = h;
    var f = document.getElementById("vsf");
    f.addEventListener("change", function () { location.hash = "#vs-" + f.a.value + "-" + f.b.value; });
  });

  // =====================================================================
  // ランキング集（#rankings、各ランキング #rank-xxx）
  // =====================================================================
  var RK = { cat: "all" };
  function rkItemHref(it) {
    if (it.t === "bill") return "#bill-" + it.id;
    if (it.t === "group" || it.t === "member") return "#" + it.id;
    if (it.t === "tag") return "#tag-" + it.id;
    return "";
  }
  function rkName(it, cls) {
    if (it.t === "group" && GRP[it.id] != null) return pb(GRP[it.id], cls);
    var h = rkItemHref(it);
    return h ? '<a href="' + h + '">' + esc(it.label) + "</a>" : "<span>" + esc(it.label) + "</span>";
  }
  function rkShareText(rk) {
    var tags = (rk.hashtags || ["国会"]).map(function (t) { return "#" + t; }).join(" ");
    var title = rk.cat === "trivia" ? "【知ってた？】" + rk.title + "。" : "【" + rk.title.replace(/ランキング$/, "") + "ランキング】";
    var tail = " " + tags + " 法案の生涯タイムライン";
    var lim = 22, s;
    do {
      s = title + rk.items.slice(0, 3).map(function (it, i) { return (i + 1) + "位 " + trim(it.label, lim) + "（" + it.vt + "）"; }).join("／") + tail;
      lim -= 2;
    } while (s.length > 140 && lim > 6);
    return s;
  }
  function rkTop3(rk) {
    return '<ol class="rk3">' + rk.items.slice(0, 3).map(function (it, i) {
      return '<li class="p' + (i + 1) + '"><span class="rkn">' + (i + 1) + '<small>位</small></span><span class="rkl">' + rkName(it, "lg") + '</span><span class="rkv">' + esc(it.vt) + "</span>" + (it.sub ? '<span class="rks">' + esc(it.sub) + "</span>" : "") + "</li>";
    }).join("") + "</ol>";
  }
  function rkRest(rk) {
    if (rk.items.length <= 3) return "";
    return '<ol class="rkrest" start="4">' + rk.items.slice(3).map(function (it) {
      return "<li>" + rkName(it) + ' <b>' + esc(it.vt) + "</b>" + (it.sub ? ' <span class="muted">' + esc(it.sub) + "</span>" : "") + "</li>";
    }).join("") + "</ol>";
  }
  function catName(k) { var c = FACTS.rankings.cats.filter(function (x) { return x[0] === k; })[0]; return c ? c[1] : k; }
  function rkCard(rk, full) {
    return '<article class="rkcard' + (full ? " full" : "") + '" id="rk-' + rk.id + '"><div class="rkhd"><span class="tg">' + esc(catName(rk.cat)) + "</span>" +
      (rk.fact ? '<span class="rkfact">' + esc(rk.fact) + "</span>" : "") +
      (full ? "<h1>" + esc(rk.title) + "</h1>" : '<h2><a href="#rank-' + rk.id + '">' + esc(rk.title) + "</a></h2>") + "</div>" +
      rkTop3(rk) + (full ? rkRest(rk) : "") + '<p class="note">' + esc(rk.crit) + "</p>" +
      (rk.more ? '<p class="rkmore"><a href="#' + esc(rk.more) + '">' + (rk.more === "tags" ? "暮らしテーマ・分野タグの一覧へ" : "このテーマの法案を一覧で見る") + " →</a></p>" : "") +
      '<p class="rkbrand">法案の生涯タイムライン｜衆議院・参議院の議案データから</p>' +
      (full ? shareBlock(rkShareText(rk), "rank-" + rk.id) : '<div class="share">' + xBtn(rkShareText(rk), "rank-" + rk.id) + '<a class="btn" href="#rank-' + rk.id + '">TOP10とテキストコピー</a></div>') + "</article>";
  }
  var renderRankings = withIndex(function () {
    document.title = "ランキング集｜法案の生涯タイムライン";
    var L = FACTS.rankings.list;
    var cats = FACTS.rankings.cats.filter(function (c) { return L.some(function (x) { return x.cat === c[0]; }); });
    app.innerHTML = '<section class="hero"><h1>ランキング集</h1><p class="lead">元データから数えられる切り口だけで作った' + L.length + "本のランキング。どれも全政党・全会派に同じ指標と同じ並べ方（数値の順）を当てはめ、会派の比較は与党時・野党時を分け、議員個人は上位だけを載せています。各ランキングの法案・会派・テーマから、法案データベースの該当ページへ進めます。</p>" +
      '<p class="chips"><a class="btn primary" href="#list">全法案を検索・一覧で見る</a><a class="btn" href="#tags">暮らしテーマ・分野タグ</a></p></section>' +
      '<div class="tagbar" id="rkCat" role="group" aria-label="カテゴリで絞り込み"><button type="button" data-c="all" aria-pressed="' + (RK.cat === "all") + '">すべて（' + L.length + "）</button>" +
      cats.map(function (c) { return '<button type="button" data-c="' + c[0] + '" aria-pressed="' + (RK.cat === c[0]) + '">' + esc(c[1]) + "（" + L.filter(function (x) { return x.cat === c[0]; }).length + "）</button>"; }).join("") + "</div>" +
      '<div class="rkgrid" id="rkGrid"></div><p class="chips" style="margin-top:16px"><a class="btn" href="#rank">TOP10まとめ（旧ランキング）</a><a class="btn" href="#scores">政党・会派の成績表</a></p>';
    function paint() {
      document.getElementById("rkGrid").innerHTML = L.filter(function (x) { return RK.cat === "all" || x.cat === RK.cat; }).map(function (x) { return rkCard(x, false); }).join("");
    }
    document.querySelectorAll("#rkCat button").forEach(function (b) {
      b.onclick = function () {
        RK.cat = b.getAttribute("data-c");
        document.querySelectorAll("#rkCat button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        paint();
      };
    });
    paint();
  });
  var renderRankOne = withIndex(function (id) {
    var L = FACTS.rankings.list, rk = L.filter(function (x) { return x.id === id; })[0];
    if (!rk) return notFound("ランキング");
    document.title = rk.title + "｜ランキング集｜法案の生涯タイムライン";
    var others = L.filter(function (x) { return x.cat === rk.cat && x.id !== rk.id; });
    app.innerHTML = '<p class="crumb"><a href="#rankings">ランキング集</a> ／ ' + esc(catName(rk.cat)) + "</p>" + rkCard(rk, true) +
      (others.length ? '<section class="sec"><div class="sec-hd"><h2>同じカテゴリのランキング</h2></div><div class="chips">' + others.map(function (x) { return '<a class="btn" href="#rank-' + x.id + '">' + esc(x.title) + "</a>"; }).join("") + "</div></section>" : "");
  });
  // =====================================================================
  // 横断検索（ヘッダー）: 法案名・議員名・会派名・タグ、入力中の候補、部分一致
  // =====================================================================
  var gq = document.getElementById("gq"), gs = document.getElementById("gsugg");
  function hl(text, q) {
    var t = String(text), k = nz(t), i = k.indexOf(q);
    if (i < 0 || k.length !== t.length) return esc(t);
    return esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length));
  }
  function searchAll(raw) {
    var q = nz(raw); if (!q) return null;
    var bills = [], nb = 0;
    IDX.rows.forEach(function (r, ri) { var p = r.k.indexOf(q); if (p >= 0) { nb++; if (bills.length < 400) bills.push([p === 0 ? 0 : 1, ri]); } });
    bills.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var st = memberStats();
    var mem = []; IDX.members.forEach(function (m, i) { var p = m.k.indexOf(q); if (p >= 0) mem.push([p === 0 ? 0 : 1, i]); });
    mem.sort(function (a, b) { return a[0] - b[0] || (st[b[1]].n - st[a[1]].n); });
    var grp = []; IDX.groups.forEach(function (g, i) { var p = g.k.indexOf(q); if (p >= 0 && (grpBills[i].length || IDX.groupVotes[i])) grp.push([p === 0 ? 0 : 1, i]); });
    grp.sort(function (a, b) { return a[0] - b[0] || (grpBills[b[1]].length + grpYes[b[1]].length) - (grpBills[a[1]].length + grpYes[a[1]].length); });
    var tg = []; IDX.tags.forEach(function (t, i) { if (t.k.indexOf(q) >= 0) tg.push(i); });
    return { q: q, raw: raw, nb: nb, bills: bills.slice(0, 6).map(function (x) { return x[1]; }), mem: mem.slice(0, 6).map(function (x) { return x[1]; }),
      grp: grp.slice(0, 5).map(function (x) { return x[1]; }), tg: tg.slice(0, 5), nm: mem.length };
  }
  var sugSel = -1;
  function closeSug() { gs.hidden = true; gq.setAttribute("aria-expanded", "false"); sugSel = -1; }
  function paintSug() {
    if (!IDX) { gs.innerHTML = '<div class="s-none">索引を読み込み中…</div>'; gs.hidden = false; return; }
    var res = searchAll(gq.value);
    if (!res) { closeSug(); return; }
    var st = memberStats(), h = "", n = 0;
    var opt = function (href, inner) { return '<a role="option" id="so' + (n++) + '" href="' + href + '" aria-selected="false">' + inner + "</a>"; };
    if (res.mem.length) h += "<h4>議員（" + num(res.nm) + "名）</h4>" + res.mem.map(function (i) {
      var m = IDX.members[i], g = memGroups(m[1])[0];
      return opt("#" + m[1], '<span class="s-t"><b>' + hl(m[0], res.q) + "</b></span>" + (g ? pb(g[0], "", "", true) : "") + "<small>提出 " + num(st[i].n) + "件</small>");
    }).join("");
    if (res.grp.length) h += "<h4>会派</h4>" + res.grp.map(function (i) {
      return opt("#" + IDX.groups[i][1], '<span class="s-t">' + pb(i, "", "", true) + "</span><small>提出 " + num(grpBills[i].length) + "件</small>");
    }).join("");
    if (res.tg.length) h += "<h4>タグ</h4>" + res.tg.map(function (i) {
      return opt("#tag-" + IDX.tags[i][0], '<span class="s-t">#' + hl(IDX.tags[i][1], res.q) + "</span><small>" + num(tagBills[i].length) + "件</small>");
    }).join("");
    if (res.bills.length) h += "<h4>法案（件名に一致 " + num(res.nb) + "件）</h4>" + res.bills.map(function (ri) {
      var r = R(ri);
      return opt("#bill-" + r[X.id], '<span class="s-t">' + hl(r[X.title], res.q) + "</span>" + badge(outOf(r)) + "<small>第" + r[X.session] + "回</small>");
    }).join("");
    h += '<a role="option" id="so' + (n++) + '" class="s-all" href="#list" data-all="1" aria-selected="false">「' + esc(res.raw.trim()) + "」で法案一覧を絞り込む（件名・議員名・会派名）</a>";
    gs.innerHTML = h; gs.hidden = false; gq.setAttribute("aria-expanded", "true"); sugSel = -1;
  }
  function moveSel(d) {
    var os = gs.querySelectorAll("[role=option]"); if (!os.length) return;
    sugSel = (sugSel + d + os.length) % os.length;
    os.forEach(function (o, i) { o.setAttribute("aria-selected", String(i === sugSel)); });
    gq.setAttribute("aria-activedescendant", os[sugSel].id);
    os[sugSel].scrollIntoView({ block: "nearest" });
  }
  function goAll() { var q = gq.value.trim(); closeSug(); gq.blur(); openList({ q: q }); }
  var sgT;
  gq.addEventListener("input", function () { clearTimeout(sgT); sgT = setTimeout(function () { if (!IDX) loadIndex().then(paintSug).catch(function () { /* 表示側で再試行 */ }); paintSug(); }, 120); });
  gq.addEventListener("focus", function () { if (!IDX) loadIndex().then(function () { if (gq.value) paintSug(); }).catch(function () { /* 無視 */ }); else if (gq.value) paintSug(); });
  gq.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (gs.hidden) paintSug(); moveSel(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1); }
    else if (e.key === "Escape") { closeSug(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      var os = gs.querySelectorAll("[role=option]");
      if (sugSel >= 0 && os[sugSel]) { if (os[sugSel].getAttribute("data-all")) goAll(); else { location.hash = os[sugSel].getAttribute("href"); closeSug(); gq.blur(); } }
      else if (gq.value.trim() && IDX) goAll();
    }
  });
  gs.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[role=option]"); if (!a) return;
    if (a.getAttribute("data-all")) { e.preventDefault(); goAll(); return; }
    closeSug();
  });
  document.addEventListener("pointerdown", function (e) { if (!e.target.closest || !e.target.closest(".gsearch")) closeSug(); });
  // =====================================================================
  // データについて
  // =====================================================================
  function renderAbout() {
    var mm = META.mentions || {};
    app.innerHTML = '<section class="hero"><h1>データについて</h1><p class="lead">このサイトの数字がどこから来て、どう数えているか。</p></section>' +
      '<section class="panel"><h2>データ源</h2><ul class="links">' +
      '<li>議案: <a href="' + esc(META.sources.hr.url) + '" target="_blank" rel="noopener">' + esc(META.sources.hr.name) + "</a>（元データ更新: " + esc(META.sources.hr.updated || "不明") + "）、" +
      '<a href="' + esc(META.sources.hc.url) + '" target="_blank" rel="noopener">' + esc(META.sources.hc.name) + "</a>（元データ更新: " + esc(META.sources.hc.updated || "不明") + "）。スマートニュース メディア研究所、MIT License。元データは衆議院・参議院のウェブサイト。</li>" +
      '<li>会議録: <a href="https://kokkai.ndl.go.jp/api.html" target="_blank" rel="noopener">国会会議録検索システム 検索用API</a>（国立国会図書館）。取得済み ' + num(mm.fetched) + " / " + num(mm.total) +
      " 件" + (mm.updated ? "（最終取得 " + esc(mm.updated) + "）" : "") + "。未取得の法案は「未取得」と表示します。</li></ul></section>" +
      '<section class="panel"><h2>用語と算出方法</h2><ul class="links">' +
      "<li>対象: 衆議院の議案データにある閣法・衆法・参法（番号のない修正案などは除く）。衆議院データは第139回国会以降、参議院データは第153回国会以降を収録。</li>" +
      "<li>提出日: 提出された国会での、衆参いずれかの受理日（予備審査のための受理を含む）のうち最も早い日。</li>" +
      "<li>結末: 衆議院データの最後の「審議状況」から分類。成立（成立・回付案同意など）／廃案（未了）／否決／撤回／審議中（最新の国会で審議中・閉会中審査）／その他。</li>" +
      "<li>成立率: 成立した件数÷提出された件数。審議中の法案も分母に含みます。議員立法＝衆法＋参法。</li>" +
      "<li>結末日・日数: 成立は最後に可決（修正・同意を含む）した本会議の日、否決は否決の日、撤回は撤回の日。廃案（審議未了）は会期終了日が元データにないため日数を出していません。</li>" +
      "<li>会派別の賛成率: 衆議院データの「審議時賛成会派／反対会派」を数えたもの（第187回国会以降）。会派名は当時のまま。参議院データは採決態様（全会一致・多数など）と投票結果ページへのリンク。</li>" +
      "<li>会議録での言及: 件名の文字列を含む発言の数（提出回次〜最後に掲載された回次に限定）。略称で呼ばれた発言は数えません。会議録冒頭の議事日程等を含みます。</li></ul></section>" +
      '<section class="panel"><h2>議員・会派・タグの扱い</h2><ul class="links">' +
      "<li>議員名: 元データの「提出者」「提出者一覧」（衆法）と参議院データの「発議者」（参法）の文字列から、空白と「君」「外○名」を除いたもの。漢字の異体字などの名寄せはしていません。参法は元データに筆頭提出者だけが載っています。委員会・調査会の委員長（会長）による提出は「委員長として」と分けて数えます。閣法は「内閣」。</li>" +
      "<li>議員の提出時の会派: 提出会派が1つだけの法案（提出者全員がその会派）から数えた件数。複数会派の共同提出や、提出会派の記載がない法案（参法など）からは推定しません。</li>" +
      "<li>会派名: 元データの表記のまま（名称変更による統合はしません）。色は全サイト共通の規則（政党名の一覧を上から順に見て、会派名に部分一致した最初の色）で決めた識別色で、どの会派にも同じ規則を当てはめています。評価を表すものではありません。一致しない会派は「その他」の灰色です。</li>" +
      "<li>政策分野タグ（自動分類）: 件名に分野ごとのキーワードが含まれていれば付けます（複数可。どれにも当たらなければ「その他の分野」）。法案の中身を読んで分類したものではありません。キーワードは各タグのページに載せています。種類（閣法・衆法・参法）と結末もタグとして選べます。</li>" +
      "<li>賛否が割れた法案: 衆議院本会議の最後の採決で、賛成会派の数と反対会派の数が近い順（少ない方÷合計が大きい順）。会派の数での比較で、議席数ではありません。</li>" +
      "<li>トップの事実カード・ランキング: すべて上の定義で元データから自動で数えたもので、データの更新とともに変わります。</li>" +
      "<li>政党・会派の成績表: 提出法案（提出会派に入っている衆法）の成立率を、提出日にその政党が与党だったか野党だったかで分けて数えます（与党・野党の区分は出典つきの表で決定）。ティア・偏差値・順位・ベスト/ワーストは与党時どうし・野党時どうしの中だけで付け、混ぜて比べません。単独提出の成立率、成立のうち全会一致の割合、議席数（衆議院の会派別所属議員数。取得できた回次のみ）も並べます。委員長提出は提出会派がないため別枠、閣法は「内閣の成績」として政権期ごとに表示します。議員個人には順位の下位やワーストの表示はせず、上位入りだけを表示します。<a href=\"#scores\">成績表へ</a></li>" +
      "<li>ランキング集: 元データから計算できる切り口だけ。各ランキングに固有のURL（#rank-…）があり、Xでシェアとテキストコピーができます。<a href=\"#rankings\">ランキング集へ</a></li>" +
      "<li>色づかい: 色は政党・会派の識別だけに使い、結末（成立・廃案など）や賛否、衆参の区別は白黒の濃淡と形（●賛成・×反対など）で表しています。</li></ul>" +
      '<p class="note">データ生成: ' + esc(META.generatedAt) + "。このサイトの表示内容は元データを機械的に整形したもので、誤りを含む可能性があります。正確な情報は衆議院・参議院の公式ページをご確認ください。</p></section>";
  }

  // =====================================================================
  // ルーティング（#top #list #about #bill-xxx のみ。旧形式 #/bill/xxx も読める）
  // =====================================================================
  function parseRoute() {
    var h = (location.hash || "").replace(/^#/, "");
    var m = /^bill-([ksa]\d+-\d+)$/.exec(h) || /^\/bill\/([ksa]\d+-\d+)$/.exec(h);
    if (m) return { v: "bill", id: m[1] };
    if ((m = /^(m-[0-9a-f]{8}(?:-\d+)?)$/.exec(h))) return { v: "member", id: m[1] };
    if ((m = /^(g-[0-9a-f]{8}(?:-\d+)?)$/.exec(h))) return { v: "group", id: m[1] };
    if ((m = /^tag-([a-z0-9-]+)$/.exec(h))) return { v: "tag", id: m[1] };
    if (h === "list" || h.indexOf("/?") === 0) return { v: "list" };
    if (h === "about" || h === "/about") return { v: "about" };
    if ((m = /^vs-(g-[0-9a-f]{8}(?:-\d+)?-g-[0-9a-f]{8}(?:-\d+)?)$/.exec(h))) return { v: "vs", id: m[1] };
    if ((m = /^rank-([a-z0-9-]+)$/.exec(h))) return { v: "rankone", id: m[1] };
    if (h === "rankings") return { v: "rankings" };
    if (h === "rank" || h === "members" || h === "groups" || h === "tags" || h === "scores" || h === "vs") return { v: h };
    return { v: "top" };
  }
  var lastRoute = "";
  function route(keepScroll) {
    hideTip();
    var r = parseRoute();
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      var nv = a.getAttribute("data-nav");
      var on = nv === r.v || (r.v === "bill" && nv === "list") || (r.v === "member" && nv === "members") || (r.v === "group" && nv === "groups") || (r.v === "tag" && nv === "tags") || (r.v === "vs" && nv === "scores") || ((r.v === "rankone" || r.v === "rank") && nv === "rankings");
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var key = r.v + (r.id || "");
    if (!keepScroll && key !== lastRoute) window.scrollTo(0, 0);
    lastRoute = key;
    if (r.v === "bill") return renderBill(r.id);
    document.title = "法案の生涯タイムライン";
    if (r.v === "member") return renderMember(r.id);
    if (r.v === "group") return renderGroup(r.id);
    if (r.v === "tag") return renderTag(r.id);
    if (r.v === "rank") return renderRank();
    if (r.v === "rankings") return renderRankings();
    if (r.v === "rankone") return renderRankOne(r.id);
    if (r.v === "scores") return renderScores();
    if (r.v === "vs") return renderVs(r.id);
    if (r.v === "members") return renderMembers();
    if (r.v === "groups") return renderGroups();
    if (r.v === "tags") return renderTags();
    if (r.v === "about") return renderAbout();
    if (r.v === "list") return renderList();
    renderTop();
  }
  function rerender() {
    if (!META) return;
    var y = window.scrollY;
    route(true);
    window.scrollTo(0, y);
  }
  window.addEventListener("hashchange", function () { route(false); });
  var rt, lastW = window.innerWidth;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (Math.abs(window.innerWidth - lastW) < 40) return; // 高さだけの変化（モバイルのアドレスバー等）は無視
      lastW = window.innerWidth;
      if (parseRoute().v !== "about") rerender();
    }, 300);
  });
  app.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-act=reload]");
    if (t) { e.preventDefault(); boot(); return; }
    var a = e.target.closest && e.target.closest("[data-act=allkinds]");
    var f = document.getElementById("ovf");
    if (a && f) { f.querySelectorAll("input[name=k]").forEach(function (x) { x.checked = true; }); f.dispatchEvent(new Event("change")); }
  });

  function boot() {
    app.innerHTML = skeleton("データを読み込み中…");
    getJSON("data/meta.json").then(function (meta) {
      META = meta;
      document.getElementById("gen").textContent = "データ生成: " + META.generatedAt.replace("T", " ").replace(/\+09:00$/, "（日本時間）");
      route(true);
    }).catch(function (e) {
      app.innerHTML = errorBox({ message: e.message + "。ローカルで見る場合は site/ で簡易サーバー（python3 -m http.server）を起動してください。" });
    });
  }
  boot();
})();
