/**
 * 공개 배포용 디렉터리(dist/)를 만든다.
 *
 * 왜 필요한가
 * -----------
 * 저장소 루트를 그대로 배포하면 개발 메모(*.md 94개), schema.sql,
 * wrangler.toml(D1 database_id), 백업 페이지(book_old.html 등)까지 전부 공개된다.
 * 실제로 schema.sql 이 내려받히고 있었고 그 안에 관리자 비밀번호 해시가 있었다.
 *
 * Cloudflare Pages 의 `.assetsignore` 는 `wrangler pages deploy` 에서 동작하지
 * 않는다(직접 업로드는 디렉터리를 통째로 올린다). `_redirects` 의 404 규칙도
 * 이미 존재하는 정적 파일은 덮지 못한다. 실험으로 확인한 방법은 이것뿐이다.
 *
 * 사용법
 * ------
 *   node tools/build_public.mjs
 *   npx wrangler pages deploy dist --project-name 99wisdombook --branch main
 *
 * Cloudflare 대시보드 GitHub 연동을 쓴다면
 *   빌드 명령    : node tools/build_public.mjs
 *   출력 디렉터리 : dist
 *
 * ⚠ data/ 와 og/ 는 런타임에 필요하므로 반드시 포함한다.
 *   data/chapters/*.md 는 functions/chapter/[id].js 가 ASSETS 로 읽고,
 *   data/wisdom.json 은 알림 크론이 읽는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

/** 루트 파일에만 적용한다. 하위 디렉터리에는 적용하지 않는다. */
const EXCLUDE_ROOT = [
  /\.md$/i,                 // 개발 메모. CLAUDE.md 포함 — 배포할 이유가 없다.
  /\.sql$/i,                // schema.sql
  /\.py$/i,
  /^wrangler\.(toml|jsonc?)$/i,
  /^\.assetsignore$/i,
  /_backup.*\.html$/i,
  /_old\.html$/i,
  /^book_simple.*\.html$/i,
  /^test_/i,
  /^check_.*\.sh$/i,
  /^wait_and_check\.sh$/i,
  /^\.DS_Store$/i,
  /^Thumbs\.db$/i,
];

const EXCLUDE_DIRS = new Set([
  'dist', 'tools', 'mockup', 'node_modules', '.git', '.wrangler', '.claude',
]);

/** 이것들이 하나라도 빠지면 배포하면 안 된다. */
const REQUIRED = [
  'index.html', 'daily.html', 'reader.html', 'chapter-view.html',
  'admin.html', 'api-client.js', 'admin-insights.js',
  '_redirects', '_routes.json',
  'functions/api/[[path]].js',
  'functions/insight/[slug].js',
  'functions/chapter/[id].js',
  'data/wisdom.json', 'data/chapters/1.md', 'data/chapters/99.md',
  'assets/app.css', 'assets/site.css',
  'og/ginkgo-survived.png',
];

const isExcludedRootFile = (name) => EXCLUDE_ROOT.some((re) => re.test(name));

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  let copied = 0, skipped = 0;
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = entry.name;
    const src = path.join(ROOT, name);

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(name) || name.startsWith('.')) { skipped++; continue; }
      fs.cpSync(src, path.join(DIST, name), { recursive: true });
      copied++;
      continue;
    }

    // _redirects, _routes.json, _headers 같은 제어 파일은 반드시 남긴다
    if (name.startsWith('_')) {
      fs.copyFileSync(src, path.join(DIST, name));
      copied++;
      continue;
    }

    if (name.startsWith('.') || isExcludedRootFile(name)) { skipped++; continue; }

    fs.copyFileSync(src, path.join(DIST, name));
    copied++;
  }

  const missing = REQUIRED.filter((r) => !fs.existsSync(path.join(DIST, ...r.split('/'))));
  if (missing.length) {
    console.error('필수 파일 누락 - 배포하지 말 것:');
    missing.forEach((m) => console.error('  - ' + m));
    process.exit(1);
  }

  const leaked = fs.readdirSync(DIST).filter(isExcludedRootFile);
  if (leaked.length) {
    console.error('제외했어야 할 파일이 남아 있음: ' + leaked.join(', '));
    process.exit(1);
  }

  console.log(`dist/ 생성 완료: 최상위 ${copied}개 항목, 전체 ${countFiles(DIST)}개 파일 (제외 ${skipped}개 항목)`);
}

main();
