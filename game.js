/* ===========================================================
   《未竟之夢圖書館》2.0 — 引擎（密室逃脫）
   標題/開場/大廳/結局沿用；房間＝可搜查的密室。
   =========================================================== */
(function () {
  "use strict";
  // 遊戲資料由 data.js（編碼版）掛在 __GAME_BOOT__；讀進閉包後立刻刪掉，console 摸不到。
  // （window.GAME 為本機直接載入明文 data_src.js 測試時的後援）
  const GAME = (() => { const g = window.__GAME_BOOT__ || window.GAME; try { delete window.__GAME_BOOT__; delete window.GAME; } catch (e) {} return g; })();
  if (!GAME) { alert("找不到 data.js"); return; }
  try { console.log("%c🕯️ 圖書館管理員看著你……這裡沒有答案，答案上了鎖。回去房間裡找吧。", "color:#e6b35c;font-size:14px"); } catch (e) {}
  // 答案驗證：上線版只有 SHA-256 雜湊（鹽+正規化答案），比對輸入的雜湊；明文陣列僅供本機測試後援
  const SALT = "weijing-lib-v1|";
  async function sha256(s) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SALT + s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  async function answerOK(v, plain, hashes) {
    const n = t => String(t == null ? "" : t).trim().toUpperCase().replace(/\s+/g, "");
    if (plain && plain.some(a => n(a) === v)) return true;
    if (hashes && hashes.length) { try { return hashes.includes(await sha256(v)); } catch (e) { return false; } }
    return false;
  }
  const A = window.SND || { init(){},ambient(){},stopAmbient(){},viewFx(){},stopFx(){},music(){},sfx(){},toggle(){return false;},isMuted(){return false;} };
  const app = document.getElementById("app");
  const SAVE_KEY = "mengxiang_save_v2";
  // 減少動態：系統開了「減少動態效果」就關掉逐字/光塵/淡入等裝飾動畫（暈動敏感、低階裝置）
  const REDUCED = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })();

  /* ---------- 存檔 ---------- */
  let save = (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || null; } catch (e) { return null; } })()
    || { solved: [], reflections: {}, final: "", mode: "solo", players: ["", ""] };
  if (!save.mode) save.mode = "solo";
  if (!save.players) save.players = ["", ""];
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
  // 老師用 ?class=代碼 連結：全班(含單人)反思都自動收到同一個課堂，免學生打字
  (() => { try { const c = new URLSearchParams(location.search).get("class"); if (c && c.trim()) { save.classCode = c.trim().slice(0, 20); persist(); } } catch (e) {} })();

  /* ---------- 遊戲計時：累計「實際遊玩」時間（頁面可見才計；跨重載累計；到結局就凍結） ---------- */
  function markStarted() { if (!save.started) { save.started = true; save.playMs = save.playMs || 0; persist(); } }
  function playedMs() { return save.doneMs != null ? save.doneMs : (save.playMs || 0); }
  function fmtDur(ms) { const m = Math.round(ms / 60000); if (m < 1) return "不到一分鐘"; if (m < 60) return m + " 分鐘"; return Math.floor(m / 60) + " 小時 " + (m % 60) + " 分鐘"; }
  (() => {
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      if (save.started && save.doneMs == null && !document.hidden) { save.playMs = (save.playMs || 0) + (now - last); persist(); }
      last = now;
    }, 5000);
  })();
  const solvedSet = () => new Set(save.solved);
  let onlineStarted = false, onlineReflRefresh = null, onlinePresenceRefresh = null;

  /* ---------- DOM ---------- */
  function el(tag, props) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k]; if (v == null) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (let i = 2; i < arguments.length; i++) {
      let c = arguments[i]; if (c == null) continue;
      if (Array.isArray(c)) c.forEach(x => x != null && n.appendChild(typeof x === "string" ? document.createTextNode(x) : x));
      else n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }
  let current = null;
  function showScreen(bg, build, cls) {
    const scr = el("div", { class: "screen" + (cls ? " " + cls : "") });
    if (bg) scr.style.backgroundImage = `url("${bg}")`;
    ["tl", "tr", "bl", "br"].forEach(p => scr.appendChild(el("div", { class: "corner " + p })));
    build(scr);
    app.appendChild(scr); void scr.offsetWidth;
    const prev = current; current = scr;
    const activate = () => { scr.classList.add("active"); if (prev) { prev.classList.remove("active"); setTimeout(() => prev.remove(), 950); } };
    if (bg) {                                   // 等目標背景圖載入好再淡入，避免切換時先閃空白或舊圖
      const im = new Image(); let done = false;
      const go = () => { if (done) return; done = true; activate(); };
      im.onload = go; im.onerror = go; im.src = bg;
      if (im.complete) go(); else setTimeout(go, 500);   // 已快取則即時；最多等 0.5 秒避免卡住
    } else activate();
    return scr;
  }
  // 打字機：有 GSAP 就用計數補間（requestAnimationFrame 驅動、時序均勻、不頓）；否則退回 setTimeout
  function typewriter(node, text, done) {
    node.innerHTML = "";
    const txt = el("span", {}); const cur = el("span", { class: "cursor" }, "▍");
    node.appendChild(txt); node.appendChild(cur);
    let finished = false;
    function complete() { if (finished) return; finished = true; txt.textContent = text; if (cur.parentNode) cur.remove(); done && done(); }
    if (REDUCED) { complete(); return { finish() { return false; } }; }
    if (window.gsap) {
      const o = { n: 0 }, dur = Math.min(2.4, Math.max(0.5, text.length * 0.034));
      const tw = gsap.to(o, { n: text.length, duration: dur, ease: "none",
        onUpdate: () => { txt.textContent = text.slice(0, Math.round(o.n)); }, onComplete: complete });
      return { finish() { if (finished) return false; tw.kill(); complete(); return true; } };
    }
    let i = 0, t;
    (function tick() { if (finished) return; if (i < text.length) { txt.textContent = text.slice(0, ++i); t = setTimeout(tick, 30); } else complete(); })();
    return { finish() { if (finished) return false; clearTimeout(t); complete(); return true; } };
  }
  // 旁白文字：有 GSAP 就逐字錯開浮現（字一個個由下淡入，明顯比整行淡入更有層次）；否則 CSS 後援
  function showLine(wrap, text) {
    const ln = el("div", { class: "line" });
    wrap.appendChild(ln);
    if (REDUCED) { ln.textContent = text; ln.style.opacity = "1"; ln.classList.add("in"); return ln; }
    if (window.gsap) {
      ln.style.opacity = "1";
      const chars = [...text].map(ch => el("span", { class: "ch" }, ch === " " ? " " : ch));
      chars.forEach(c => ln.appendChild(c));
      gsap.from(chars, { opacity: 0, yPercent: 55, duration: 0.5, ease: "power3.out", stagger: 0.024 });
    } else { ln.textContent = text; ln.classList.add("in"); }
    return ln;
  }
  function flash() { if (REDUCED) return; const f = el("div", { class: "flash" }); document.body.appendChild(f); void f.offsetWidth; f.classList.add("go"); setTimeout(() => f.remove(), 1000); }
  // 金色火花迸發：解鎖、得碎片的回饋時刻（減少動態或無 GSAP 時不放）
  function burst(x, y, n) {
    if (REDUCED || !window.gsap) return;
    for (let i = 0; i < (n || 12); i++) {
      const s = el("div", { class: "spark" }); document.body.appendChild(s);
      s.style.left = x + "px"; s.style.top = y + "px";
      const a = Math.random() * 6.2832, d = 60 + Math.random() * 110;
      gsap.fromTo(s, { x: 0, y: 0, scale: 0.6 + Math.random() * 0.8, opacity: 1 },
        { x: Math.cos(a) * d, y: Math.sin(a) * d - 20, scale: 0, opacity: 0,
          duration: 0.7 + Math.random() * 0.5, ease: "power2.out", onComplete: () => s.remove() });
    }
  }
  function fragPop() {
    const p = el("div", { class: "frag-pop" }); document.body.appendChild(p);
    if (!REDUCED && window.gsap) {              // GSAP 版：彈跳進場＋火花，比 CSS 版更有「拿到了」的重量
      p.classList.add("gsap");
      const tl = gsap.timeline({ onComplete: () => p.remove() });
      tl.fromTo(p, { scale: 0, rotation: -28, opacity: 0 }, { scale: 1.12, rotation: 0, opacity: 1, duration: 0.55, ease: "back.out(2.2)" })
        .to(p, { scale: 1, duration: 0.18, ease: "power1.out" })
        .to(p, { scale: 0.92, opacity: 0, y: -46, duration: 0.5, ease: "power2.in", delay: 0.55 });
      burst(innerWidth / 2, innerHeight / 2, 16);
      return;
    }
    void p.offsetWidth; p.classList.add("go"); setTimeout(() => p.remove(), 1450);
  }
  function hallToast(scr, msg) { const t = el("div", { class: "hall-toast" }, msg); scr.appendChild(t); setTimeout(() => t.remove(), 2300); }
  function fragTray() {
    const s = solvedSet(); const t = el("div", { class: "frag-tray" }, el("span", { class: "lbl" }, "心靈碎片"));
    GAME.rooms.forEach(r => t.appendChild(el("div", { class: "frag" + (s.has(r.id) ? " on" : ""), title: r.fragment })));
    return t;
  }

  /* ===================== 匯出反思紀錄（教學評量用）===================== */
  const MODE_TXT = { solo: "單人", duo: "雙人·同機", online: "雙人·連線" };
  function hasReflectionData() { return (save.solved && save.solved.length) || (save.reflections && Object.keys(save.reflections).length); }
  function buildReflectionText(name) {
    const L = [];
    L.push("《" + GAME.title + "》— 反思紀錄");
    L.push("姓名／座號：" + (name || "（未填）"));
    if (save.mode && save.mode !== "solo") L.push("夥伴：" + (save.players || []).filter(Boolean).join("、"));
    L.push("模式：" + (MODE_TXT[save.mode] || save.mode || "單人"));
    L.push("完成房間：" + (save.solved ? save.solved.length : 0) + " / " + GAME.rooms.length);
    L.push("遊戲時間：" + fmtDur(playedMs()));
    L.push("匯出時間：" + new Date().toLocaleString("zh-TW"));
    L.push("==================================================");
    GAME.rooms.forEach(r => {
      const rec = save.reflections ? save.reflections[r.id] : null;
      L.push("");
      L.push("【第 " + r.id + " 室】" + r.person + "　·　" + r.theme);
      L.push("提問：" + (r.reflection || "").replace(/\s*\n\s*/g, "　"));
      if (rec && typeof rec === "object") {
        L.push("　" + (save.players[0] || "夥伴一") + "：" + (rec.a || "（未填）"));
        L.push("　" + (save.players[1] || "夥伴二") + "：" + (rec.b || "（未填）"));
      } else L.push("回答：" + (rec || "（未填）"));
    });
    L.push(""); L.push("──────────────────────────────");
    L.push("離開圖書館想帶走的一句話：");
    const f = save.final;
    if (f && typeof f === "object") {
      L.push("　" + (save.players[0] || "夥伴一") + "：" + (f.a || "（未填）"));
      L.push("　" + (save.players[1] || "夥伴二") + "：" + (f.b || "（未填）"));
    } else L.push("　" + (f || "（未填）"));
    return L.join("\n");
  }
  function downloadText(filename, text) {
    const blob = new Blob(["﻿" + text], { type: "text/plain;charset=utf-8" });  // 加 BOM：記事本/Excel 正確顯示中文
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: filename });
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
  }
  function reflectionsObj() {                       // 整理成 {關卡id:內文} 供上傳老師後台
    const out = { reflections: {}, final: "" };
    GAME.rooms.forEach(r => {
      const rec = save.reflections ? save.reflections[r.id] : null;
      if (rec == null || rec === "") return;
      out.reflections[r.id] = (typeof rec === "object") ? ((rec.a || "") + (rec.b ? "　｜　" + rec.b : "")) : rec;
    });
    const f = save.final;
    out.final = (f && typeof f === "object") ? ((f.a || "") + (f.b ? "　｜　" + f.b : "")) : (f || "");
    return out;
  }
  function autoSubmitClass() {                       // 課堂模式：自動把反思上傳給老師(靜默)
    if (!save.classCode || !save.studentName || !(window.COOP && COOP.available)) return;
    const o = reflectionsObj();
    COOP.uploadClass(save.classCode, { name: save.studentName, mode: save.mode, solved: (save.solved || []).length, mins: Math.round(playedMs() / 60000), reflections: o.reflections, final: o.final });
  }
  function ensureStudentName(cb) {                   // 課堂模式但還沒留名 → 只問一次名字
    if (!save.classCode || save.studentName) { cb(); return; }
    const inp = el("input", { class: "name-in", style: "margin:.6rem auto 0;display:block", placeholder: "你的名字／座號", maxlength: "24" });
    const back = el("div", { class: "er-modal" });
    function ok() { const v = inp.value.trim(); if (!v) { inp.focus(); return; } save.studentName = v; persist(); back.remove(); cb(); }
    back.appendChild(el("div", { class: "er-card", style: "max-width:460px" }, el("div", { class: "body" },
      el("h3", {}, "🎓 老師要收這次的反思"),
      el("div", { class: "desc", style: "flex:none" }, "留下你的名字或座號，之後每一關的反思都會自動交給老師。"),
      inp, el("div", { class: "acts" }, el("button", { class: "btn", onclick: ok }, "確定")))));
    inp.addEventListener("keydown", e => { if (e.key === "Enter") ok(); });
    app.appendChild(back); setTimeout(() => inp.focus(), 60);
  }
  function exportReflections() {
    const nameIn = el("input", { class: "name-in", style: "margin:.6rem auto 0;display:block", placeholder: "姓名或座號", maxlength: "24" });
    nameIn.value = save.studentName || ((save.mode && save.mode !== "solo") ? (save.players || []).filter(Boolean).join("、") : "");
    const codeIn = el("input", { class: "name-in", style: "margin:.5rem auto 0;display:block", placeholder: "課堂代碼（老師給的，繳交才需要）", maxlength: "20" });
    codeIn.value = save.classCode || "";
    const status = el("div", { class: "r-count", style: "text-align:center;min-height:1.4em;margin-top:.5rem" });
    const back = el("div", { class: "er-modal" });
    function doDownload() { const nm = nameIn.value.trim(); downloadText("反思紀錄_" + (nm || "匿名") + ".txt", buildReflectionText(nm)); A.sfx("pickup"); }
    async function doSubmit() {
      const nm = nameIn.value.trim(), code = codeIn.value.trim();
      if (!nm) { status.className = "r-count"; status.textContent = "請先填姓名/座號"; return; }
      if (!code) { status.className = "r-count"; status.textContent = "請填老師給的課堂代碼"; return; }
      if (!(window.COOP && COOP.available)) { status.className = "r-count"; status.textContent = "連線元件載入中，請稍候"; return; }
      status.className = "r-count"; status.textContent = "上傳中…";
      save.studentName = nm; save.classCode = code; persist();
      const o = reflectionsObj();
      const r = await COOP.uploadClass(code, { name: nm, mode: save.mode, solved: (save.solved || []).length, mins: Math.round(playedMs() / 60000), reflections: o.reflections, final: o.final });
      if (r.ok) { status.className = "r-count ok"; status.textContent = "✓ 已繳交到課堂「" + code + "」"; A.sfx("fragment"); }
      else { status.className = "r-count"; status.textContent = "✗ 繳交失敗：" + (r.err || "請稍候再試一次"); }
    }
    const card = el("div", { class: "er-card", style: "max-width:520px" },
      el("div", { class: "body" },
        el("h3", {}, "反思紀錄"),
        el("div", { class: "desc", style: "white-space:pre-line;flex:none" }, "下載成文字檔自己留存，或填課堂代碼繳交給老師。"),
        nameIn, codeIn, status,
        el("div", { class: "acts" },
          el("button", { class: "btn", onclick: doDownload }, "下載 .txt"),
          el("button", { class: "btn", onclick: doSubmit }, "繳交給老師"),
          el("button", { class: "btn ghost", onclick: () => back.remove() }, "關閉"))));
    nameIn.addEventListener("keydown", e => { if (e.key === "Enter") doSubmit(); });
    back.appendChild(card);
    back.appendChild(el("div", { class: "close", onclick: () => back.remove() }, "✕"));
    app.appendChild(back); setTimeout(() => nameIn.focus(), 60);
  }

  /* ===================== 進場儀式（沉浸式 cold open）===================== */
  // 開機只跑一次：黑底淡入第二人稱文案 → 「開啟聲音·推開門」按鈕（同時解開瀏覽器自動播放）→ 標題
  function enterGate() {
    showScreen(GAME.cover, scr => {
      scr.classList.add("narration-screen"); scr.classList.add("sc-cover");
      scr.appendChild(el("div", { class: "cover-mist" }));
      const wrap = el("div", { class: "narration" });
      const lines = [
        "大燈，一盞一盞，熄了。",
        "整座圖書館，只剩你桌上的這盞燈，還亮著。",
        "翻開的書頁上，有人用鉛筆，留了一行字給你……",
      ];
      const btnWrap = el("div", { style: "margin-top:2.2rem;opacity:0;transition:opacity 1.2s ease" },
        el("button", { class: "btn", onclick: () => { A.init(); A.sfx("unlock"); A.music(true, "default"); titleScreen(); } }, "🔊 開啟聲音 · 推開門"));
      scr.appendChild(wrap); scr.appendChild(btnWrap);
      let i = 0;
      (function nextLine() {
        if (i < lines.length) { showLine(wrap, lines[i]); i++; setTimeout(nextLine, 1500); }
        else setTimeout(() => { btnWrap.style.opacity = "1"; }, 400);
      })();
    }, "narration-screen");
  }

  /* ===================== 標題 ===================== */
  function titleScreen() {
    if (window.COOP && COOP.active) COOP.leave(); onlineStarted = false;
    showScreen(GAME.cover, scr => {
      scr.classList.add("sc-title"); scr.classList.add("sc-cover");
      scr.appendChild(el("div", { class: "cover-mist" }));
      const inner = el("div", { class: "title-inner" },
        el("div", { class: "title-kicker" }, "AN ESCAPE OF THE HEART"),
        el("h1", { class: "game-title" }, GAME.title),
        el("div", { class: "title-rule" }),
        el("div", { class: "game-sub" }, GAME.subtitle),
        el("button", { class: "btn start-btn", onclick: () => { A.init(); A.sfx("click"); start(false); } }, save.solved.length ? "繼續旅程" : "開始遊戲")
      );
      if (save.solved.length) inner.appendChild(el("button", { class: "btn ghost", style: "margin-top:1rem",
        onclick: () => { if (confirm("確定要重新開始？進度與反思會清除。")) { save = { solved: [], reflections: {}, final: "", mode: "solo", players: ["", ""] }; persist(); start(true); } } }, "重新開始"));
      if (hasReflectionData()) inner.appendChild(el("button", { class: "btn ghost", style: "margin-top:.7rem",
        onclick: () => { A.sfx("click"); exportReflections(); } }, "📄 匯出反思紀錄"));
      scr.appendChild(inner);
    }, "sc-title");
  }
  function start(forceOpening) { A.init(); if (save.solved.length && !forceOpening) hallScreen(); else modeScreen(); }

  function modeScreen() {
    showScreen(GAME.openingBg, scr => {
      scr.classList.add("sc-title");
      const inA = el("input", { class: "name-in", placeholder: "夥伴一的名字（可留空）", maxlength: "12" });
      const inB = el("input", { class: "name-in", placeholder: "夥伴二的名字（可留空）", maxlength: "12" });
      const nameWrap = el("div", { style: "display:none;flex-direction:column;gap:.6rem;margin-top:1.1rem;align-items:center" },
        inA, inB, el("button", { class: "btn", onclick: () => { A.sfx("click"); save.mode = "duo"; save.players = [inA.value.trim() || "夥伴一", inB.value.trim() || "夥伴二"]; persist(); openingScreen(); } }, "開始合作闖關"));
      scr.appendChild(el("div", { class: "title-inner" },
        el("div", { class: "title-kicker" }, "選擇模式 · CHOOSE MODE"),
        el("h1", { class: "game-title", style: "font-size:clamp(1.6rem,4vw,2.6rem);letter-spacing:.08em" }, "一個人，還是一起？"),
        el("div", { class: "title-rule" }),
        el("div", { style: "display:flex;gap:.7rem;justify-content:center;flex-wrap:wrap;margin-top:.6rem" },
          el("button", { class: "btn", onclick: () => { A.sfx("click"); save.mode = "solo"; save.players = ["", ""]; persist(); openingScreen(); } }, "單人"),
          el("button", { class: "btn ghost", onclick: () => { A.sfx("click"); nameWrap.style.display = "flex"; inA.focus(); } }, "雙人 · 同一台"),
          el("button", { class: "btn ghost", onclick: () => { A.sfx("click"); if (window.COOP && COOP.available) lobbyScreen(); else alert("連線元件載入中，請稍候再試一次"); } }, "雙人 · 各自裝置")),
        (window.COOP && COOP.hasSaved && COOP.hasSaved()) ? el("button", { class: "btn", style: "margin-top:.9rem", onclick: () => reconnectFlow() }, "↻ 重新連線上次房間 " + COOP.savedCode()) : null,
        el("div", { style: "margin-top:1rem;color:var(--parch-dim);font-size:.9rem;letter-spacing:.04em;line-height:1.8;white-space:pre-line" }, "雙人：每關反思兩人都要各自寫滿才能繼續。\n「各自裝置」用四位數房號連線，可分坐兩台電腦或手機。"),
        nameWrap));
    }, "sc-title");
  }

  function lobbyScreen() {
    showScreen(GAME.openingBg, scr => {
      scr.classList.add("sc-title");
      const nameIn = el("input", { class: "name-in", placeholder: "你的名字", maxlength: "12" });
      const codeIn = el("input", { class: "name-in", placeholder: "四位數房號", maxlength: "4", inputmode: "numeric", style: "letter-spacing:.4em;text-align:center;font-family:var(--display)" });
      const status = el("div", { style: "margin-top:1rem;letter-spacing:.04em;min-height:1.6em;color:var(--rose)" });
      const createBtn = el("button", { class: "btn", onclick: async () => {
        A.sfx("click"); status.style.color = "var(--gold-soft)"; status.textContent = "建立房間中…";
        try { const code = await COOP.createRoom(nameIn.value.trim() || "夥伴一"); waitScreen(true, code); }
        catch (e) { status.style.color = "var(--rose)"; status.textContent = "建立失敗：" + (e.code || e.message) + "（資料庫規則可能還沒發布）"; }
      } }, "建立房間");
      const joinBtn = el("button", { class: "btn ghost", onclick: async () => {
        A.sfx("click"); const code = codeIn.value.trim(); if (code.length !== 4) { status.style.color = "var(--rose)"; status.textContent = "請輸入四位數房號"; return; }
        status.style.color = "var(--gold-soft)"; status.textContent = "加入中…";
        try { const r = await COOP.joinRoom(code, nameIn.value.trim() || "夥伴二"); if (!r.ok) { status.style.color = "var(--rose)"; status.textContent = "✗ " + r.err; return; } waitScreen(false, code); }
        catch (e) { status.style.color = "var(--rose)"; status.textContent = "加入失敗：" + (e.code || e.message); }
      } }, "加入房間");
      scr.appendChild(el("div", { class: "title-inner", style: "max-width:560px" },
        el("div", { class: "title-kicker" }, "雙人連線 · ONLINE"),
        el("h1", { class: "game-title", style: "font-size:clamp(1.5rem,3.5vw,2.1rem)" }, "建立或加入房間"),
        el("div", { class: "title-rule" }),
        el("div", { style: "display:flex;flex-direction:column;gap:.8rem;align-items:center;margin-top:.4rem" },
          nameIn,
          el("div", { style: "display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;justify-content:center" }, createBtn, el("span", { style: "color:var(--parch-dim)" }, "或"), codeIn, joinBtn)),
        status,
        el("button", { class: "btn ghost", style: "margin-top:1.1rem", onclick: () => modeScreen() }, "← 返回")));
    }, "sc-title");
  }

  function waitScreen(isHost, code) {
    onlineStarted = false;
    showScreen(GAME.openingBg, scr => {
      scr.classList.add("sc-title");
      const status = el("div", { style: "margin-top:1rem;color:var(--gold-soft);letter-spacing:.04em;line-height:1.9;min-height:2.4em" });
      const startBtn = el("button", { class: "btn", style: "margin-top:1rem;display:none", onclick: async () => { A.sfx("unlock"); await COOP.startGame(); } }, "一起開始！");
      scr.appendChild(el("div", { class: "title-inner" },
        el("div", { class: "title-kicker" }, "房號 · ROOM CODE"),
        el("h1", { class: "game-title", style: "font-size:clamp(2.4rem,6vw,3.6rem);letter-spacing:.4em" }, code),
        el("div", { class: "title-rule" }), status, startBtn,
        el("button", { class: "btn ghost", style: "margin-top:1.1rem", onclick: () => { COOP.leave(); modeScreen(); } }, "取消")));
      function render(s) {
        if (s && s.started) { enterOnlineGame(); return; }
        if (isHost) {
          if (s && s.connected) {
            const on = window.COOP && COOP.peerOnline;
            status.innerHTML = "✓ <b style='color:var(--teal)'>" + (s.peerName || "夥伴") + "</b> 已加入"
              + (on ? " <span style='color:var(--teal)'>●在線</span>" : " <span style='color:var(--rose)'>○離線中…</span>")
              + "！按下開始，一起闖關。";
            startBtn.style.display = "inline-block";
          } else status.textContent = "把上面的房號給夥伴，請他在另一台裝置選「雙人·各自裝置 → 加入房間」。";
        } else status.innerHTML = "✓ 已加入房號 <b>" + code + "</b>。等待對方按「開始」…";
      }
      COOP.onUpdate = render;
      render({ connected: COOP.connected, started: COOP.started, peerName: COOP.peerName });
    }, "sc-title");
  }

  function enterOnlineGame() {
    if (onlineStarted) return; onlineStarted = true;
    save.mode = "online";
    save.players = COOP.role === "host" ? [COOP.selfName, COOP.peerName] : [COOP.peerName, COOP.selfName];
    persist();
    wireOnlineUpdates();
    openingScreen();
  }
  function wireOnlineUpdates() {
    COOP.onUpdate = () => { if (onlineReflRefresh) onlineReflRefresh(); if (onlinePresenceRefresh) onlinePresenceRefresh(); };
  }
  // 重新整理／意外斷線後，用記住的房號重連回上次那一局
  async function reconnectFlow() {
    if (!(window.COOP && COOP.available)) { alert("連線元件還在載入，請稍候再試"); return; }
    A.sfx("click");
    try {
      const r = await COOP.reconnect();
      if (!r.ok) { alert("重連失敗：" + (r.err || "")); return; }
      const cloud = COOP.mySolved();
      if (cloud && cloud.length) { const s = new Set(save.solved || []); cloud.forEach(x => s.add(x)); save.solved = [...s]; }
      save.mode = "online";
      save.players = COOP.role === "host" ? [COOP.selfName, COOP.peerName] : [COOP.peerName, COOP.selfName];
      persist();
      if (r.started) { onlineStarted = true; wireOnlineUpdates(); hallScreen(); }
      else waitScreen(COOP.role === "host", COOP.code);
    } catch (e) { alert("重連失敗：" + (e.code || e.message)); }
  }

  /* ===================== 開場 ===================== */
  function openingScreen() {
    markStarted();
    A.ambient("dust"); A.music(true, "default");
    showScreen(GAME.openingBg, scr => {
      scr.classList.add("narration-screen");
      const wrap = el("div", { class: "narration" }); const tap = el("div", { class: "tap-hint" }, "點擊繼續");
      scr.appendChild(wrap); scr.appendChild(tap); let i = 0;
      function next() { if (i < GAME.opening.length) { showLine(wrap, GAME.opening[i]); i++; } else { scr.removeEventListener("click", next); showNote(); } }
      scr.addEventListener("click", next); next();
      function showNote() { wrap.remove(); scr.appendChild(el("div", { class: "note-card" }, GAME.note)); tap.textContent = "點擊推開第一道門";
        const go = () => { scr.removeEventListener("click", go); hallScreen(); }; setTimeout(() => scr.addEventListener("click", go), 700); }
    }, "narration-screen");
  }

  /* ===================== 大廳 ===================== */
  function hallScreen() {
    markStarted();
    A.stopAmbient(); A.ambient("dust"); A.music(true, "default");
    const s = solvedSet();
    showScreen(GAME.hallBg, scr => {
      scr.classList.add("sc-hall");
      const grid = el("div", { class: "doors" });
      GAME.rooms.forEach((r, idx) => {
        const solved = s.has(r.id);
        const prev = idx === 0 ? null : GAME.rooms[idx - 1];
        const locked = !save.freeUnlock && !solved && !(idx === 0 || s.has(prev.id));   // 依陣列順序解鎖；老師開「自由選關」即全開
        const cls = "door" + (solved ? " solved" : (locked ? " locked" : ""));
        grid.appendChild(el("div", { class: cls, "data-frag": r.fragment,
          onclick: () => { if (locked) { A.sfx("error"); hallToast(scr, "這扇門還沒開啟，先完成前一個房間。"); } else { A.sfx("click"); roomScreen(r); } } },
          el("div", { class: "dnum" }, (locked ? "🔒 " : "") + "第 " + (idx + 1) + " 室"),
          el("div", { class: "dname" }, locked ? "？？？" : (r.doorName || r.theme)),
          el("div", { class: "dperson" }, locked ? "尚未開啟" : r.person),
          el("div", { class: "dfield" }, locked ? "" : r.field)));
      });
      const ready = s.size >= GAME.rooms.length;
      grid.parentNode; // noop
      scr.appendChild(el("div", { class: "hall-inner" },
        el("div", { class: "hall-title" }, "THE HALL OF DOORS"),
        el("div", { class: "hall-intro" }, GAME.hallIntro), grid,
        el("div", { class: "final-door" + (ready ? " ready" : ""), onclick: ready ? () => endingScreen() : null },
          el("div", { class: "fd-title" }, ready ? "✦ 最後一道門 ✦" : "最後一道門"),
          el("div", {}, ready ? GAME.hallClear : `還需要 ${GAME.rooms.length - s.size} 塊心靈碎片`))));
      // 老師用：自由選關開關（預設循序；開啟後十關全開，不影響已存進度）
      scr.appendChild(el("button", { class: "free-toggle" + (save.freeUnlock ? " on" : ""),
        title: "給老師：開啟後所有房間解鎖、可任意選關；不影響已破關進度。",
        onclick: () => { save.freeUnlock = !save.freeUnlock; persist(); A.sfx("click"); hallScreen(); } },
        save.freeUnlock ? "🔓 自由選關中 · 點此恢復循序" : "🔒 循序解鎖 · 老師可開自由選關"));
    }, "sc-hall");
  }

  /* ===================== 房間（密室引擎）===================== */
  function roomScreen(room) {
    const done = {}, opened = {}, taken = {}, clues = []; const inv = []; let selected = null;
    const views = room.views || [room.bg]; let viewIdx = 0; let bgLayer = null, bgLayer2 = null, sceneFront = null, fxLayer = null;
    const visited = new Set([0]);   // 已看過的視角（用來提示還沒環顧到的角度）
    let scrEl, statusEl, statusTxtEl, invEl, hotLayer, notebookEl, badgeEl, presenceEl;

    function norm(s) { return (s || "").trim().toUpperCase().replace(/\s+/g, ""); }
    // 該視角的情境氛圍：viewFx[i] 優先，否則用整間的 mood
    function fxFor(i) { return (room.viewFx && room.viewFx[i] != null) ? room.viewFx[i] : (room.mood || null); }
    function applyViewFx() { const fx = fxFor(viewIdx); if (fxLayer) fxLayer.className = "er-fx" + (fx ? " fx-" + fx : ""); A.viewFx(fx); }
    function refreshPresence() {
      if (!presenceEl) return;
      const on = window.COOP && COOP.peerOnline;
      presenceEl.className = "er-presence" + (on ? " on" : "");
      presenceEl.textContent = (on ? "● " : "○ ") + ((window.COOP && COOP.peerName) || "夥伴") + (on ? " 在線" : " 離線");
    }

    function setStatus(text, who) {
      statusTxtEl.innerHTML = "";
      if (who) statusTxtEl.appendChild(el("span", { class: "who" }, who + "："));
      const span = el("span", {}); statusTxtEl.appendChild(span); typewriter(span, text);
    }
    function addClue(text, src) {
      if (clues.some(c => c.text === text)) return;
      clues.push({ text, src }); A.sfx("search"); renderNotebook();
      if (badgeEl) badgeEl.textContent = clues.length;
    }
    function renderNotebook() {
      notebookEl.innerHTML = "";
      notebookEl.appendChild(el("h2", {}, "線索筆記", el("span", { class: "x", onclick: () => notebookEl.classList.remove("open") }, "✕")));
      if (!clues.length) { notebookEl.appendChild(el("div", { class: "er-empty" }, "還沒有找到線索。\n點場景裡發亮的圈圈，四處搜查吧。")); }
      else clues.forEach(c => notebookEl.appendChild(el("div", { class: "er-note" }, el("span", { class: "src" }, "◆ " + c.src), c.text)));
      if (inv.length) {
        notebookEl.appendChild(el("h2", { style: "margin-top:1.6rem" }, "道具"));
        inv.forEach(id => { const it = GAME.items[id] || {}; notebookEl.appendChild(el("div", { class: "er-note" }, el("span", { class: "src" }, "🎒 " + (it.name || id)), it.desc || "")); });
      }
    }
    function renderInv() {
      invEl.innerHTML = "";
      if (!inv.length) { invEl.appendChild(el("div", { class: "hintlbl" }, "道具欄（找到的東西會放這裡）")); return; }
      invEl.appendChild(el("div", { class: "hintlbl" }, "道具（點選後再點場景使用）："));
      inv.forEach(id => { const it = GAME.items[id] || {};
        const slot = el("div", { class: "er-slot" + (selected === id ? " sel" : ""), title: it.name || id, onclick: () => toggleSelect(id) });
        slot.appendChild(it.img ? el("img", { src: it.img, alt: it.name }) : el("span", {}, "🔑")); invEl.appendChild(slot); });
    }
    function toggleSelect(id) { selected = selected === id ? null : id; scrEl.classList.toggle("using", !!selected); renderInv();
      if (selected) { const it = GAME.items[selected] || {}; setStatus("選了「" + (it.name || selected) + "」。點場景中要使用的地方。"); A.sfx("click"); } }

    function modal(opts) {
      const back = el("div", { class: "er-modal" }); const card = el("div", { class: "er-card" });
      if (opts.img) card.appendChild(el("div", { class: "pic" }, el("img", { src: opts.img, alt: "" })));
      const body = el("div", { class: "body" }, el("h3", {}, opts.title || "檢視"), el("div", { class: "desc", html: opts.descHtml || "" }));
      const acts = el("div", { class: "acts" });
      (opts.acts || []).forEach(a => acts.appendChild(el("button", { class: "btn" + (a.primary ? "" : " ghost"), onclick: a.fn }, a.label)));
      acts.appendChild(el("button", { class: "btn ghost", onclick: close }, opts.closeLabel || "關閉"));
      body.appendChild(acts); card.appendChild(body); back.appendChild(card);
      back.appendChild(el("div", { class: "close", onclick: close }, "✕")); scrEl.appendChild(back);
      function close() { back.remove(); opts.onClose && opts.onClose(); }
      return { close, back };
    }

    function lockModal(opts) {
      // 純數字鎖→手機跳數字鍵盤；文字鎖→一般鍵盤（上線版明文已刪，numeric 由 build 給）
      const numeric = opts.numeric != null ? !!opts.numeric : (opts.answer || []).every(a => /^\d+$/.test(String(a)));
      const input = el("input", { type: "text", inputmode: numeric ? "numeric" : null, placeholder: opts.len ? "（" + opts.len + " 碼）" : "", autocomplete: "off", spellcheck: "false" });
      const fb = el("div", { class: "feedback" }); const hintsWrap = el("div", { class: "hints" }); let hi = 0;
      const hintBtn = (opts.hints && opts.hints.length) ? el("button", { class: "btn ghost", onclick: () => {
        if (hi < opts.hints.length) { hintsWrap.appendChild(el("div", { class: "hint", html: "<b>提示 " + (hi + 1) + "：</b>" + opts.hints[hi] })); hi++; A.sfx("click"); if (hi >= opts.hints.length) hintBtn.style.display = "none"; }
      } }, "需要提示") : null;
      const submit = el("button", { class: "btn", onclick: check }, "解鎖");
      const body = el("div", { class: "body" },
        el("h3", {}, opts.title || "密碼鎖"),
        opts.prompt ? el("div", { class: "desc", html: opts.prompt }) : null,
        el("div", { class: "lock" }, el("span", { class: "lock-label" }, "密碼"), input),
        el("div", { class: "actions" }, submit, hintBtn), fb, hintsWrap);
      const card = el("div", { class: "er-card" }, body);
      const back = el("div", { class: "er-modal" }, card); back.appendChild(el("div", { class: "close", onclick: close }, "✕"));
      scrEl.appendChild(back); input.focus(); input.addEventListener("keydown", e => { if (e.key === "Enter") check(); });
      async function check() { const v = norm(input.value); if (!v) return;
        if (await answerOK(v, opts.answer, opts.answerHash)) {
          fb.className = "feedback ok"; fb.textContent = "✦ 正確";
          if (!REDUCED && window.gsap) {       // 解鎖的小慶祝：卡片彈一下＋輸入框上方迸火花
            const r = input.getBoundingClientRect(); burst(r.left + r.width / 2, r.top, 10);
            gsap.fromTo(card, { scale: 1 }, { scale: 1.02, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.inOut" });
          }
          setTimeout(() => { back.remove(); opts.onSolved(); }, 600);
        }
        else { fb.className = "feedback err"; fb.textContent = "不對……再想想，或看看提示。"; input.classList.add("shake"); A.sfx("error"); setTimeout(() => input.classList.remove("shake"), 460); } }
      function close() { back.remove(); }
    }

    function examine(h, used) {
      done[h.id] = true; if (h.clue) addClue(h.clue, h.name); renderHotspots();
      const desc = (used && h.useText ? h.useText + "\n\n" : "") + (h.look || "");
      const acts = [];
      if (h.gives && !taken[h.id]) { const it = GAME.items[h.gives]; acts.push({ label: "拿取「" + (it ? it.name : "道具") + "」", primary: true, fn: () => { takeItem(h); m.close(); } }); }
      const m = modal({ title: h.name, img: h.img, descHtml: desc, acts });
    }
    function takeItem(h) { taken[h.id] = true; if (inv.indexOf(h.gives) < 0) inv.push(h.gives); A.sfx("pickup"); renderInv(); renderNotebook();
      const it = GAME.items[h.gives] || {}; setStatus("獲得道具：" + (it.name || h.gives)); }

    function onHotspot(h) {
      A.sfx("click");
      if (selected) {
        if (h.needItem === selected && !opened[h.id]) { opened[h.id] = true; A.sfx("open"); const was = selected; toggleSelect(was); examine(h, true); }
        else setStatus("這個東西，用不到這裡。");
        return;
      }
      if (h.lock && !opened[h.id]) { openLock(h); return; }
      if (h.needItem && !opened[h.id]) { modal({ title: h.name, img: h.img, descHtml: h.lockedText || "這裡鎖著，似乎需要某個道具。" }); return; }
      examine(h, false);
    }
    function openLock(h) {
      lockModal({ title: h.name, prompt: h.look || h.lock.prompt, answer: h.lock.answer, answerHash: h.lock.answerHash, numeric: h.lock.numeric, len: h.lock.len, hints: h.lock.hints,
        onSolved: () => { opened[h.id] = true; done[h.id] = true; A.sfx("unlock");
          if (h.lock.clue) addClue(h.lock.clue, h.name);
          if (h.lock.gives && inv.indexOf(h.lock.gives) < 0) { inv.push(h.lock.gives); renderInv(); }
          renderHotspots(); modal({ title: h.name, descHtml: h.lock.solved || "開了。" }); } });
    }
    function openDoor() {
      const d = room.door;
      // 線索閘：每個亮圈（含子鎖、道具）都搜過/解過，門才肯理你——確保「找齊所有線索才有辦法解答」
      const left = room.hotspots.filter(h => !done[h.id]).length;
      if (left > 0) {
        A.sfx("error");
        setStatus("門沒有反應……這房間還有 " + left + " 個地方沒搜清楚。轉轉視角（← →），把亮圈都看過一遍。");
        return;
      }
      lockModal({ title: d.kind || "最終門鎖", prompt: d.recap, answer: d.answer, answerHash: d.answerHash, numeric: d.numeric, len: d.len, hints: d.hints,
        onSolved: () => showAffective(() => complete(d)) });
    }
    function complete(d) {
      flash(); fragPop(); A.sfx("fragment");
      if (!save.solved.includes(room.id)) save.solved.push(room.id); persist();
      if (save.mode === "online" && window.COOP && COOP.active) COOP.syncSolved(save.solved);
      modal({ title: room.person, img: room.portrait, descHtml: (d.solved ? d.solved + "\n\n" : "") + room.success, closeLabel: "繼續", onClose: () => showEgg(showReflection) });
    }
    // 彩蛋：門開之後，書縫裡掉出一張泛黃書籤，寫著這位人物的真實小故事
    function showEgg(then) {
      if (!room.egg) { then(); return; }
      A.sfx("search");
      const card = el("div", { class: "egg-card" },
        el("div", { class: "egg-head" }, "📖 彩蛋 · 書縫裡掉出一張泛黃的書籤"),
        el("div", { class: "egg-body" }, room.egg),
        el("div", { class: "egg-acts" }, el("button", { class: "btn", onclick: () => { A.sfx("pickup"); back.remove(); then(); } }, "收進口袋")));
      const back = el("div", { class: "er-modal" }, card);
      scrEl.appendChild(back);
      if (!REDUCED && window.gsap) gsap.from(card, { y: -32, rotation: -3, opacity: 0, duration: 0.7, ease: "power2.out" });
    }
    // 學科門解開後的「心門」：一題情意題，答對才真正過關
    function showAffective(onPass) {
      const aff = room.affective;
      if (!aff) { onPass(); return; }
      const multi = !!aff.multi, selected = new Set(), optEls = [];
      const fb = el("div", { class: "feedback" });
      async function evaluate(chosen) {
        // 上線版：正解組合只存雜湊（affHash），選項上沒有 ok 標記可偷看；明文 ok 僅本機測試後援
        let ok;
        if (aff.affHash) ok = chosen.size > 0 && (await sha256("aff|" + [...chosen].sort((a, b) => a - b).join(","))) === aff.affHash;
        else ok = aff.options.every((o, i) => !!o.ok === chosen.has(i)) && chosen.size > 0;
        if (ok) { A.sfx("unlock"); fb.className = "feedback ok"; fb.textContent = "✦ " + (aff.right || "答對了"); optEls.forEach(b => b.disabled = true); setTimeout(() => { back.remove(); onPass(); }, 1400); }
        else { A.sfx("error"); fb.className = "feedback err"; fb.textContent = aff.wrong || "再想想……"; }
      }
      aff.options.forEach((o, i) => {
        const b = el("button", { class: "aff-opt", onclick: () => {
          if (multi) { if (selected.has(i)) { selected.delete(i); b.classList.remove("sel"); } else { selected.add(i); b.classList.add("sel"); } }
          else evaluate(new Set([i]));
        } }, o.t);
        optEls.push(b);
      });
      const body = el("div", { class: "body" },
        el("h3", {}, "✦ 心　門 ✦"),
        el("div", { class: "desc", style: "white-space:pre-line;margin-bottom:1rem" }, aff.q),
        optEls,
        multi ? el("div", { class: "actions", style: "margin-top:.8rem" }, el("button", { class: "btn", onclick: () => evaluate(selected) }, "確認")) : null,
        fb);
      const back = el("div", { class: "er-modal" }, el("div", { class: "er-card", style: "max-width:680px" }, body));
      scrEl.appendChild(back);
    }
    function showReflection() {
      A.music(false);
      if (save.mode === "online" && window.COOP && COOP.active) { showReflectionOnline(); return; }
      const MIN = 20, duo = save.mode === "duo";
      const rec = save.reflections[room.id], recObj = (rec && typeof rec === "object") ? rec : null;
      const boxes = [], fields = [];
      function field(label, initial) {
        const ta = el("textarea", { placeholder: "寫下你的想法（至少 " + MIN + " 個字）……" });
        ta.value = initial || "";
        const cnt = el("div", { class: "r-count" });
        ta.addEventListener("input", update);
        boxes.push({ ta, cnt });
        fields.push(el("div", { class: "r-field" }, label ? el("div", { class: "r-label" }, label) : null, ta, cnt));
      }
      if (duo) { field("🤝 " + (save.players[0] || "夥伴一"), recObj && recObj.a); field("🤝 " + (save.players[1] || "夥伴二"), recObj && recObj.b); }
      else field(null, typeof rec === "string" ? rec : "");
      const clen = s => [...(s || "").trim()].length;
      const ready = () => boxes.every(b => clen(b.ta.value) >= MIN);
      function update() {
        if (duo) save.reflections[room.id] = { a: boxes[0].ta.value, b: boxes[1].ta.value };
        else save.reflections[room.id] = boxes[0].ta.value;
        persist();
        boxes.forEach(b => { const c = clen(b.ta.value); b.cnt.textContent = c >= MIN ? ("✓ 已寫 " + c + " 字") : ("還需要 " + (MIN - c) + " 個字"); b.cnt.className = "r-count" + (c >= MIN ? " ok" : ""); });
        const ok = ready(); btn.disabled = !ok; btn.classList.toggle("dim", !ok);
      }
      const btn = el("button", { class: "btn", onclick: () => { if (ready()) { back.remove(); ensureStudentName(() => { autoSubmitClass(); leaveRoom(); }); } } }, "收下，回到大廳");
      const panel = el("div", { class: "reflect" },
        el("div", { class: "gain" }, "你獲得了一塊心靈碎片", el("span", { class: "word" }, room.fragment)),
        el("div", { class: "q" }, room.reflection));
      fields.forEach(f => panel.appendChild(f));
      panel.appendChild(el("div", { class: "r-actions" }, btn));
      const back = el("div", { class: "er-modal" }, panel);
      scrEl.appendChild(back);
      update();
    }
    function showReflectionOnline() {
      const MIN = 20, me = COOP.selfName || "你";
      const ta = el("textarea", { placeholder: "寫下你的想法（至少 " + MIN + " 個字）……" });
      ta.value = (typeof save.reflections[room.id] === "string" ? save.reflections[room.id] : "") || "";
      const cnt = el("div", { class: "r-count" }), wait = el("div", { class: "r-count", style: "text-align:left" });
      const clen = s => [...(s || "").trim()].length;
      const sendBtn = el("button", { class: "btn", onclick: () => { if (clen(ta.value) >= MIN) { COOP.submitReflect(room.id); ta.disabled = true; sendBtn.style.display = "none"; refresh(); } } }, "送出我的反思");
      const nextBtn = el("button", { class: "btn", style: "display:none", onclick: () => { onlineReflRefresh = null; back.remove(); ensureStudentName(() => { autoSubmitClass(); leaveRoom(); }); } }, "一起進入下一關 →");
      function refresh() {
        const st = COOP.reflectDone(room.id);
        if (st.me && st.peer) { wait.innerHTML = "✓ 兩人都完成了！"; wait.className = "r-count ok"; nextBtn.style.display = "inline-block"; }
        else if (st.me) { wait.textContent = "✓ 你已送出，等待 " + (COOP.peerName || "夥伴") + " 的反思…"; wait.className = "r-count"; }
        else wait.textContent = "";
      }
      ta.addEventListener("input", () => {
        save.reflections[room.id] = ta.value; persist();
        const c = clen(ta.value); cnt.textContent = c >= MIN ? ("✓ " + c + " 字") : ("還需要 " + (MIN - c) + " 個字"); cnt.className = "r-count" + (c >= MIN ? " ok" : "");
        sendBtn.disabled = c < MIN; sendBtn.classList.toggle("dim", c < MIN);
      });
      onlineReflRefresh = refresh;
      const panel = el("div", { class: "reflect" },
        el("div", { class: "gain" }, "你獲得了一塊心靈碎片", el("span", { class: "word" }, room.fragment)),
        el("div", { class: "q" }, room.reflection),
        el("div", { class: "r-field" }, el("div", { class: "r-label" }, "🤝 你（" + me + "）"), ta, cnt),
        el("div", { class: "r-actions" }, sendBtn), wait, el("div", { class: "r-actions" }, nextBtn));
      const back = el("div", { class: "er-modal" }, panel);
      scrEl.appendChild(back);
      ta.dispatchEvent(new Event("input")); refresh();
    }
    function leaveRoom() { A.stopAmbient(); A.music(false); A.viewFx(null); onlinePresenceRefresh = null; hallScreen(); }

    function hsView(h) {
      if (h.view != null) return h.view;
      if (h.pencil) return views.length - 1;
      const list = room.hotspots.filter(x => !x.pencil && x.view == null);
      const i = list.indexOf(h);
      return i < 0 ? 0 : (i % views.length);
    }
    function renderHotspots() {
      hotLayer.innerHTML = "";
      room.hotspots.forEach(h => {
        if (hsView(h) !== viewIdx) return;
        const blocked = (h.needItem || h.lock) && !opened[h.id];
        const hs = el("div", { class: "er-hotspot" + (done[h.id] ? " done" : "") + (blocked ? " locked" : ""), onclick: () => onHotspot(h) });
        hs.style.left = h.x + "%"; hs.style.top = h.y + "%";
        hs.appendChild(el("div", { class: "ring" }, done[h.id] ? "✓" : (blocked ? "🔒" : "🔍")));
        hs.appendChild(el("div", { class: "lbl" }, h.name));
        hotLayer.appendChild(hs);
      });
      const d = room.door;
      if ((d.view != null ? d.view : 0) === viewIdx) {
        const allDone = room.hotspots.every(h => done[h.id]);
        const door = el("div", { class: "er-hotspot door" + (allDone ? " ready" : ""), onclick: () => { A.sfx("click"); openDoor(); } });
        door.style.left = d.x + "%"; door.style.top = d.y + "%";
        door.appendChild(el("div", { class: "ring" }, d.kind === "保險箱" ? "🧰" : "🚪"));
        door.appendChild(el("div", { class: "lbl" }, d.kind === "保險箱" ? "保險箱" : "門（出口）"));
        hotLayer.appendChild(door);
      }
    }
    function renderViewDots() {
      const wrap = scrEl && scrEl.querySelector(".er-viewdots"); if (!wrap) return;
      wrap.innerHTML = ""; views.forEach((_, i) => wrap.appendChild(el("div", { class: "er-vdot" + (i === viewIdx ? " on" : "") + (visited.has(i) ? "" : " unseen") })));
    }
    function setView(i) {
      viewIdx = (i + views.length) % views.length; visited.add(viewIdx);
      // 兩層交叉淡入：新圖載到「備援層」疊在上面淡入，舊圖留在下方不透明永遠蓋住底圖，不會再閃回主視角
      const back = (sceneFront === bgLayer) ? bgLayer2 : bgLayer;
      back.style.backgroundImage = `url("${views[viewIdx]}")`;
      back.style.zIndex = "1"; if (sceneFront) sceneFront.style.zIndex = "0";
      if (REDUCED) back.style.opacity = "1";
      else if (window.gsap) gsap.fromTo(back, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.inOut" });
      else { back.style.transition = "opacity .45s ease"; back.style.opacity = "0"; void back.offsetWidth; back.style.opacity = "1"; }
      sceneFront = back;
      applyViewFx(); renderHotspots(); renderViewDots(); updateArrowHint(); A.sfx("search");
    }
    function updateArrowHint() {   // 還沒環顧完所有視角時，左右箭頭發亮提示
      if (!scrEl) return;
      const allSeen = visited.size >= views.length;
      scrEl.querySelectorAll(".er-arrow").forEach(a => a.classList.toggle("hint", !allSeen));
    }

    function toolBtn(label, id, fn) { const b = el("button", { class: "er-btn", onclick: fn }, label); if (id === "nb") { badgeEl = el("span", { class: "badge" }, "0"); b.appendChild(badgeEl); } return b; }

    showScreen(views[0], scr => {
      scr.classList.add("sc-er"); scrEl = scr;
      bgLayer = el("div", { class: "er-scenebg" }); bgLayer.style.backgroundImage = `url("${views[viewIdx]}")`; bgLayer.style.opacity = "1"; scr.appendChild(bgLayer);
      bgLayer2 = el("div", { class: "er-scenebg" }); bgLayer2.style.opacity = "0"; scr.appendChild(bgLayer2);   // 第二場景層，供視角交叉淡入
      sceneFront = bgLayer;
      fxLayer = el("div", { class: "er-fx" }); scr.appendChild(fxLayer);
      if (views.length > 1) {
        scr.appendChild(el("div", { class: "er-arrow left", title: "往左看", onclick: () => setView(viewIdx - 1) }, "‹"));
        scr.appendChild(el("div", { class: "er-arrow right", title: "往右看", onclick: () => setView(viewIdx + 1) }, "›"));
        scr.appendChild(el("div", { class: "er-viewdots" }));
      }
      scr.appendChild(el("div", { class: "er-bar top" })); scr.appendChild(el("div", { class: "er-bar bottom" }));
      scr.appendChild(el("div", { class: "er-hud" },
        el("div", { class: "left" }, el("div", { class: "er-tag" }, room.field + "　", el("b", {}, room.person), "　·　" + room.theme)),
        fragTray(),
        el("div", { class: "er-tools" }, toolBtn("📓 線索", "nb", toggleNotebook), toolBtn(A.isMuted() ? "🔇" : "🔊", "mute", toggleMute), el("button", { class: "er-btn", onclick: leaveRoom }, "← 回大廳"))));
      hotLayer = el("div", { style: "position:absolute;inset:0;z-index:12" }); scr.appendChild(hotLayer);
      statusTxtEl = el("div", { class: "er-txt" });
      statusEl = el("div", { class: "er-status" }, el("img", { class: "er-portrait", src: room.portrait, alt: room.person }), statusTxtEl);
      scr.appendChild(statusEl);
      invEl = el("div", { class: "er-inv" }); scr.appendChild(invEl);
      notebookEl = el("div", { class: "er-panel" }); scr.appendChild(notebookEl);
      if (save.mode === "online") { presenceEl = el("div", { class: "er-presence" }); scr.appendChild(presenceEl); onlinePresenceRefresh = refreshPresence; }
      renderHotspots(); renderInv(); renderNotebook(); renderViewDots();
      applyViewFx(); updateArrowHint(); refreshPresence();
      showChapter();
    }, "sc-er");

    function toggleNotebook() { A.sfx("click"); notebookEl.classList.toggle("open"); }
    function toggleMute() { const m = A.toggle(); const btns = scrEl.querySelectorAll(".er-tools .er-btn"); if (btns[1]) btns[1].textContent = m ? "🔇" : "🔊"; }

    function showChapter() {
      A.sfx("chapter");
      const card = el("div", { class: "er-chapter" },
        el("div", { class: "no" }, room.chapter.no), el("div", { class: "ti" }, room.chapter.title),
        el("div", { class: "ru" }), el("div", { class: "qu" }, room.chapter.quote),
        room.mantra ? el("div", { class: "mantra" }, room.mantra) : null);
      scrEl.appendChild(card); let gone = false;
      const dismiss = () => { if (gone) return; gone = true; card.style.transition = "opacity .8s"; card.style.opacity = 0; setTimeout(() => card.remove(), 820);
        A.ambient(room.ambient); A.music(true, room.bgm || ("r" + room.id));
        setStatus(room.enter); setTimeout(() => setStatus(room.greeting, room.person), 2600); };
      card.addEventListener("click", dismiss); setTimeout(dismiss, 5200);
    }
  }

  /* ===================== 結局 ===================== */
  function endingScreen() {
    A.stopAmbient(); A.music(true, "ending");
    showScreen(GAME.ending.bg, scr => {
      scr.classList.add("narration-screen"); scr.classList.add("sc-ending");
      const wrap = el("div", { class: "narration" }); const tap = el("div", { class: "tap-hint" }, "點擊繼續");
      scr.appendChild(wrap); scr.appendChild(tap); let i = 0;
      function next() { if (i < GAME.ending.lines.length) { showLine(wrap, GAME.ending.lines[i]); i++; } else { scr.removeEventListener("click", next); finale(); } }
      scr.addEventListener("click", next); next();
      // 先收「想帶走的一句話」（用反思同款視窗：手機可捲、按鈕一定按得到），
      // 送出後才跑碎片＋十句話的收尾動畫，避免內容過長把輸入框/按鈕擠出畫面。
      function finale() {
        tap.remove(); wrap.innerHTML = "";
        const MIN = 20, duo = save.mode === "duo";
        const fObj = (save.final && typeof save.final === "object") ? save.final : null;
        const fboxes = [], ffields = [];
        function ffield(label, initial) {
          const ta = el("textarea", { placeholder: "至少 " + MIN + " 個字……" });
          ta.value = initial || "";
          const cnt = el("div", { class: "r-count" });
          ta.addEventListener("input", fupdate);
          fboxes.push({ ta, cnt });
          ffields.push(el("div", { class: "r-field" }, label ? el("div", { class: "r-label" }, label) : null, ta, cnt));
        }
        if (duo) { ffield("🤝 " + (save.players[0] || "夥伴一"), fObj && fObj.a); ffield("🤝 " + (save.players[1] || "夥伴二"), fObj && fObj.b); }
        else ffield(null, typeof save.final === "string" ? save.final : "");
        const clen = s => [...(s || "").trim()].length;
        const fready = () => fboxes.every(b => clen(b.ta.value) >= MIN);
        function fupdate() {
          if (duo) save.final = { a: fboxes[0].ta.value, b: fboxes[1].ta.value }; else save.final = fboxes[0].ta.value;
          persist();
          fboxes.forEach(b => { const c = clen(b.ta.value); b.cnt.textContent = c >= MIN ? ("✓ 已寫 " + c + " 字") : ("還需要 " + (MIN - c) + " 個字"); b.cnt.className = "r-count" + (c >= MIN ? " ok" : ""); });
          fbtn.disabled = !fready(); fbtn.classList.toggle("dim", !fready());
        }
        const fbtn = el("button", { class: "btn", onclick: () => { if (fready()) { A.sfx("pickup"); ensureStudentName(() => { autoSubmitClass(); back.remove(); closing(); }); } } }, "寫好了，送出");
        const panel = el("div", { class: "reflect" },
          el("div", { class: "q", style: "text-align:center" }, GAME.ending.finalPrompt));
        ffields.forEach(f => panel.appendChild(f));
        panel.appendChild(el("div", { class: "r-actions" }, fbtn));
        const back = el("div", { class: "er-modal" }, panel);
        scr.appendChild(back);
        fupdate();
      }
      function closing() {
        const frags = el("div", { class: "ending-frags" });
        GAME.rooms.forEach((r, k) => frags.appendChild(el("div", { class: "ef", style: `animation-delay:${k * 0.12}s` }, r.fragment)));
        wrap.appendChild(frags);
        if (GAME.ending.messageIntro) wrap.appendChild(el("div", { style: "margin:1.4rem 0 .5rem;color:var(--gold-soft);letter-spacing:.12em" }, GAME.ending.messageIntro));
        const msg = el("div", { class: "ending-msg" });
        GAME.rooms.forEach((r, k) => { if (r.line) msg.appendChild(el("div", { class: "em-line", style: `animation-delay:${0.7 + k * 0.3}s` }, r.line)); });
        wrap.appendChild(msg);
        // 揭曉總遊戲時間（第一次走到結局就凍結，之後重看不再累計）
        if (save.doneMs == null) { save.doneMs = save.playMs || 0; persist(); }
        wrap.appendChild(el("div", { class: "ending-time", style: `animation-delay:${0.7 + GAME.rooms.length * 0.3 + 0.35}s` }, "⏱ 這趟心靈逃脫，你走了 " + fmtDur(playedMs())));
        const btnRow = el("div", { style: "margin-top:1.7rem;text-align:center;opacity:0;transition:opacity 1.2s ease;pointer-events:none" },
          el("button", { class: "btn", onclick: () => { A.sfx("click"); titleScreen(); } }, GAME.ending.finalButton),
          el("button", { class: "btn ghost", style: "margin-left:.6rem", onclick: () => { A.sfx("click"); exportReflections(); } }, "📄 匯出反思紀錄"));
        wrap.appendChild(btnRow);
        A.sfx("fragment"); if (!REDUCED) burst(innerWidth / 2, innerHeight * 0.3, 14);
        setTimeout(() => { btnRow.style.opacity = "1"; btnRow.style.pointerEvents = "auto"; }, REDUCED ? 150 : 700 + GAME.rooms.length * 300 + 900);
      }
    }, "narration-screen");
  }

  /* ===================== 光塵 ===================== */
  function initDust() {
    if (REDUCED) return;   // 減少動態：不跑光塵粒子
    const c = document.getElementById("dust"); if (!c) return; const ctx = c.getContext("2d"); let w, h, parts;
    const mk = () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.5 + 0.4, vx: (Math.random() - 0.5) * 0.1, vy: -(Math.random() * 0.2 + 0.04), a: Math.random() * 0.5 + 0.2, tw: Math.random() * 6.28 });
    function resize() { w = c.width = innerWidth; h = c.height = innerHeight; parts = Array.from({ length: Math.min(64, Math.floor(w / 26)) }, mk); }
    function loop() { ctx.clearRect(0, 0, w, h); for (const p of parts) { p.x += p.vx; p.y += p.vy; p.tw += 0.02; if (p.y < -6) { p.y = h + 6; p.x = Math.random() * w; } if (p.x < -6) p.x = w + 6; if (p.x > w + 6) p.x = -6; const a = p.a * (0.55 + 0.45 * Math.sin(p.tw)); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fillStyle = `rgba(232,202,142,${a})`; ctx.shadowBlur = 6; ctx.shadowColor = "rgba(230,190,120,.6)"; ctx.fill(); } requestAnimationFrame(loop); }
    resize(); addEventListener("resize", resize); loop();
  }

  initDust(); enterGate();
})();
