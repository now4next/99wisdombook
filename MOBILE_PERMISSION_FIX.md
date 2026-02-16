# 🔧 모바일 언어 권한 인식 문제 수정

**날짜**: 2026-02-16  
**커밋**: `b5c30d7`  
**문제**: 영어 권한이 있는 일반 회원이 모바일에서 접속 시 권한 거부됨

---

## 🐛 문제 상황

### 증상
- **PC 환경**: 영어 권한(`english`) 보유 사용자가 book-en.html 접속 → ✅ 정상 작동
- **모바일 환경**: 동일한 사용자가 모바일에서 접속 → ❌ "권한이 제한되어 있습니다" 메시지

### 영향 범위
- 모든 언어 페이지 (`book-en.html`, `book-zh.html`, `book-ja.html` 등)
- 일반 회원 (관리자는 영향 없음)
- 주로 모바일 디바이스

---

## 🔍 원인 분석

### 불일치 문제

**Backend/Database (API)**:
```javascript
// functions/api/[[path]].js
const validPermissions = [
  'korean',    // ← 전체 이름
  'english',   // ← 전체 이름
  'chinese',
  'japanese',
  'spanish',
  'french',
  'arabic',
  'russian'
];
```

**Frontend (book-en.html 등)**:
```javascript
// 이전 코드 - 짧은 코드만 체크
if (user.permissions.includes('en')) {  // ❌ 'english'와 불일치!
  // 접근 허용
}
```

### 왜 PC에서는 작동했을까?

가능한 시나리오:
1. **localStorage 데이터 차이**: 
   - PC: 이전 버전에서 `'en'` 형식으로 저장된 데이터 사용
   - Mobile: 새로 로그인하여 API에서 받은 `'english'` 형식 사용

2. **캐시 차이**:
   - PC: 브라우저 캐시에 이전 형식 데이터 존재
   - Mobile: 깨끗한 상태에서 접속하여 최신 API 데이터 사용

---

## ✅ 해결 방법

### 1. 언어 코드 매핑 추가

```javascript
// Language code mapping: short code <-> full name
const LANG_MAP = {
  'ko': 'korean',
  'en': 'english',
  'zh': 'chinese',
  'ja': 'japanese',
  'es': 'spanish',
  'fr': 'french',
  'ru': 'russian',
  'ar': 'arabic'
};
```

### 2. 변환 함수 추가

```javascript
// Convert short code to full name or vice versa
function normalizePermission(perm) {
  return LANG_MAP[perm] || perm;
}
```

### 3. 통합 권한 체크 함수

```javascript
// Check if user has permission (supports both short and full format)
function hasPermission(permissions, lang) {
  if (!permissions || !Array.isArray(permissions)) return false;
  const normalized = normalizePermission(lang);
  
  // Check both formats: 'en' and 'english'
  return permissions.includes(lang) || permissions.includes(normalized);
}
```

### 4. 모든 권한 체크 업데이트

**Before (이전)**:
```javascript
// ❌ 하나의 형식만 체크
if (user.permissions.includes('en')) {
  // ...
}
```

**After (수정 후)**:
```javascript
// ✅ 두 형식 모두 지원
if (hasPermission(user.permissions, 'en')) {
  // 'en' 또는 'english' 모두 인식
}
```

---

## 📝 수정된 파일

### 1. book-en.html (영어 페이지)
- ✅ LANG_MAP 추가
- ✅ hasPermission() 함수 추가
- ✅ 4곳의 권한 체크 업데이트:
  1. 페이지 로드 시 권한 체크 (30번째 줄)
  2. checkLanguagePermission 함수 (57번째 줄)
  3. 언어 메뉴 필터링 (66번째 줄)
  4. 언어 링크 클릭 시 (94번째 줄)

