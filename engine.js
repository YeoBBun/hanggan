"use strict";

const SAVE_KEY = "hanggan_save";
const CHAPTER_ID = "ch1";

const el = {
  app: document.getElementById("app"),
  stage: document.getElementById("stage"),
  charBar: document.getElementById("char-bar"),
  bgmIndicator: document.getElementById("bgm-indicator"),
  clickCatcher: document.getElementById("click-catcher"),
  dialogueBox: document.getElementById("dialogue-box"),
  speakerName: document.getElementById("speaker-name"),
  dialogueText: document.getElementById("dialogue-text"),
  fxCaption: document.getElementById("fx-caption"),
  textLayer: document.getElementById("text-layer"),
  fadeOverlay: document.getElementById("fade-overlay"),
  startScreen: document.getElementById("start-screen"),
  continueBtn: document.getElementById("continue-btn"),
  restartBtn: document.getElementById("restart-btn"),
  questionOverlay: document.getElementById("question-overlay"),
  questionCard: document.getElementById("question-card"),
};

let CONFIG = null;
let CHAPTER = null;
let QUESTIONS = null;

let state = {
  chapter: CHAPTER_ID,
  beat: null,
  line: 0,
  bonus: [],
  seen: [],
};

let onStage = {}; // { 이름: true }
let busy = false; // true while auto/fx transitions run, blocks click-advance
let beatIndex = 0;

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.chapter === CHAPTER_ID) return parsed;
    return null;
  } catch (e) {
    return null;
  }
}

