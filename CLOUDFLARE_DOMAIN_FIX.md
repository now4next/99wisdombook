# 99wisdombook.org 도메인 문제 해결 가이드

## 🔍 문제 분석

### 현재 상태
- ✅ `https://now4next.github.io/99wisdombook/` → 정상 작동
- ❌ `https://99wisdombook.org/` → "Hello world" 표시

### 원인 파악

#### DNS 확인 결과:
```
HTTP/2 200
server: cloudflare
```

**의미**:
- ✅ Cloudflare DNS가 설정되어 있음
- ✅ Cloudflare가 요청을 처리하고 있음
- ❌ 하지만 Cloudflare가 "Hello world"를 서빙함

#### wrangler.toml 존재:
```toml
name = "99wisdombook"
pages_build_output_dir = "./" 
compatibility_date = "2024-02-08"
```

**결론**: 
- `99wisdombook.org`가 **Cloudflare Pages**에 연결되어 있음
- Cloudflare Pages가 오래된/잘못된 "Hello world" 콘텐츠를 서빙함
- GitHub Pages와 연결되지 않음

---

## ✅ 해결 방법 (2가지 옵션)

### 옵션 1: Cloudflare Pages에 배포 (권장) ⭐

**장점**:
- ✅ 빠른 CDN 제공
- ✅ 무제한 대역폭
- ✅ 자동 HTTPS
- ✅ 엣지 컴퓨팅 지원

**단점**:
- GitHub에서 푸시할 때마다 Cloudflare Pages도 자동 배포 설정 필요

#### 설정 방법:

##### 1단계: Cloudflare Dashboard 접속
```
https://dash.cloudflare.com/
```

##### 2단계: Pages 프로젝트 확인
1. 왼쪽 메뉴에서 **Pages** 클릭
2. **99wisdombook** 프로젝트 찾기
3. 프로젝트 클릭

##### 3단계: GitHub 연동 확인/설정
**프로젝트 설정** → **Builds & deployments**:

**Git 연동 확인**:
- Repository: `now4next/99wisdombook`
- Branch: `main`
- Build command: (비워둠 - 정적 사이트)
- Build output directory: `/`

##### 4단계: 수동 재배포 트리거
1. **Deployments** 탭
2. **Retry deployment** 또는
3. **Create deployment** → **Upload assets** 또는
4. **Connect to Git** (GitHub 연동)

##### 5단계: 환경 변수 확인 (선택사항)
**Settings** → **Environment variables**:
- 필요한 환경 변수가 있다면 추가

##### 6단계: 커스텀 도메인 확인
**Settings** → **Custom domains**:
```
99wisdombook.org
www.99wisdombook.org (선택사항)
```

---

### 옵션 2: GitHub Pages로 연결 (간단) ⭐⭐

**장점**:
- ✅ 설정 간단
- ✅ GitHub와 완전 통합
- ✅ 자동 배포

**단점**:
- Cloudflare Pages를 사용하지 않음

#### 설정 방법:

##### 1단계: Cloudflare DNS 설정 변경

Cloudflare Dashboard → **99wisdombook.org** → **DNS**:

**현재 설정 확인**:
- CNAME이 Cloudflare Pages를 가리키고 있을 가능성

**새 설정 (A 레코드)**:
```
Type: A
Name: @
Value: 185.199.108.153
Proxy: ☁️ Proxied (권장) 또는 🔘 DNS only

추가 A 레코드 (고가용성):
185.199.109.153
185.199.110.153
185.199.111.153
```

**또는 CNAME 레코드**:
```
Type: CNAME
Name: @
Value: now4next.github.io
Proxy: ☁️ Proxied
```

##### 2단계: CNAME 파일 복원
```bash
cd /home/user/webapp
echo "99wisdombook.org" > CNAME
git add CNAME
git commit -m "feat: CNAME 파일 복원 - Cloudflare DNS 설정 완료"
git push origin main
```

##### 3단계: GitHub Pages 커스텀 도메인 설정
```
https://github.com/now4next/99wisdombook/settings/pages
```

**Custom domain**:
```
99wisdombook.org
```

**Enforce HTTPS**: ✅ 체크

##### 4단계: DNS 전파 대기
- 시간: 10-30분 (보통 5분 이내)
- 확인: https://99wisdombook.org/

---

## 🚀 권장 방법: Cloudflare Pages 재배포

### 왜 Cloudflare Pages?
1. **이미 설정되어 있음** - DNS가 Cloudflare Pages를 가리킴
2. **더 빠름** - Cloudflare CDN 전체 활용
3. **자동 배포** - Git 연동으로 푸시 시 자동 배포

### 즉시 실행 가능한 방법

#### A. GitHub Actions로 Cloudflare Pages 배포 (자동화)

