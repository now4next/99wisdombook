# book-zh.html 헤더 버튼 디버깅 코드 추가

## 날짜
2026-02-17

## 문제
book-zh.html 페이지에서 상단 헤더의 3개 버튼이 클릭해도 반응이 없음:
- 로그아웃 버튼 (logout)
- 언어 선택 버튼 (Language)
- 목차 버튼 (Contents)

## 디버깅 접근

### 추가된 Console 로그

#### 1. 함수 호출 확인
각 버튼 함수에 console.log 추가:

```javascript
window.logout = function() {
  console.log('✅ logout function called');
  // ...
};

window.toggleTOC = function() {
  console.log('✅ toggleTOC function called');
  // ...
};

window.toggleLanguageMenu = function(event) {
  console.log('✅ toggleLanguageMenu function called');
  // ...
};
```

#### 2. 함수 정의 확인
페이지 로드 시 함수들이 전역 스코프에 정의되었는지 확인:

```javascript
console.log('🔍 Checking global functions...');
console.log('window.logout:', typeof window.logout);
console.log('window.toggleTOC:', typeof window.toggleTOC);
console.log('window.toggleLanguageMenu:', typeof window.toggleLanguageMenu);
```

#### 3. DOM 요소 확인
함수 내부에서 DOM 요소가 제대로 찾아지는지 확인:

```javascript
window.toggleTOC = function() {
  const panel = document.getElementById('floating-toc-panel');
  const overlay = document.getElementById('toc-overlay');
  if (panel && overlay) {
    console.log('✅ TOC toggled, active:', panel.classList.contains('active'));
  } else {
    console.error('❌ TOC elements not found:', { panel, overlay });
  }
};
```

## 테스트 방법

### Chrome DevTools에서 확인

1. **페이지 접속**
   ```
   https://99wisdombook.pages.dev/book-zh
   ```

2. **개발자 도구 열기**
   - Windows/Linux: `F12` 또는 `Ctrl+Shift+I`
   - Mac: `Cmd+Option+I`

3. **Console 탭 선택**

4. **페이지 로드 시 로그 확인**
   ```
   🔍 Checking global functions...
   window.logout: function
   window.toggleTOC: function
   window.toggleLanguageMenu: function
   ```

5. **버튼 클릭 후 로그 확인**
   - 로그아웃 버튼 클릭 → `✅ logout function called`
   - 언어 버튼 클릭 → `✅ toggleLanguageMenu function called`
   - 목차 버튼 클릭 → `✅ toggleTOC function called`

## 예상되는 문제 시나리오

### 시나리오 1: 함수가 호출되지 않음
**증상**: 버튼 클릭 시 아무 로그도 출력되지 않음
**원인**: 
- CSS z-index 문제로 다른 요소가 버튼을 가리고 있음
- pointer-events가 none으로 설정됨
- 버튼이 실제로 클릭 가능한 영역 밖에 있음

**해결**:
```css
.text-btn {
  z-index: 1000;
  pointer-events: auto;
}
```

### 시나리오 2: 함수는 호출되지만 작동하지 않음
**증상**: `✅ function called` 로그는 보이지만 메뉴가 열리지 않음
**원인**:
- DOM 요소를 찾지 못함 (`getElementById` 실패)
- CSS 클래스가 제대로 추가/제거되지 않음
- CSS에서 `.show` 클래스 스타일이 없음

**해결**: DOM 요소와 CSS 확인

### 시나리오 3: 함수가 정의되지 않음
**증상**: `window.logout: undefined`
**원인**:
- JavaScript 로드 순서 문제
- 스크립트 오류로 함수 정의 전에 실행 중단

**해결**: 스크립트 구조 재점검

## Git 정보

### 커밋
- **Hash**: `e79b36b`
- **Message**: "debug: Add console logs to header buttons in book-zh.html for debugging"

### 변경사항
```
book-zh.html | 16 ++++++++++++++
1 file changed, 16 insertions(+)
```

## 배포 상태
✅ Cloudflare Pages에 배포 완료
- URL: https://99wisdombook.pages.dev/book-zh

## 다음 단계

### 디버깅 후 조치

1. **문제 원인 파악**
   - Console 로그 확인
   - 어떤 시나리오에 해당하는지 판단

2. **근본 원인 수정**
   - CSS 문제라면 z-index, pointer-events 조정
   - JavaScript 문제라면 함수 정의 위치 변경
   - DOM 문제라면 요소 ID 확인

3. **디버깅 로그 제거**
   - 문제 해결 후 console.log 제거
   - 프로덕션 코드를 깔끔하게 유지

## 참고 링크
- **Repository**: https://github.com/now4next/99wisdombook
- **Commit**: https://github.com/now4next/99wisdombook/commit/e79b36b
- **Live Page**: https://99wisdombook.pages.dev/book-zh

## 추가 디버깅 팁

### 브라우저 Console에서 직접 테스트
```javascript
// 1. 함수 존재 확인
typeof window.logout
typeof window.toggleTOC
typeof window.toggleLanguageMenu

// 2. 함수 직접 호출
window.logout()
window.toggleTOC()
window.toggleLanguageMenu()

// 3. DOM 요소 확인
document.getElementById('languageMenu')
document.getElementById('floating-toc-panel')
document.getElementById('tocBtn')

// 4. 버튼 요소 직접 확인
document.querySelector('.logout-btn')
document.querySelector('.language-btn')
document.querySelector('.contents-btn')
```

---
**작성일**: 2026-02-17
**상태**: 🔍 디버깅 중 - Console 로그 확인 필요
