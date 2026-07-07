/* ===========================================================
   聲音系統 — 全部用 Web Audio 程式合成（免外部音檔、可離線）
   提供 window.SND：init / ambient / sfx / music / toggle
   =========================================================== */
(function () {
  "use strict";
  let ctx = null, master = null, muted = false;
  let ambNodes = [], musNodes = [], musTimer = null;
  let fxNodes = [], fxKey = null, fxTimer = null, rainEl = null, rainFailed = false;
  let reverb = null;
  let bgmEl = null, bgmKey = null;
  const BGM = { default: "bgm/music_default.mp3", ending: "bgm/music_ending.mp3",
    r1: "bgm/music_r1.mp3", r2: "bgm/music_r2.mp3", r3: "bgm/music_r3.mp3", r4: "bgm/music_r4.mp3",
    r5: "bgm/music_r5.mp3", r6: "bgm/music_r6.mp3", r7: "bgm/music_r7.mp3" };

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
      reverb = ctx.createConvolver(); reverb.buffer = makeIR(2.4, 2.2);
      const rg = ctx.createGain(); rg.gain.value = 0.5; reverb.connect(rg); rg.connect(master);
      reverb._wet = rg;
      return true;
    } catch (e) { return false; }
  }
  function init() { if (ensure() && ctx.state === "suspended") ctx.resume(); }

  // 產生殘響用的脈衝
  function makeIR(seconds, decay) {
    const rate = ctx.sampleRate, len = rate * seconds;
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function noiseBuffer(sec) {
    const len = ctx.sampleRate * sec, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /* ---------- 環境音 ---------- */
  function stopAmbient() {
    ambNodes.forEach(n => { try { n.stop ? n.stop() : n.disconnect(); } catch (e) {} });
    ambNodes = [];
  }
  function ambient(type) {
    stopAmbient();
    return; // 合成環境音(白噪聲)太吵，停用；氛圍改交給 Lyria 背景音樂。以下保留但不執行。
    if (!ensure()) return;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(master);
    out.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);
    ambNodes.push(out);

    if (type === "rain") {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(3); src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1100;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7000;
      const g = ctx.createGain(); g.gain.value = 0.35;
      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
      src.start(); ambNodes.push(src);
    } else if (type === "wind" || type === "autumn" || type === "snow") {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(3); src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 500; bp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0.28;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.1;
      const lg = ctx.createGain(); lg.gain.value = 320; lfo.connect(lg); lg.connect(bp.frequency);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(); lfo.start(); ambNodes.push(src, lfo);
    } else if (type === "candle" || type === "lab") {
      // 低頻嗡鳴 + 偶發劈啪
      const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = type === "lab" ? 60 : 80;
      const g = ctx.createGain(); g.gain.value = 0.06; osc.connect(g); g.connect(out); osc.start();
      ambNodes.push(osc);
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(3); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600;
      const ng = ctx.createGain(); ng.gain.value = 0.05; src.connect(lp); lp.connect(ng); ng.connect(out);
      src.start(); ambNodes.push(src);
    } else { // dust / 預設：柔和空氣感
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(3); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      const g = ctx.createGain(); g.gain.value = 0.06; src.connect(lp); lp.connect(g); g.connect(out);
      src.start(); ambNodes.push(src);
    }
  }

  /* ---------- 視角情境氛圍（低音量、轉到該視角才出現、轉走即停）---------- */
  // 真實雨聲 MP3（Lyria 生成）；若載入失敗，自動退回下方白噪合成雨
  function playRainMp3() {
    if (!rainEl) {
      rainEl = new Audio("bgm/sfx_rain.mp3"); rainEl.loop = true; rainEl.preload = "auto";
      rainEl.addEventListener("error", () => { rainFailed = true; if (fxKey === "rain") { fxKey = null; viewFx("rain"); } });
    }
    rainEl.volume = muted ? 0 : 0.55;
    const p = rainEl.play(); if (p && p.catch) p.catch(() => {});
  }
  function stopFx() {
    if (fxTimer) clearTimeout(fxTimer); fxTimer = null;
    fxNodes.forEach(n => { try { n.stop ? n.stop() : n.disconnect(); } catch (e) {} });
    fxNodes = [];
    if (rainEl) { try { rainEl.pause(); } catch (e) {} }
  }
  function viewFx(type) {
    type = type || null;
    if (type === fxKey) return;          // 沒變就不重啟
    stopFx(); fxKey = type;
    if (!type) return;
    if (type === "rain" && !rainFailed) { playRainMp3(); return; }   // 真實雨聲（優先）
    if (!ensure()) return;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(master); fxNodes.push(out);
    let target = 0.10;
    if (type === "rain") {               // 合成雨：雨幕 + 細雨絲 + 隨機水滴 patter + 一陣陣起伏（比單層白噪自然）
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(4); src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 500;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 8200;
      const body = ctx.createGain(); body.gain.value = 0.7;
      src.connect(hp); hp.connect(lp); lp.connect(body); body.connect(out); src.start(); fxNodes.push(src);
      const src2 = ctx.createBufferSource(); src2.buffer = noiseBuffer(4); src2.loop = true;   // 高頻雨絲層
      const bp2 = ctx.createBiquadFilter(); bp2.type = "bandpass"; bp2.frequency.value = 5200; bp2.Q.value = 0.5;
      const g2 = ctx.createGain(); g2.gain.value = 0.22;
      src2.connect(bp2); bp2.connect(g2); g2.connect(out); src2.start(); fxNodes.push(src2);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;                          // 緩慢起伏：一陣陣的雨
      const lg = ctx.createGain(); lg.gain.value = 0.18; lfo.connect(lg); lg.connect(body.gain); lfo.start(); fxNodes.push(lfo);
      const drop = () => {                                                                       // 隨機水滴點滴聲（雨感關鍵）
        if (fxKey !== "rain" || !ctx) return;
        const ds = ctx.createBufferSource(); ds.buffer = noiseBuffer(0.05);
        const df = ctx.createBiquadFilter(); df.type = "bandpass"; df.frequency.value = 1700 + Math.random() * 3600; df.Q.value = 7 + Math.random() * 10;
        const dg = ctx.createGain(); const v = 0.05 + Math.random() * 0.08;
        dg.gain.setValueAtTime(v, ctx.currentTime); dg.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05 + Math.random() * 0.07);
        ds.connect(df); df.connect(dg); dg.connect(out); ds.start(); ds.stop(ctx.currentTime + 0.15);
        fxTimer = setTimeout(drop, 22 + Math.random() * 100);
      };
      fxTimer = setTimeout(drop, 40);
      target = 0.16;
    } else if (type === "wind") {         // 風：帶通 + 緩慢起伏
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(3); src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 420; bp.Q.value = 0.6;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
      const lg = ctx.createGain(); lg.gain.value = 240; lfo.connect(lg); lg.connect(bp.frequency);
      src.connect(bp); bp.connect(out); src.start(); lfo.start(); fxNodes.push(src, lfo);
      target = 0.09;
    } else if (type === "fire") {         // 火：低頻底噪 + 偶發劈啪
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(3); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380;
      src.connect(lp); lp.connect(out); src.start(); fxNodes.push(src);
      const pop = () => {
        if (fxKey !== "fire" || !ctx) return;
        const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.06);
        const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1400 + Math.random() * 1600;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.04 + Math.random() * 0.06, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
        s.connect(f); f.connect(g); g.connect(out); s.start(); s.stop(ctx.currentTime + 0.12);
        fxTimer = setTimeout(pop, 600 + Math.random() * 2600);
      };
      fxTimer = setTimeout(pop, 700);
      target = 0.10;
    }
    out.gain.linearRampToValueAtTime(target, ctx.currentTime + 1.2);  // 音量由 master 統一受靜音控制
  }

  /* ---------- 低限氛圍配樂 ---------- */
  const SCALES = { // 每間房可給不同調性（半音相對根音）
    default: [0, 3, 7, 10], warm: [0, 4, 7, 11], dark: [0, 2, 7, 9], han: [0, 2, 5, 7, 9]
  };
  function stopMusic() { if (musTimer) clearInterval(musTimer); musTimer = null; musNodes.forEach(n => { try { n.stop(); } catch (e) {} }); musNodes = []; }
  function pad(freq, t, dur) {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o1.type = "sine"; o2.type = "sine"; o1.frequency.value = freq; o2.frequency.value = freq * 1.005;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1200;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + dur * 0.4); g.gain.linearRampToValueAtTime(0, t + dur);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(reverb); g.connect(master);
    o1.start(t); o2.start(t); o1.stop(t + dur); o2.stop(t + dur);
    musNodes.push(o1, o2);
  }
  function synthMusic(on, key) {
    if (!on) { stopMusic(); return; }
    if (!ensure()) return;
    stopMusic();
    const root = 130.81, scale = SCALES[key] || SCALES.default;
    const play = () => {
      if (musNodes.length > 40) musNodes = musNodes.slice(-12);
      const n = scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
      pad(root * Math.pow(2, n / 12), ctx.currentTime + 0.05, 5.5);
    };
    play(); musTimer = setInterval(play, 3200);
  }

  // 背景配樂：優先用 Lyria 產的 MP3，載入失敗則退回程式合成
  function music(on, key) {
    stopMusic();
    if (!on) { if (bgmEl) { try { bgmEl.pause(); } catch (e) {} } return; }
    const file = BGM[key] || BGM.default;
    if (!bgmEl) { bgmEl = new Audio(); bgmEl.loop = true; bgmEl.preload = "auto"; bgmEl.addEventListener("error", () => synthMusic(true, bgmKey)); }
    if (bgmKey !== key) { bgmKey = key; bgmEl.src = file; }
    bgmEl.volume = muted ? 0 : 0.45;
    const p = bgmEl.play(); if (p && p.catch) p.catch(() => {});
  }

  /* ---------- 互動音效 ---------- */
  function tone(freq, dur, type, vol, slideTo) {
    if (!ensure()) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }
  function noiseBurst(dur, freq, vol) {
    if (!ensure()) return;
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(dur + 0.05);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq || 2000; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol || 0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(); s.stop(ctx.currentTime + dur + 0.02);
  }
  function sfx(name) {
    if (!ensure()) return;
    switch (name) {
      case "click": tone(420, 0.06, "sine", 0.12); break;
      case "search": noiseBurst(0.25, 1800, 0.12); break;
      case "pickup": tone(660, 0.12, "triangle", 0.18, 990); break;
      case "open": noiseBurst(0.18, 900, 0.12); setTimeout(() => tone(523, 0.18, "sine", 0.15), 60); break;
      case "unlock": [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, "sine", 0.18), i * 90)); noiseBurst(0.12, 1200, 0.1); break;
      case "error": tone(160, 0.25, "sawtooth", 0.16, 90); break;
      case "chapter": tone(98, 1.6, "sine", 0.14); setTimeout(() => tone(147, 1.4, "sine", 0.1), 120); break;
      case "fragment": [784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, 0.5, "sine", 0.16), i * 110)); break;
    }
  }

  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.9; if (bgmEl) bgmEl.volume = m ? 0 : 0.45; if (rainEl) rainEl.volume = m ? 0 : 0.55; return muted; }
  function toggle() { return setMuted(!muted); }
  function isMuted() { return muted; }

  window.SND = { init, ambient, stopAmbient, viewFx, stopFx, music, sfx, setMuted, toggle, isMuted, _bgm: () => (bgmEl && bgmEl.currentSrc) || null };
})();
