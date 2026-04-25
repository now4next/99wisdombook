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

예외: `wrangler.toml`의 D1 binding 변경, schema 마이그레이션, 시크릿 추가 등 Cloudflare 대시보드/CLI 작업이 필요한 경우는 사용자에게 먼저 확인.

## 로컬 미리보기

작업 진행 중 또는 완료 후, 사용자가 결과를 시각적으로 확인할 수 있도록 **Claude Code의 Preview 기능(`mcp__Claude_Preview__*`)을 사용해 우측 패널에 미리보기를 띄울 것**.

- 정적 HTML이므로 프로젝트 루트(`C:/Users/User/99wisdombook-main`)를 서빙하면 됨
- `index.html`을 진입점으로, 다국어 페이지(`book-*.html`), `admin.html` 등을 검증
- UI/스타일/번역 변경 시에는 반드시 미리보기로 확인 후 커밋

## 커밋 메시지
- 한국어 또는 영어 모두 가능. 변경 의도(why)를 1~2문장으로.
- 자동 생성된 `Co-Authored-By: Claude` 트레일러 포함.

## 주의 사항
- `*_backup_*.html`, `book_old.html` 등 백업 파일은 건드리지 말 것
- 비밀키/토큰을 커밋하지 말 것 (Cloudflare secrets는 대시보드에서 관리)
- D1 스키마 변경 시 `schema.sql` 업데이트와 마이그레이션 절차 별도 확인
