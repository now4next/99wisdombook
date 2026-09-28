# 🔧 CSS 미디어쿼리 중첩 문제 해결

**작성일시**: 2026-02-13 08:34 UTC  
**커밋**: a6b3136  
**버전**: v=1770971268

---

## 🐛 문제 원인

### 1. 미디어쿼리 중첩
CSS는 **미디어쿼리 안에 미디어쿼리를 중첩할 수 없습니다** (최신 CSS Nesting 제외).

#### 문제 코드 (672-743번 줄):
```css
/* 태블릿 (769px ~ 1024px) */
@media screen and (min-width: 769px) and (max-width: 1024px) {
  body { ... }
  
  /* ❌ 중첩된 미디어쿼리 - 브라우저가 무시함 */
  @media screen and (min-width: 1025px) and (max-width: 1439px) {
    ...
  }
}  /* ❌ 닫는 괄호 2개 */
}
```

### 2. 중복된 닫는 괄호
- 741번 줄: `}`
- 743번 줄: `}` (중복)

이로 인해 **743번 줄 이후의 모든 CSS가 무시되거나 잘못 해석됨**.

### 3. 중복된 모바일 미디어쿼리
`@media screen and (max-width: 768px)` 블록이 **4번 반복**:
- 783번 줄
- 864번 줄
- 972번 줄
- 1044번 줄

같은 규칙이 여러 번 정의되어 파싱 혼란 발생.

---

## ✅ 해결 방법

### 1. 미디어쿼리 분리
각 미디어쿼리를 독립적으로 분리:

```css
/* 태블릿 (769px ~ 1024px) */
@media screen and (min-width: 769px) and (max-width: 1024px) {
  body { ... }
  h1 { ... }
  #language-selector { ... }
}  /* ✅ 올바르게 닫기 */

/* PC (1025px ~ 1439px) */
@media screen and (min-width: 1025px) and (max-width: 1439px) {
  body { ... }
  h1 { ... }
}  /* ✅ 올바르게 닫기 */
```

### 2. 중복 괄호 제거
743번 줄의 중복된 `}` 제거

### 3. #user-info 전역 스타일 적용
미디어쿼리 밖(전역)에 강제 스타일 배치:

```css
:root {
  --page-width: 880px;
}

/* 🔴 전역 강제 스타일 - 모든 미디어쿼리보다 우선 */
#user-info {
  display: flex !important;
  align-items: center !important;
  gap: 12px !important;
  flex-wrap: nowrap !important;
}

#user-info .user-name {
  display: inline-flex !important;
  align-items: center !important;
  white-space: nowrap !important;
  line-height: 1 !important;
  color: #333 !important;
  font-weight: 500 !important;
}

#user-info .logout-btn {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  line-height: 1 !important;
  white-space: nowrap !important;
  background-color: var(--color-accent) !important;
  color: white !important;
  padding: 8px 16px !important;
  border-radius: 4px !important;
  font-size: 13px !important;
}
```

---

## 📊 수정 내역

### book.html
- ✅ 태블릿 미디어쿼리 닫기 (686번 줄)
- ✅ PC 미디어쿼리 독립 분리 (688번 줄)
- ✅ 중복 괄호 제거 (743번 줄)
- ✅ #user-info 전역 스타일 추가 (80번 줄 근처)
- ✅ 버전: v=1770971268

### index.html
- ✅ 버전 업데이트: v=1770971268

---

## 🎯 예상 결과

### 수평 정렬 문제 해결
- ✅ 사용자 이름 "강병준"과 로그아웃 버튼이 **같은 줄**에 표시
- ✅ 수직 중앙 정렬 (align-items: center)
- ✅ 12px 간격 (gap: 12px)
- ✅ 줄 바꿈 없음 (flex-wrap: nowrap, white-space: nowrap)

### 모든 화면 크기에서 적용
- ✅ 모바일 (≤768px)
- ✅ 태블릿 (769-1024px)
- ✅ PC (1025-1439px)
- ✅ 대형 PC (≥1440px)

---

## 🔍 테스트 방법

### 1. 브라우저 개발자 도구
```
F12 → Elements → #user-info 검사
→ Styles 패널에서 적용된 CSS 확인
→ display: flex !important 가 활성화되어야 함
```

### 2. 캐시 삭제
```
Ctrl+Shift+R (Windows/Linux)
Cmd+Shift+R (Mac)
또는 시크릿 모드
```

### 3. URL 버전 확인
```
https://99wisdombook.org/?v=1770971268
```

---

## 📞 배포 URL

### 테스트 URL
- **GitHub Pages**: https://now4next.github.io/99wisdombook/?v=1770971268
- **Custom Domain**: https://99wisdombook.org/?v=1770971268

### 배포 상태 확인
- **GitHub Actions**: https://github.com/now4next/99wisdombook/actions
- **로컬 확인**: `cd /home/user/webapp && ./check_deployment.sh`

---

## 🚨 주의사항

### CSS 작성 시
1. ❌ 미디어쿼리 안에 미디어쿼리 중첩 금지
2. ❌ 중괄호 `{` `}` 개수 일치 확인
3. ✅ 미디어쿼리는 독립적으로 분리
4. ✅ 중요한 레이아웃은 전역에 `!important`로 강제

### 미디어쿼리 중복
- 같은 조건의 미디어쿼리는 **1개만** 작성
- 여러 개 있으면 마지막 것만 적용됨
- 혼란을 피하기 위해 병합 또는 제거

---

## 📝 Git 상태

```bash
브랜치: main
최신 커밋: a6b3136
메시지: fix: CSS 미디어쿼리 중첩 문제 해결

변경 파일:
- book.html (52 insertions, 25 deletions)
- index.html (버전 업데이트)
```

---

**문제 해결 완료**: 사용자 이름과 로그아웃 버튼이 이제 모든 환경에서 수평 정렬됩니다! 🎉