function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    /* 저장 실패는 조용히 무시 (프로토타입) */
  }
}

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} 로드 실패 (${res.status})`);
  return res.json();
}

async function boot() {
  try {
    const [config, chapter, questions] = await Promise.all([
      fetchJSON("data/config.json"),
      fetchJSON(`data/${CHAPTER_ID}.json`),
      fetchJSON("data/questions.json"),
    ]);
    CONFIG = config;
    CHAPTER = chapter;
    QUESTIONS = questions;
  } catch (err) {
    document.body.innerHTML =
      '<div style="padding:32px;color:#eee;font-family:sans-serif;line-height:1.6">' +
      "<h2>데이터를 불러오지 못했습니다</h2><p>" +
      String(err.message || err) +
      "</p><p>브라우저 보안 정책상 <code>file://</code>로 직접 열면 JSON을 못 읽는 경우가 많습니다. " +
      "터미널에서 이 폴더로 이동해 <code>python3 -m http.server 8000</code> 실행 후 " +
      "<code>http://localhost:8000</code> 로 접속해 보세요.</p></div>";
    return;
  }

  const save = loadSave();
  if (save) {
    el.continueBtn.style.display = "";
    el.continueBtn.onclick = () => {
      state = Object.assign(
        { chapter: CHAPTER_ID, beat: null, line: 0, bonus: [], seen: [] },
        save
      );
      startGame(true);
    };
  } else {
    el.continueBtn.style.display = "none";
  }

  el.restartBtn.onclick = () => {
    localStorage.removeItem(SAVE_KEY);
    state = { chapter: CHAPTER_ID, beat: null, line: 0, bonus: [], seen: [] };
    startGame(false);
  };
}

function startGame(resume) {
  el.startScreen.style.display = "none";
  el.app.classList.add("running");

  if (resume && state.beat) {
    beatIndex = CHAPTER.beats.findIndex((b) => b.id === state.beat);
    if (beatIndex < 0) beatIndex = 0;
  } else {
    beatIndex = 0;
    state.line = 0;
  }

  el.clickCatcher.addEventListener("click", onAdvanceClick);
  el.dialogueBox.addEventListener("click", onAdvanceClick);
  el.fxCaption.addEventListener("click", onAdvanceClick);
  runFrom(beatIndex, state.line || 0);
}

let currentBeat = null;
let currentLineIdx = 0;
let waitingForClick = false;

function runFrom(bIdx, lIdx) {
  beatIndex = bIdx;
  currentLineIdx = lIdx;
  currentBeat = CHAPTER.beats[beatIndex];
  if (!currentBeat) {
    showEnding();
    return;
  }
  state.beat = currentBeat.id;
  state.line = currentLineIdx;
  stepLoop();
}

function onAdvanceClick() {
  if (busy || waitingForClick === false) return;
  waitingForClick = false;
  el.fxCaption.style.display = "none";
  el.dialogueBox.style.display = "";
  advanceLine();
}

function advanceLine() {
  currentLineIdx += 1;
  state.line = currentLineIdx;
  stepLoop();
}

async function stepLoop() {
  while (true) {
    if (!currentBeat) return;
    if (currentLineIdx >= currentBeat.lines.length) {
      // 비트 종료 → 다음 비트로
      if (!state.seen.includes(currentBeat.id)) state.seen.push(currentBeat.id);
      writeSave();
      beatIndex += 1;
      currentBeat = CHAPTER.beats[beatIndex];
      currentLineIdx = 0;
      if (!currentBeat) {
        showEnding();
        return;
      }
      state.beat = currentBeat.id;
      state.line = 0;
      continue;
    }

    const line = currentBeat.lines[currentLineIdx];
    const requiresClick = await renderLine(line);
    writeSave();

    if (requiresClick) {
      waitingForClick = true;
      return; // 클릭 대기, 루프 정지
    }
    currentLineIdx += 1;
    state.line = currentLineIdx;
  }
}

async function renderLine(line) {
  switch (line.t) {
    case "bg":
      applyBg(line.v);
      clearCharBar();
      return false;
    case "char":
      applyChar(line.v, line.act);
      return false;
    case "bgm":
      applyBgm(line.v);
      return false;
    case "say":
      renderSay(line.who, line.v);
      return true;
    case "narr":
      renderNarr(line.v);
      return true;
    case "fx":
      return await renderFx(line);
    case "q":
      return await runQuestion(line.id);
    default:
      return false;
  }
}

function applyBg(key) {
  const val = (CONFIG.bg && CONFIG.bg[key]) || "#1a1a1f";
  if (typeof val === "string" && val.startsWith("#")) {
    el.stage.style.backgroundImage = "none";
    el.stage.style.backgroundColor = val;
  } else {
    el.stage.style.backgroundColor = "#1a1a1f";
    el.stage.style.backgroundImage = `url("${val}")`;
    el.stage.style.backgroundSize = "cover";
    el.stage.style.backgroundPosition = "center";
  }
}

function clearCharBar() {
  onStage = {};
  el.charBar.innerHTML = "";
}

function applyChar(name, act) {
  if (act === "out") {
    delete onStage[name];
    renderCharBar();
    return;
  }
  onStage[name] = true;
  renderCharBar();
}

function renderCharBar() {
  el.charBar.innerHTML = "";
  Object.keys(onStage).forEach((name) => {
    const info = (CONFIG.chars && CONFIG.chars[name]) || { color: "#666" };
    const chip = document.createElement("span");
    chip.className = "char-chip";
    chip.textContent = name;
    chip.style.background = info.color;
    el.charBar.appendChild(chip);
  });
}

function applyBgm(track) {
  el.bgmIndicator.textContent = track ? `♪ ${track}` : "♪ (음악 없음)";
}

function renderSay(who, text) {
  const info = (CONFIG.chars && CONFIG.chars[who]) || { color: "#666" };
  el.dialogueBox.classList.remove("narr");
  el.speakerName.style.display = "";
  el.speakerName.textContent = who;
  el.speakerName.style.background = info.color;
  el.dialogueText.textContent = text;
  el.fxCaption.style.display = "none";
  el.dialogueBox.style.display = "";
}

function renderNarr(text) {
  el.dialogueBox.classList.add("narr");
  el.dialogueText.textContent = text;
  el.fxCaption.style.display = "none";
  el.dialogueBox.style.display = "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderFx(line) {
  if (line.v === "fade") {
    const ms = line.ms || 700;
    busy = true;
    el.fadeOverlay.style.transitionDuration = ms / 2 + "ms";
    el.fadeOverlay.style.opacity = "1";
    await sleep(ms / 2);
    await sleep(60);
    el.fadeOverlay.style.opacity = "0";
    await sleep(ms / 2);
    busy = false;
    return false;
  }
  if (line.v === "pause") {
    const ms = line.ms || 500;
    busy = true;
    await sleep(ms);
    busy = false;
    return false;
  }
  // 그 외 문자열 → 짧은 연출 캡션 (예: 종소리, 발소리)
  el.dialogueBox.style.display = "none";
  el.fxCaption.style.display = "";
  el.fxCaption.textContent = `◆ ${line.v} ◆`;
  return true;
}

function showEnding() {
  el.dialogueBox.classList.add("narr");
  el.dialogueText.textContent = "— 1챕터 끝 —";
  el.fxCaption.style.display = "none";
  el.dialogueBox.style.display = "";
  waitingForClick = false;
}

/* ---------------- 문항 ---------------- */

function pairEq(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function pairIn(list, pair) {
  return list.some((p) => pairEq(p, pair));
}

function findQuestion(id) {
  return QUESTIONS.questions.find((q) => q.id === id);
}

function runQuestion(id) {
  return new Promise((resolve) => {
    const q = findQuestion(id);
    if (!q) {
      resolve();
      return;
    }
    let attempt = 1;
    let stage1Choice = null;

    function renderStage1() {
      el.questionOverlay.style.display = "flex";
      const card = el.questionCard;
      card.innerHTML = "";

      const label = document.createElement("div");
      label.id = "question-stage-label";
      label.textContent = "1단계";
      card.appendChild(label);

      const prompt = document.createElement("div");
      prompt.id = "question-prompt";
      prompt.textContent = q.stage1.prompt;
      card.appendChild(prompt);

      const opts = document.createElement("div");
      opts.className = "q-options";
      q.stage1.options.forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "q-option";
        btn.textContent = opt.text;
        btn.onclick = () => {
          stage1Choice = opt.id;
          renderStage2();
        };
        opts.appendChild(btn);
      });
      card.appendChild(opts);
    }

    function renderStage2() {
      const card = el.questionCard;
      card.innerHTML = "";

      const label = document.createElement("div");
      label.id = "question-stage-label";
      label.textContent = "2단계";
      card.appendChild(label);

      const prompt = document.createElement("div");
      prompt.id = "question-prompt";
      prompt.textContent = q.stage2.prompt;
      card.appendChild(prompt);

      const opts = document.createElement("div");
      opts.className = "q-options";
      q.stage2.options.forEach((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "q-option";
        btn.textContent = opt.text;
        btn.onclick = () => {
          evaluate([stage1Choice, opt.id]);
        };
        opts.appendChild(btn);
      });
      card.appendChild(opts);
    }

    function evaluate(pair) {
      const card = el.questionCard;

      if (attempt === 1) {
        const isValid = pairIn(q.valid, pair);
        if (isValid) {
          const isBonus = pairIn(q.bonus || [], pair);
          if (isBonus && !state.bonus.includes(q.id)) {
            state.bonus.push(q.id);
            writeSave();
          }
          finish(isBonus);
          return;
        }
        // 1회차 불성립 → 피드백 + 재선택
        const fb =
          (q.feedback || []).find((f) => pairIn(f.match, pair)) || q.fallback;
        renderFeedback(fb, true);
      } else {
        // 2회차 이후 → 정오 판정 없음, 한 번 더 짚고 진행
        renderFeedback(q.fallback, false);
      }
    }

    function renderFeedback(fb, canRetry) {
      const card = el.questionCard;
      const old = card.querySelector(".q-feedback");
      if (old) old.remove();
      const oldActions = card.querySelector(".q-actions");
      if (oldActions) oldActions.remove();

      card.querySelectorAll(".q-option").forEach((b) => (b.disabled = true));

      const box = document.createElement("div");
      box.className = "q-feedback";
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = fb.who;
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = fb.text;
      box.appendChild(who);
      box.appendChild(text);
      card.appendChild(box);

      const actions = document.createElement("div");
      actions.className = "q-actions";

      if (canRetry) {
        const retryStage1 = document.createElement("button");
        retryStage1.type = "button";
        retryStage1.className = "btn";
        retryStage1.textContent = "다시 생각해본다";
        retryStage1.onclick = () => {
          attempt = 2;
          renderStage1();
        };

        const retryStage2 = document.createElement("button");
        retryStage2.type = "button";
        retryStage2.className = "btn primary";
        retryStage2.textContent = "근거를 다시 고른다";
        retryStage2.onclick = () => {
          attempt = 2;
          renderStage2();
        };

        actions.appendChild(retryStage1);
        actions.appendChild(retryStage2);
      } else {
        const cont = document.createElement("button");
        cont.type = "button";
        cont.className = "btn primary";
        cont.textContent = "계속";
        cont.onclick = () => finish(false);
        actions.appendChild(cont);
      }
      card.appendChild(actions);
    }

    function finish(isBonus) {
      el.questionOverlay.style.display = "none";
      el.questionCard.innerHTML = "";
      if (attempt === 1 && q.react) {
        const reactLine = isBonus ? q.react.hit : q.react.miss;
        if (reactLine && reactLine.t === "narr") {
          renderNarr(reactLine.v);
          resolve(true); // 이 줄은 일반 클릭 대기 흐름으로 넘긴다
          return;
        }
      }
      resolve(false);
    }

    renderStage1();
  });
}

boot();
