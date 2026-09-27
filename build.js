"use strict";
/**
 * data/*.json 의 내용을 index.html의 <script type="application/json" id="data-...">
 * 블록에 그대로 채워 넣는다. 대본/문항/설정을 고쳤으면 이 스크립트를 다시 돌려서
 * index.html이 서버 없이도(file:// 더블클릭) 최신 데이터를 읽게 만든다.
 *
 * 사용법: node build.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const HTML_PATH = path.join(ROOT, "index.html");

const SOURCES = {
  "data-config": "data/config.json",
  "data-ch1": "data/ch1.json",
  "data-ch2": "data/ch2.json",
  "data-ch3": "data/ch3.json",
  "data-ch4": "data/ch4.json",
  "data-questions": "data/questions.json",
};

function inject(html, id, jsonText) {
  const re = new RegExp(
    `(<script type="application/json" id="${id}">)([\\s\\S]*?)(</script>)`
  );
  if (!re.test(html)) {
    throw new Error(`index.html에서 id="${id}" 블록을 찾지 못함`);
  }
  return html.replace(re, (_, open, _old, close) => open + jsonText + close);
}

function main() {
  let html = fs.readFileSync(HTML_PATH, "utf8");

  for (const [id, relPath] of Object.entries(SOURCES)) {
    const fullPath = path.join(ROOT, relPath);
    const raw = fs.readFileSync(fullPath, "utf8");
    JSON.parse(raw); // 문법 검증 — 깨진 JSON이면 여기서 바로 에러
    html = inject(html, id, raw.trim());
  }

  fs.writeFileSync(HTML_PATH, html, "utf8");
  console.log("index.html 갱신 완료 — data/*.json 내용이 인라인으로 채워졌습니다.");
}

main();