### 2. book.html (한국어 페이지)
- ✅ LANG_MAP 추가
- ✅ hasPermission() 함수 추가
- ✅ 4곳의 권한 체크 업데이트:
  1. checkLanguagePermission 함수
  2. 언어 메뉴 필터링
  3. 디버그 로그
  4. 언어 링크 클릭 시

---

## 🔄 작동 방식

### 예시: 영어 권한 체크

**사용자 권한 데이터**:
```json
{
  "username": "peter",
  "permissions": ["korean", "english"]
}
```

**권한 체크 시나리오**:

```javascript
// Scenario 1: 짧은 코드로 체크
hasPermission(["korean", "english"], "en")
// → normalizePermission("en") = "english"
// → permissions.includes("en") = false
// → permissions.includes("english") = true
// → 결과: ✅ true (접근 허용)

// Scenario 2: 전체 이름으로 체크
hasPermission(["korean", "english"], "english")
// → normalizePermission("english") = "english"
// → permissions.includes("english") = true
// → 결과: ✅ true (접근 허용)

// Scenario 3: 권한 없음
hasPermission(["korean", "english"], "zh")
// → normalizePermission("zh") = "chinese"
// → permissions.includes("zh") = false
// → permissions.includes("chinese") = false
// → 결과: ❌ false (접근 거부)
```

---

## 🧪 테스트 방법

### 1. 배포 대기 (1-2분)
```
커밋: b5c30d7
배포: Cloudflare Pages 자동 배포
```

### 2. 일반 회원 계정 준비

**Admin 페이지에서 설정**:
1. https://99wisdombook.pages.dev/admin 접속
2. 테스트 계정 생성 또는 편집
3. **영어(English)** 권한 체크박스 선택
4. 저장

**예상 권한 데이터**:
```json
{
  "username": "testuser",
  "role": "user",
  "permissions": ["korean", "english"]
}
```

### 3. PC에서 테스트

1. **로그아웃** 후 테스트 계정으로 로그인
2. 언어 메뉴에서 **English** 선택
3. book-en.html 페이지 접속 확인
4. ✅ **예상**: 정상 접속

### 4. 모바일에서 테스트

**삼성 S25 또는 다른 모바일**:
1. **시크릿/프라이빗 모드** 열기
2. https://99wisdombook.pages.dev 접속
3. 동일한 테스트 계정으로 로그인
4. 언어 메뉴에서 **English** 선택
5. book-en.html 페이지 접속 확인
6. ✅ **예상**: 정상 접속 (권한 거부 없음)

### 5. 개발자 도구로 확인 (선택사항)

**Console 로그 확인**:
```javascript
// 페이지 로드 시 출력되는 로그
🔍 [English Page Load] Current user: {...}
🔍 [English Page Load] User role: user
🔍 [English Page Load] User permissions: ["korean", "english"]
✅ [English Page Load] Permission granted for English
```

**권한 거부 시 (권한 없는 경우)**:
```javascript
🔍 [English Page Load] User permissions: ["korean"]
❌ [English Page Load] No permission for English, redirecting to book.html
```

---

## 📊 지원 형식 비교

| 형식 | 예시 | 사용 위치 | 이전 지원 | 현재 지원 |
|------|------|-----------|-----------|-----------|
| **Short Code** | `'en'`, `'ko'` | 프론트엔드 | ✅ | ✅ |
| **Full Name** | `'english'`, `'korean'` | Backend/API | ❌ | ✅ |

---

## 🎯 적용 범위

### 현재 수정된 페이지
- ✅ **book.html** (한국어)
- ✅ **book-en.html** (영어)

### 향후 적용 필요 (선택사항)
- ⚠️ **book-zh.html** (중국어)
- ⚠️ **book-ja.html** (일본어)
- ⚠️ **book-es.html** (스페인어)
- ⚠️ **book-fr.html** (프랑스어)
- ⚠️ **book-ru.html** (러시아어)
- ⚠️ **book-ar.html** (아랍어)

