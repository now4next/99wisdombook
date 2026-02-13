# GitHub Pages 배포 문제 해결 가이드

## 🔴 현재 상태
- **문제**: https://now4next.github.io/99wisdombook/ 접속 시 "Hello world"만 표시됨
- **원인**: GitHub Pages가 잘못된 소스를 가리키고 있음
- **예상 원인**:
  1. GitHub Pages가 `gh-pages` 브랜치를 가리키고 있음
  2. 또는 잘못된 디렉토리를 가리키고 있음

## ✅ 해결 방법

### 방법 1: GitHub Pages 설정 변경 (가장 빠름)

#### 1단계: GitHub 저장소 설정 페이지 이동
```
https://github.com/now4next/99wisdombook/settings/pages
```

#### 2단계: Source 설정 확인 및 변경
현재 설정을 확인하세요:
```
Build and deployment
Source: Deploy from a branch

Branch: ??? (현재 설정)
```

**올바른 설정으로 변경**:
```
Branch: main
Folder: / (root)
```

#### 3단계: Save 클릭

#### 4단계: 대기 및 확인
- 재배포 시간: 1-3분
- GitHub Actions 확인: https://github.com/now4next/99wisdombook/actions
- 배포 완료 후: https://now4next.github.io/99wisdombook/

---

### 방법 2: gh-pages 브랜치 삭제 (필요한 경우)

만약 `gh-pages` 브랜치가 존재하고 "Hello world"를 포함하고 있다면 삭제해야 합니다.

#### 로컬에서 삭제:
```bash
cd /home/user/webapp
git branch -D gh-pages 2>/dev/null || echo "No gh-pages branch locally"
git push origin --delete gh-pages 2>/dev/null || echo "No gh-pages branch remotely"
```

#### GitHub에서 삭제:
1. https://github.com/now4next/99wisdombook/branches
2. `gh-pages` 브랜치 옆의 휴지통 아이콘 클릭

---

### 방법 3: GitHub Actions로 자동 배포 설정 (권장)

GitHub Actions를 사용하면 매번 푸시할 때마다 자동으로 배포됩니다.

#### .github/workflows/deploy.yml 생성:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches:
      - main

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: '.'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

#### 적용 방법:
```bash
cd /home/user/webapp
mkdir -p .github/workflows
# 위 내용을 .github/workflows/deploy.yml에 저장
git add .github/workflows/deploy.yml
git commit -m "ci: GitHub Pages 자동 배포 설정"
git push origin main
```

그 다음 GitHub Pages 설정에서:
```
Source: GitHub Actions
```
선택

---

## 🔍 현재 상태 확인

### GitHub 저장소 파일 확인
✅ index.html 존재 확인:
```bash
curl -sL https://raw.githubusercontent.com/now4next/99wisdombook/main/index.html | head -5
```

결과:
```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
```

✅ book.html 존재 확인:
```bash
curl -sL https://raw.githubusercontent.com/now4next/99wisdombook/main/book.html | head -5
```

**결론**: 파일들은 GitHub에 올바르게 업로드되어 있음. 문제는 GitHub Pages 설정임.

---

## 📋 빠른 해결 체크리스트

### 1. GitHub Pages 설정 확인
- [ ] https://github.com/now4next/99wisdombook/settings/pages 접속
- [ ] Source 확인: **Deploy from a branch**
- [ ] Branch 확인: **main** 선택
- [ ] Folder 확인: **/ (root)** 선택
- [ ] **Save** 클릭

### 2. 잘못된 브랜치 삭제 (선택사항)
- [ ] https://github.com/now4next/99wisdombook/branches 확인
- [ ] `gh-pages` 브랜치 존재 시 삭제

### 3. 배포 확인
- [ ] https://github.com/now4next/99wisdombook/actions 접속
- [ ] 최근 workflow 실행 확인 (초록색 체크)
- [ ] 1-3분 대기

### 4. 사이트 확인
- [ ] https://now4next.github.io/99wisdombook/ 접속
- [ ] 로그인 페이지 표시 확인
- [ ] 강력 새로고침 (`Ctrl+Shift+R` / `Cmd+Shift+R`)

---

## 🐛 추가 문제 해결

### 문제 1: 여전히 "Hello world" 표시
**해결**:
1. 브라우저 캐시 완전 삭제
2. 시크릿 모드로 접속
3. 다른 브라우저로 테스트

### 문제 2: 404 Not Found
**해결**:
1. CNAME 파일 확인: `cat CNAME` → `99wisdombook.org`
2. Custom domain 설정 확인
3. CNAME 파일 재생성:
   ```bash
   echo "99wisdombook.org" > CNAME
   git add CNAME
   git commit -m "fix: CNAME 수정"
   git push origin main
   ```

### 문제 3: 배포가 느림
**원인**: GitHub Pages 빌드 큐 대기

**확인**:
- https://github.com/now4next/99wisdombook/deployments
- 최근 배포 상태 확인

---

## 🎯 권장 설정

### GitHub Pages 최적 설정:
```
Build and deployment:
  Source: Deploy from a branch
  Branch: main
  Folder: / (root)

Custom domain:
  99wisdombook.org
  ✅ Enforce HTTPS
```

### CNAME 파일:
```
99wisdombook.org
```

### .gitignore (선택사항):
```
# 배포하지 않을 파일들
.DS_Store
*.log
node_modules/
.env
```

---

## 📊 예상 결과

설정 완료 후:
1. https://now4next.github.io/99wisdombook/ → 로그인 페이지 표시
2. https://99wisdombook.org → 로그인 페이지 표시 (DNS 설정 후)
3. 로그인 후 book.html로 자동 이동
4. Language 버튼 클릭 → 8개 언어 드롭다운
5. 사용자 이름 + 로그아웃 버튼 수평 정렬

---

## 🚀 즉시 해야 할 작업

### 1단계: GitHub Pages 설정 확인 (지금 바로)
```
https://github.com/now4next/99wisdombook/settings/pages
```

**현재 설정 확인**:
- Source: ?
- Branch: ?
- Folder: ?

**올바른 설정으로 변경**:
- Source: Deploy from a branch
- Branch: main
- Folder: / (root)

### 2단계: Save 클릭

### 3단계: 1-3분 대기

### 4단계: 확인
```
https://now4next.github.io/99wisdombook/
```

---

## 💡 추가 팁

### GitHub Pages 강제 재배포:
1. 빈 커밋 생성:
   ```bash
   git commit --allow-empty -m "chore: GitHub Pages 재배포 트리거"
   git push origin main
   ```

2. GitHub Actions 확인:
   ```
   https://github.com/now4next/99wisdombook/actions
   ```

### 캐시 우회 URL:
```
https://now4next.github.io/99wisdombook/?nocache=1770958256
```

---

## 📞 문제 지속 시

다음 정보를 제공해 주세요:
1. **GitHub Pages 설정 스크린샷**:
   - https://github.com/now4next/99wisdombook/settings/pages

2. **현재 Branch 설정**:
   - 어떤 브랜치가 선택되어 있는지

3. **Branches 페이지 스크린샷**:
   - https://github.com/now4next/99wisdombook/branches
   - 어떤 브랜치들이 존재하는지

4. **GitHub Actions 상태**:
   - https://github.com/now4next/99wisdombook/actions
   - 최근 workflow가 성공했는지

---

**작성일**: 2026-02-13  
**우선순위**: 🔴 긴급  
**예상 해결 시간**: 5분
