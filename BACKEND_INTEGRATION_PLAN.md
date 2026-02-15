# 🔥 Firebase 통합 구현 계획

## 📋 구현 기능

### 1. Firebase 설정
- Firebase 프로젝트 생성
- Firestore Database 활성화
- Firebase Authentication 설정
- 웹 앱 등록 및 설정

### 2. 사용자 인증 시스템
```javascript
// Firebase Auth로 전환
- 회원가입: createUserWithEmailAndPassword()
- 로그인: signInWithEmailAndPassword()
- 로그아웃: signOut()
- 세션 유지: onAuthStateChanged()
```

### 3. 실시간 사용자 관리
```javascript
// Firestore에 사용자 정보 저장
users (collection)
  └─ {userId} (document)
      ├─ username: string
      ├─ email: string
      ├─ name: string
      ├─ role: "user" | "admin"
      ├─ permissions: string[]
      ├─ createdAt: timestamp
      └─ updatedAt: timestamp
```

### 4. 실시간 대시보드
```javascript
// 실시간 리스너로 자동 업데이트
db.collection('users').onSnapshot((snapshot) => {
  snapshot.docChanges().forEach((change) => {
    if (change.type === 'added') {
      // 새 회원 추가
    }
    if (change.type === 'modified') {
      // 회원 정보 수정
    }
    if (change.type === 'removed') {
      // 회원 삭제
    }
  });
});
```

### 5. 관리자 CRUD 기능
- ✅ Create: 회원 생성
- ✅ Read: 회원 목록 조회 (실시간)
- ✅ Update: 권한 수정, 역할 변경
- ✅ Delete: 회원 삭제

### 6. 보안 규칙
```javascript
// Firestore Security Rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      // 관리자만 모든 사용자 읽기/쓰기 가능
      allow read, write: if request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
      
      // 사용자는 자신의 데이터만 읽기 가능
      allow read: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 🚀 구현 단계

### Phase 1: Firebase 설정 (1-2시간)
1. Firebase 프로젝트 생성
2. 설정 파일 통합
3. HTML에 Firebase SDK 추가

### Phase 2: 인증 시스템 마이그레이션 (2-3시간)
1. index.html: localStorage → Firebase Auth
2. 회원가입/로그인 로직 변경
3. 세션 관리 개선

### Phase 3: 실시간 대시보드 (2-3시간)
1. admin.html: Firestore 실시간 리스너 구현
2. 회원 목록 자동 업데이트
3. CRUD 기능 연동

### Phase 4: 권한 관리 (1-2시간)
1. 권한 수정 UI 개선
2. Firestore 업데이트 연동
3. 실시간 권한 동기화

### Phase 5: 테스트 및 배포 (1-2시간)
1. 다중 기기 테스트
2. 실시간 동기화 검증
3. 보안 규칙 적용

## 💰 비용
- Firebase Spark Plan (무료)
  - 1GB 저장소
  - 10GB 전송량/월
  - 50,000 읽기/일
  - 20,000 쓰기/일
  - 소규모 서비스에 충분

## ⚠️ 마이그레이션 주의사항
1. 기존 localStorage 데이터 백업
2. 점진적 마이그레이션 (병행 운영)
3. 사용자에게 재로그인 요청 필요
4. 기존 권한 데이터 Firebase로 이관

## 📝 필요한 Firebase 계정 정보
진행하려면 다음이 필요합니다:
1. Google 계정 (Firebase 접속용)
2. Firebase 프로젝트 생성 권한
3. Firebase 설정 키 제공

진행하시겠습니까?
