# 권한 시스템 작동 검증

## ✅ 권한 검사 로직 확인

### 1. hasPermission 함수
```javascript
function hasPermission(permissions, lang) {
  if (!permissions || !Array.isArray(permissions)) return false;  // ⬅️ 권한 없으면 거부!
  const normalized = normalizePermission(lang);
  return permissions.includes(lang) || permissions.includes(normalized);
}
```

**핵심**: 
- `permissions`가 없거나 배열이 아니면 → **즉시 false 반환** ✅
- 배열이어도 해당 언어가 없으면 → **false 반환** ✅

### 2. 권한 검사 3단계

#### ① checkLanguagePermission (전역 함수)
```javascript
window.checkLanguagePermission = function(langCode) {
  if (user.role === 'admin') return true;  // Admin만 모든 언어 접근
  return hasPermission(user.permissions, langCode);  // 일반 사용자는 권한 확인
};
```

#### ② 언어 메뉴 시각적 표시
```javascript
if (languageMenu && user.role !== 'admin') {  // Admin이 아닐 때만
  const links = languageMenu.querySelectorAll('a[data-lang]');
  links.forEach(link => {
    const lang = link.getAttribute('data-lang');
    if (!hasPermission(user.permissions, lang)) {  // 권한 없으면
      link.style.opacity = '0.5';           // 회색 처리
      link.style.pointerEvents = 'none';    // 클릭 차단
      link.style.textDecoration = 'line-through';  // 취소선
      link.title = '이 언어에 대한 권한이 없습니다';
    }
  });
}
```

#### ③ 클릭 시 최종 검증
```javascript
document.querySelectorAll('.language-menu a[data-lang]').forEach(link => {
  link.addEventListener('click', function(e) {
    const user = JSON.parse(currentUser);
    
    // Admin이 아니고 권한 없으면
    if (user.role !== 'admin' && !hasPermission(user.permissions, lang)) {
      e.preventDefault();  // 페이지 이동 차단
      alert('⚠️ 언어 열람 권한이 없습니다\n\n해당 언어에 대한 열람 접근 승인이 안되어 있습니다.\n관리자에게 문의하세요.');
      return false;
    }
  });
});
```

## 🧪 테스트 시나리오

### 시나리오 1: Peter (모든 언어 권한)
```javascript
user: {
  name: 'Peter',
  role: 'user',  // 일반 사용자
  permissions: ['korean', 'english', 'chinese', 'japanese', 'spanish', 'french', 'russian', 'arabic', 'hindi']
}

// 테스트
hasPermission(permissions, 'ko')  // ✅ true (korean)
hasPermission(permissions, 'zh')  // ✅ true (chinese)
hasPermission(permissions, 'ja')  // ✅ true (japanese)

// 결과: Peter는 9개 언어 모두 접근 가능 ✅
```

### 시나리오 2: 일반 사용자 (한국어, 영어만)
```javascript
user: {
  name: 'User1',
  role: 'user',
  permissions: ['ko', 'en']  // 또는 ['korean', 'english']
}

// 테스트
hasPermission(permissions, 'ko')  // ✅ true
hasPermission(permissions, 'en')  // ✅ true
hasPermission(permissions, 'zh')  // ❌ false (중국어 권한 없음)
hasPermission(permissions, 'ja')  // ❌ false (일본어 권한 없음)
hasPermission(permissions, 'es')  // ❌ false (스페인어 권한 없음)

// 결과: 
// - 한국어, 영어만 접근 가능 ✅
// - 나머지 언어는 회색 처리 + 클릭 차단 ✅
// - 클릭 시 "권한 없음" 경고창 ✅
```

### 시나리오 3: 권한 없는 사용자
```javascript
user: {
  name: 'User2',
  role: 'user',
  permissions: []  // 빈 배열
}

// 테스트
hasPermission([], 'ko')  // ❌ false (배열은 있지만 비어있음)
hasPermission([], 'en')  // ❌ false
hasPermission([], 'zh')  // ❌ false

// 결과: 모든 언어 접근 불가 ✅
```

### 시나리오 4: 권한 데이터 없음
```javascript
user: {
  name: 'User3',
  role: 'user',
  permissions: null  // 또는 undefined
}

// 테스트
hasPermission(null, 'ko')  // ❌ false (첫 줄에서 즉시 반환)
hasPermission(undefined, 'en')  // ❌ false

// 결과: 모든 언어 접근 불가 ✅
```

### 시나리오 5: Admin 계정
```javascript
user: {
  name: 'Admin',
  role: 'admin',
  permissions: []  // 비어있어도 상관없음
}

// checkLanguagePermission 함수
if (user.role === 'admin') return true;  // 권한 검사 없이 바로 true

// 결과: Admin은 permissions 상관없이 모든 언어 접근 가능 ✅
```

## 🔒 관리자 권한 설정 반영

### 관리자가 권한 변경 시
```javascript
// Before: 한국어만
permissions: ['ko']

// Admin이 중국어 추가
permissions: ['ko', 'zh']

// 즉시 반영:
hasPermission(['ko', 'zh'], 'zh')  // ✅ true (접근 가능)
hasPermission(['ko', 'zh'], 'ja')  // ❌ false (일본어는 여전히 차단)
```

### 실시간 동작
1. **관리자가 admin.html에서 사용자 권한 변경**
2. **API를 통해 DB 업데이트**
3. **사용자가 페이지 새로고침 또는 재로그인**
4. **새 권한이 localStorage/sessionStorage에 저장**
5. **각 페이지에서 새 권한 기준으로 검사** ✅

## 📊 변경 전후 비교

### Before (문제)
```javascript
// Short code만 인식
permissions: ['chinese']
check: 'zh' in ['chinese']  // ❌ false (형식 불일치)
→ 권한 있어도 접근 거부!
```

### After (해결)
```javascript
// Short code와 Full name 모두 인식
permissions: ['chinese']
hasPermission(['chinese'], 'zh')
→ 'zh' → 'chinese' 변환
→ 'chinese' in ['chinese']  // ✅ true
→ 권한 있으면 접근 허용!

// 하지만 권한 없으면
permissions: ['korean']
hasPermission(['korean'], 'zh')
→ 'zh' → 'chinese' 변환
→ 'chinese' in ['korean']  // ❌ false
→ 권한 없으면 접근 거부!
```

## ✨ 결론

**수정 내용**:
- ❌ 권한 시스템 우회 (아님!)
- ✅ 권한 데이터 형식 호환성 개선

**권한 검사**:
- ✅ Admin만 모든 언어 접근 가능
- ✅ 일반 사용자는 부여된 권한만 접근
- ✅ 권한 없는 언어는 시각적 차단 + 클릭 차단 + 경고창
- ✅ 관리자가 권한 변경하면 즉시 반영

**해결한 문제**:
- Peter의 권한이 `['chinese']` 형식이어도
- 페이지에서 `'zh'`로 확인해도
- 정상 매칭되어 접근 가능

**유지되는 보안**:
- 권한 없는 언어는 여전히 차단 ✅
- 형식만 유연하게 지원 ✅