`.github/workflows/cloudflare-pages.yml` 생성:

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: 99wisdombook
          directory: ./
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

**필요한 Secrets**:
1. GitHub 저장소 → Settings → Secrets and variables → Actions
2. **New repository secret**:
   - `CLOUDFLARE_API_TOKEN`: Cloudflare API 토큰
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare 계정 ID

#### B. Wrangler CLI로 수동 배포 (빠름)

```bash
cd /home/user/webapp

# Wrangler 설치 (없다면)
npm install -g wrangler

# Cloudflare 로그인
wrangler login

# 배포
wrangler pages deploy . --project-name=99wisdombook
```

#### C. Cloudflare Dashboard에서 수동 배포

1. https://dash.cloudflare.com/ → Pages → 99wisdombook
2. **Create deployment** 클릭
3. 파일 업로드 또는 GitHub 연동

---

## 🎯 빠른 해결 (5분)

### 방법: GitHub Pages로 직접 연결

이것이 가장 빠르고 확실합니다.

#### 1단계: Cloudflare DNS 레코드 변경
```
https://dash.cloudflare.com/ → 99wisdombook.org → DNS
```

**기존 레코드 삭제/수정**:
- Cloudflare Pages를 가리키는 CNAME 제거

**새 A 레코드 추가**:
```
Type: A, Name: @, Value: 185.199.108.153, Proxy: On
Type: A, Name: @, Value: 185.199.109.153, Proxy: On
Type: A, Name: @, Value: 185.199.110.153, Proxy: On
Type: A, Name: @, Value: 185.199.111.153, Proxy: On
```

#### 2단계: CNAME 파일 복원 (로컬 실행)
```bash
cd /home/user/webapp
echo "99wisdombook.org" > CNAME
git add CNAME
git commit -m "feat: CNAME 복원 - GitHub Pages 연결"
git push origin main
```

#### 3단계: GitHub Pages 설정
```
https://github.com/now4next/99wisdombook/settings/pages
```
- Custom domain: `99wisdombook.org`
- Enforce HTTPS: ✅

#### 4단계: 대기 및 확인 (5-10분)
```
https://99wisdombook.org/
```

---

## 📊 현재 설정 확인 가이드

### Cloudflare DNS 확인:
```
https://dash.cloudflare.com/ → 99wisdombook.org → DNS
```

**확인 사항**:
1. 어떤 레코드가 있는지 (A, CNAME, AAAA 등)
2. 각 레코드의 Value (어디를 가리키는지)
3. Proxy 상태 (☁️ Proxied / 🔘 DNS only)

### Cloudflare Pages 확인:
```
https://dash.cloudflare.com/ → Pages → 99wisdombook
```

**확인 사항**:
1. 프로젝트 존재 여부
2. 최근 배포 날짜
3. Git 연동 상태
4. 커스텀 도메인 설정

---

## 🐛 문제 해결

### 시나리오 1: "Hello world" 계속 표시
**원인**: Cloudflare 캐시

**해결**:
1. Cloudflare Dashboard → Caching → Purge Cache → Purge Everything
2. 브라우저 강력 새로고침
3. 5분 대기

### 시나리오 2: DNS_PROBE_FINISHED_NXDOMAIN
**원인**: DNS 레코드 없음 또는 전파 중

**해결**:
1. DNS 레코드 다시 확인
2. 10-30분 대기
3. 다른 DNS 사용 (8.8.8.8)

### 시나리오 3: ERR_TOO_MANY_REDIRECTS
**원인**: Cloudflare SSL 설정 문제

**해결**:
1. Cloudflare Dashboard → SSL/TLS
2. 암호화 모드: **Flexible** 또는 **Full**
3. 페이지 규칙 확인 (무한 리다이렉트 방지)

---

## 💡 최종 권장사항

### 즉시 실행 (5분):

1. **Cloudflare DNS 확인 및 변경**:
   - A 레코드 추가 (GitHub Pages IP)
   - 또는 기존 CNAME을 GitHub Pages로 변경

2. **CNAME 파일 복원**:
   ```bash
   echo "99wisdombook.org" > CNAME
   git add CNAME && git commit -m "feat: CNAME 복원" && git push
   ```

3. **GitHub Pages 설정**:
   - Custom domain: 99wisdombook.org

4. **5-10분 대기**

### 장기 최적화 (선택사항):
- GitHub Actions로 Cloudflare Pages 자동 배포 설정
- 또는 GitHub Pages 유지 (현재처럼)

---

**작성일**: 2026-02-13  
**우선순위**: 🔴 긴급  
**예상 해결 시간**: 5-10분

**다음 단계**: Cloudflare Dashboard에서 DNS 레코드를 확인하고 공유해 주세요!