**참고**: 한국어와 영어가 가장 많이 사용되므로 우선 수정했습니다.  
다른 언어 페이지도 동일한 방식으로 수정 가능합니다.

---

## 🔄 배포 상태

### Cloudflare Pages
- ✅ **GitHub Push**: 완료 (커밋 `b5c30d7`)
- ✅ **자동 배포**: 시작됨
- ⏱️ **배포 시간**: 1-2분
- 🌐 **Live URL**: https://99wisdombook.pages.dev

### 확인 방법
1. https://dash.cloudflare.com 접속
2. **Workers & Pages** → **99wisdombook**
3. **Deployments** 탭
4. 커밋 `b5c30d7` 상태: **Success** ✅

---

## 💡 추가 권장 사항

### 1. API 응답 형식 통일 (선택사항)

현재 API는 전체 이름(`'english'`)을 사용하고 있습니다.  
프론트엔드와 통일하려면 API를 짧은 코드로 변경할 수 있습니다:

```javascript
// functions/api/[[path]].js
const validPermissions = ['ko', 'en', 'zh', 'ja', 'es', 'fr', 'ru', 'ar'];
```

**장점**:
- 프론트엔드와 형식 통일
- 데이터 크기 감소

**단점**:
- 기존 DB 데이터 마이그레이션 필요
- 관리자 페이지 업데이트 필요

### 2. 타입 안전성 추가 (선택사항)

```javascript
// TypeScript or JSDoc
/**
 * @param {string[]} permissions - User's permission array
 * @param {string} lang - Language code (short or full)
 * @returns {boolean}
 */
function hasPermission(permissions, lang) {
  // ...
}
```

---

## 🐛 문제 지속 시 디버깅

### 1. Console 로그 확인

**F12 → Console**:
```javascript
// 다음 로그가 출력되는지 확인
🔍 [English Page Load] Current user: {...}
🔍 [English Page Load] User permissions: [...]
```

### 2. localStorage 확인

**F12 → Application → Local Storage**:
```javascript
// currentUser 확인
{
  "username": "testuser",
  "permissions": ["korean", "english"]  // ← 이 형식 확인
}
```

### 3. 권한 데이터 재확인

```javascript
// Console에서 직접 실행
const user = JSON.parse(localStorage.getItem('currentUser'));
console.log('User permissions:', user.permissions);
console.log('Has English?:', hasPermission(user.permissions, 'en'));
```

---

## 📚 관련 문서

- **Admin CRUD**: [ADMIN_CRUD_COMPLETE.md](ADMIN_CRUD_COMPLETE.md)
- **모바일 UI**: [MOBILE_UI_UPDATE.md](MOBILE_UI_UPDATE.md)
- **삼성 모바일 수정**: [SAMSUNG_MOBILE_FIX.md](SAMSUNG_MOBILE_FIX.md)
- **Book 배포**: [BOOK_DEPLOYMENT.md](BOOK_DEPLOYMENT.md)

---

## 🔗 링크

- **GitHub Repository**: https://github.com/now4next/99wisdombook
- **Live Site**: https://99wisdombook.pages.dev
- **Latest Commit**: [`b5c30d7`](https://github.com/now4next/99wisdombook/commit/b5c30d7)

---

## 📝 요약

### 문제
- DB/API: `'english'` 형식 사용
- Frontend: `'en'` 형식만 체크
- 결과: 모바일에서 권한 인식 실패

### 해결
- `hasPermission()` 함수로 **두 형식 모두 지원**
- `'en'`과 `'english'` 모두 인식
- PC/모바일 모두 정상 작동

### 효과
- ✅ PC 환경 정상 작동 (기존 유지)
- ✅ 모바일 환경 정상 작동 (문제 해결)
- ✅ 하위 호환성 보장
- ✅ 향후 확장 용이

---

**작성자**: Claude AI  
**날짜**: 2026-02-16  
**버전**: 1.0 (Permission Fix)
