# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 따라야 할 규칙을 정리합니다.

## 프로젝트 개요
- **이름**: 99wisdombook — "살아본 뒤에야 비로소 읽히는 문장들" 다국어 도서 웹사이트
- **구조**: 정적 HTML(루트) + Cloudflare Pages Functions API(`functions/api/[[path]].js`) + D1 Database
- **설정**: `wrangler.toml` (project: `99wisdombook-pages`, D1 binding: `DB` → `wisdom-book-db`)

## 배포 워크플로우 (중요)

**GitHub `main` 브랜치 → Cloudflare Pages 자동 배포** 구조입니다.

개발 작업이 끝나면:
1. 변경 사항을 검토하고
2. `git add` → `git commit` → `git push origin main` 으로 푸시하면
3. Cloudflare Pages가 자동으로 빌드·배포하여 프로덕션에 즉시 반영됩니다.

따라서 **로컬에서 별도의 수동 배포 작업이 필요하지 않은 경우, 작업 완료 후 곧바로 commit & push 하여 프로덕션에 반영**할 것.

### ⚠ 로컬에서 직접 배포할 때는 저장소 루트를 올리지 말 것

루트를 그대로 올리면 개발 메모(`*.md`), `schema.sql`, `wrangler.toml`, 백업 페이지까지
전부 공개된다. 실제로 `schema.sql` 이 공개되어 관리자 비밀번호 해시가 노출된 적이 있다.

```bash
node tools/build_public.mjs
npx wrangler pages deploy dist --project-name 99wisdombook --branch main
```

`.assetsignore` 는 `wrangler pages deploy` 에서 동작하지 않고, `_redirects` 의 404 규칙도
이미 존재하는 정적 파일은 덮지 못한다. 확인된 방법은 위의 `dist/` 방식뿐이다.

**GitHub 자동 배포도 같은 설정이어야 한다.** 루트를 빌드 출력으로 쓰면 푸시할 때마다
차단이 되돌려진다(실제로 확인함). Cloudflare 대시보드 → Pages → 99wisdombook →
Settings → Builds & deployments 에서:

- 빌드 명령(Build command): `node tools/build_public.mjs`
- 빌드 출력 디렉터리(Build output directory): `dist`

예외: `wrangler.toml`의 D1 binding 변경, schema 마이그레이션, 시크릿 추가 등 Cloudflare 대시보드/CLI 작업이 필요한 경우는 사용자에게 먼저 확인.

## 로컬 미리보기

작업 진행 중 또는 완료 후, 사용자가 결과를 시각적으로 확인할 수 있도록 **Claude Code의 Preview 기능(`mcp__Claude_Preview__*`)을 사용해 우측 패널에 미리보기를 띄울 것**.

- 정적 HTML이므로 프로젝트 루트(`C:/Users/User/99wisdombook-main`)를 서빙하면 됨
- `index.html`을 진입점으로, 다국어 페이지(`book-*.html`), `admin.html` 등을 검증
- UI/스타일/번역 변경 시에는 반드시 미리보기로 확인 후 커밋

## 원문(책 본문) 개선 기준

`/chapter/N` 이 보여 주는 원문은 `data/chapters/{N}.md` 다. 구버전 `book.html` 은
배포에서 내렸으니 이 파일만 고치면 된다.

1장을 샘플로 다시 쓰면서 정한 기준:

- **분량은 장마다 다르게.** 일률적인 글자 수를 맞추지 않는다. 소재가 허락하는
  만큼만 늘린다. 참고로 1장은 2,078자 → 3,657자(공백 제외)가 됐다.
- **이름을 나열하지 않는다.** 기존 원문은 인물과 개념을 하나씩 대고 지나가는
  구성이라 절마다 주장만 있고 논증이 이어지지 않았다. 장면 → 개념 → 예외 →
  종합으로 흐름을 만든다.
- **훈계로 끝내지 않는다.** "기억하라" 같은 마무리 대신, 독자가 다음에 쓸 수
  있는 구분이나 질문을 남긴다.
- **사실관계를 확인한다.** 1장에서만 네 군데가 틀려 있었다(등가교환을 열역학
  제1법칙으로 설명, "당신이 상품이다"의 출처, 라오콘의 출전, 프리드먼의 노벨상
  연도). 인물·연도·출전은 반드시 대조할 것.
- **칼럼과 역할을 나눈다.** 칼럼(D1 `insights`)은 한 각도를 짧게 파는 글이고,
  원문은 그 주제의 전체 지형을 보여 주는 글이다. 칼럼 분량 기준(공백 제외
  573~752자)을 원문에 적용하지 말 것.

## 커밋 메시지
- 한국어 또는 영어 모두 가능. 변경 의도(why)를 1~2문장으로.
- 자동 생성된 `Co-Authored-By: Claude` 트레일러 포함.

## 주의 사항
- `*_backup_*.html`, `book_old.html` 등 백업 파일은 건드리지 말 것
- 비밀키/토큰을 커밋하지 말 것 (Cloudflare secrets는 대시보드에서 관리)
- D1 스키마 변경 시 `schema.sql` 업데이트와 마이그레이션 절차 별도 확인
