# 🚨 긴급 배포 문제 해결 가이드

## 현재 상황
- ❌ **https://now4next.github.io/99wisdombook/** → "Hello world" 표시
- ❌ **https://99wisdombook.org/** → "Hello world" 표시
- ✅ GitHub 저장소에는 올바른 파일 있음 (index.html, book.html 등)
- ⚠️ Cloudflare Pages가 오래된 "Hello world" 콘텐츠 서빙 중

## 문제 원인
**Cloudflare Pages 프로젝트 "99wisdombook"이 GitHub Pages를 덮어쓰고 있습니다.**

Cloudflare에서 도메인 `99wisdombook.org`를 관리하고 있고, Cloudflare Pages 프로젝트가 활성화되어 있어서 GitHub Pages의 최신 내용이 표시되지 않습니다.

## 즉시 해결 방법 (Option A: Cloudflare Pages 비활성화)

### 1. Cloudflare Pages 프로젝트 삭제 또는 비활성화

1. Cloudflare 대시보드 로그인: https://dash.cloudflare.com/
2. **Workers & Pages** 메뉴 클릭
3. **99wisdombook** 프로젝트 찾기
4. 프로젝트 클릭 → **Settings** 탭
5. 맨 아래 **Delete project** 클릭하여 삭제

### 2. GitHub Pages 설정 확인

1. https://github.com/now4next/99wisdombook/settings/pages 접속
2. **Source** 설정:
   - **Deploy from a branch** 선택
   - **Branch**: `main` 
   - **Folder**: `/ (root)` 선택
3. **Custom domain**:
   - `99wisdombook.org` 입력
   - **Save** 클릭
4. **Enforce HTTPS** 체크박스 활성화

### 3. Cloudflare DNS 재설정

1. Cloudflare 대시보드 → **99wisdombook.org** 도메인 선택
2. **DNS** 탭 클릭
3. 기존 레코드 삭제 (Cloudflare Pages 관련)
4. 아래 4개의 A 레코드 추가:
   - Type: `A`, Name: `@`, Content: `185.199.108.153`, Proxy: **✅ Proxied**
   - Type: `A`, Name: `@`, Content: `185.199.109.153`, Proxy: **✅ Proxied**
   - Type: `A`, Name: `@`, Content: `185.199.110.153`, Proxy: **✅ Proxied**
   - Type: `A`, Name: `@`, Content: `185.199.111.153`, Proxy: **✅ Proxied**

### 4. Cloudflare 캐시 삭제

1. Cloudflare 대시보드 → **99wisdombook.org**
2. **Caching** 탭 → **Configuration**
3. **Purge Everything** 클릭하여 모든 캐시 삭제

### 5. 대기 및 확인 (5-10분)

- DNS 전파 대기: 5-10분 (최대 30분)
- 브라우저 강제 새로고침: `Ctrl+Shift+R` (Windows/Linux) 또는 `Cmd+Shift+R` (Mac)
- 시크릿 모드로 테스트

---

## 대안 방법 (Option B: Cloudflare Pages에 재배포)

Cloudflare Pages를 계속 사용하려면:

### 1. Cloudflare API 토큰 생성

1. https://dash.cloudflare.com/profile/api-tokens
2. **Create Token** 클릭
3. **Edit Cloudflare Workers** 템플릿 선택
4. 권한 설정:
   - Account: Cloudflare Pages - Edit
   - Zone: All zones
5. **Continue to summary** → **Create Token**
6. 생성된 토큰 복사

### 2. Wrangler로 배포

```bash
cd /home/user/webapp

# API 토큰 설정
export CLOUDFLARE_API_TOKEN="your-token-here"

# Cloudflare Pages에 배포
npx wrangler pages deploy . --project-name=99wisdombook --branch=main
```

### 3. 배포 확인

배포 완료 후 다음 URL 확인:
- https://99wisdombook.pages.dev/
- https://99wisdombook.org/

---

## 검증 체크리스트

배포 후 다음 항목을 확인하세요:

- [ ] https://now4next.github.io/99wisdombook/ → 로그인 페이지 표시 (한글 제목)
- [ ] https://99wisdombook.org/ → 로그인 페이지 표시
- [ ] 로그인 후 사용자 이름 "강병준"과 로그아웃 버튼 수평 정렬
- [ ] Language 버튼 클릭 시 8개 언어 드롭다운 표시
- [ ] Contents 버튼 클릭 시 목차 패널 표시
- [ ] 모든 기능 정상 작동

---

## 현재 파일 상태

### 로컬 파일 (정상)
- ✅ `/home/user/webapp/index.html` - 20KB, 한글 로그인 페이지
- ✅ `/home/user/webapp/book.html` - 90KB, 메인 북 페이지
- ✅ `/home/user/webapp/CNAME` - 도메인: 99wisdombook.org

### GitHub 저장소 (정상)
- ✅ https://raw.githubusercontent.com/now4next/99wisdombook/main/index.html - 한글 제목 포함

### 배포 상태 (문제)
- ❌ https://now4next.github.io/99wisdombook/ - "Hello world" 표시
- ❌ https://99wisdombook.org/ - "Hello world" 표시

---

## 추천 해결 방법

**Option A (권장)**: Cloudflare Pages 삭제하고 GitHub Pages만 사용
- 장점: 설정 간단, 무료, GitHub과 자동 통합
- 단점: 없음

**Option B**: Cloudflare Pages 계속 사용
- 장점: Cloudflare CDN, 더 빠른 속도
- 단점: API 토큰 필요, 수동 배포 필요

---

## 긴급 연락처

- GitHub Pages 문서: https://docs.github.com/en/pages
- Cloudflare Pages 문서: https://developers.cloudflare.com/pages/
- Cloudflare 지원: https://dash.cloudflare.com/?to=/:account/support

---

**작성 일시**: 2026-02-13 05:54 UTC  
**최종 커밋**: b0c0483  
**문제 상태**: 🚨 긴급 - Cloudflare Pages가 GitHub Pages 덮어쓰기
