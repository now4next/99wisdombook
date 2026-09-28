# Cloudflare 도메인 연동 가이드

## 🌐 도메인 정보
- **도메인**: 99wisdombook.org
- **등록처**: Cloudflare
- **대상**: GitHub Pages (now4next.github.io/99wisdombook)

---

## ✅ 완료된 작업

### 1. CNAME 파일 생성
- 파일 위치: `/home/user/webapp/CNAME`
- 내용: `99wisdombook.org`
- 이 파일을 GitHub Pages 루트에 배포하면 커스텀 도메인이 활성화됩니다

---

## 🔧 Cloudflare DNS 설정

### 필수 DNS 레코드

Cloudflare 대시보드(https://dash.cloudflare.com)에서 다음 레코드를 추가하세요:

#### Option 1: A 레코드 (권장)
```
Type: A
Name: @ (또는 99wisdombook.org)
Value: 185.199.108.153
Proxy: Orange cloud (Proxied)
TTL: Auto
```

추가 A 레코드 (고가용성):
```
Type: A, Name: @, Value: 185.199.109.153, Proxy: On
Type: A, Name: @, Value: 185.199.110.153, Proxy: On
Type: A, Name: @, Value: 185.199.111.153, Proxy: On
```

#### Option 2: CNAME 레코드 (www 서브도메인)
```
Type: CNAME
Name: www
Value: now4next.github.io
Proxy: Orange cloud (Proxied)
TTL: Auto
```

---

## 🔐 GitHub Pages 설정

### 1. Repository Settings
1. GitHub 저장소로 이동: https://github.com/now4next/99wisdombook
2. **Settings** → **Pages** 클릭
3. **Custom domain** 섹션에서:
   - 입력: `99wisdombook.org`
   - **Save** 클릭

### 2. HTTPS 활성화
- **Enforce HTTPS** 체크박스 활성화
- 자동으로 SSL 인증서가 발급됩니다 (몇 분 소요)

---

## 📋 Cloudflare 추가 설정

### SSL/TLS 설정
1. Cloudflare 대시보드 → **SSL/TLS** 탭
2. 암호화 모드: **Flexible** 또는 **Full** 선택
   - **Flexible**: Cloudflare ↔ GitHub 간 HTTP (빠름)
   - **Full**: Cloudflare ↔ GitHub 간 HTTPS (더 안전)

### Page Rules (선택사항)
HTTP → HTTPS 리다이렉트 규칙:
```
URL: http://99wisdombook.org/*
Setting: Always Use HTTPS
```

www → non-www 리다이렉트:
```
URL: www.99wisdombook.org/*
Setting: Forwarding URL (301 - Permanent Redirect)
Destination: https://99wisdombook.org/$1
```

---

## 🚀 배포 순서

### 1. CNAME 파일 배포
```bash
cd /home/user/webapp
git add CNAME
git commit -m "feat: Cloudflare 커스텀 도메인 추가 (99wisdombook.org)"
git push origin main
```

### 2. GitHub Pages에서 도메인 설정
- Settings → Pages → Custom domain → `99wisdombook.org` 입력 → Save

### 3. Cloudflare DNS 설정
- DNS 레코드 추가 (위 A 레코드 또는 CNAME)

### 4. 전파 대기
- DNS 전파: 10분 ~ 48시간 (일반적으로 10-30분)
- GitHub SSL 인증서: 10분 ~ 1시간

---

## ✅ 확인 방법

### 1. DNS 전파 확인
```bash
# 터미널에서
dig 99wisdombook.org
# 또는
nslookup 99wisdombook.org
```

예상 결과:
```
99wisdombook.org. 300 IN A 185.199.108.153
99wisdombook.org. 300 IN A 185.199.109.153
99wisdombook.org. 300 IN A 185.199.110.153
99wisdombook.org. 300 IN A 185.199.111.153
```

### 2. 웹 브라우저 확인
1. `https://99wisdombook.org` 접속
2. SSL 인증서 확인 (자물쇠 아이콘)
3. 페이지가 정상적으로 로드되는지 확인

### 3. 온라인 도구
- https://www.whatsmydns.net/#A/99wisdombook.org
- https://dnschecker.org/

---

## 🐛 문제 해결

### 1. "Domain's DNS record could not be retrieved"
**원인**: Cloudflare DNS 레코드가 아직 설정되지 않음

**해결**:
- Cloudflare 대시보드에서 A 레코드 추가
- 10-20분 대기 후 다시 시도

### 2. "HTTPS not available"
**원인**: SSL 인증서 발급 중

**해결**:
- GitHub Pages에서 "Enforce HTTPS" 체크 해제
- 1시간 대기
- 다시 "Enforce HTTPS" 체크

### 3. "404 - There isn't a GitHub Pages site here"
**원인**: CNAME 파일이 배포되지 않았거나 GitHub 설정 누락

**해결**:
```bash
# CNAME 파일 확인
ls -la /home/user/webapp/CNAME
cat /home/user/webapp/CNAME

# GitHub Pages 설정 확인
# Settings → Pages → Custom domain
```

### 4. 리다이렉트 루프
**원인**: Cloudflare SSL 모드와 GitHub Pages 충돌

**해결**:
- Cloudflare SSL/TLS 모드를 **Flexible**로 변경

---

## 📊 현재 상태

### ✅ 완료
- [x] CNAME 파일 생성
- [x] JavaScript 전역 함수 등록 (window.toggleLanguageMenu)
- [x] CSS 수평 정렬 강화 (line-height: 1, nowrap)
- [x] inline style 제거
- [x] 버전 업데이트 (v=1770958256)

### ⏳ 대기 중
- [ ] CNAME 파일 GitHub 배포
- [ ] Cloudflare DNS 레코드 추가
- [ ] GitHub Pages 커스텀 도메인 설정
- [ ] DNS 전파 대기
- [ ] SSL 인증서 발급

---

## 🎯 다음 단계

### 1단계: CNAME 배포 (지금 바로)
```bash
cd /home/user/webapp
git add CNAME
git commit -m "feat: Cloudflare 커스텀 도메인 추가 (99wisdombook.org)"
git push origin main
```

### 2단계: Cloudflare 설정 (5분)
1. https://dash.cloudflare.com 로그인
2. 99wisdombook.org 도메인 선택
3. DNS 탭에서 A 레코드 추가 (위 참조)

### 3단계: GitHub Pages 설정 (1분)
1. https://github.com/now4next/99wisdombook/settings/pages
2. Custom domain: `99wisdombook.org` 입력
3. Save 클릭
4. Enforce HTTPS 체크

### 4단계: 확인 (10-30분 후)
1. `https://99wisdombook.org` 접속
2. UI 작동 확인:
   - 사용자 이름 수평 정렬
   - Language 드롭다운 작동

---

## 📞 지원

문제가 발생하면:
1. GitHub Pages 상태: https://www.githubstatus.com/
2. Cloudflare 상태: https://www.cloudflarestatus.com/
3. DNS 전파 확인: https://www.whatsmydns.net/

---

## 🎉 예상 결과

설정 완료 후:
- `https://99wisdombook.org` ✅ 작동
- `http://99wisdombook.org` → `https://99wisdombook.org` 자동 리다이렉트
- `https://now4next.github.io/99wisdombook` ✅ 여전히 작동
- SSL 인증서 ✅ 자동 발급
- Cloudflare CDN ✅ 가속 적용

---

**작성일**: 2026-02-13  
**버전**: v=1770958256  
**커밋**: a28d0ba
