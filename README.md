# 약속잡기 (Meetup Scheduler)

이름과 생년월일만으로 그룹 약속 날짜·시간을 조율하는 정적 웹 서비스입니다.
GitHub Pages(정적 호스팅) + Firebase(Authentication 익명 로그인 + Firestore) 무료 요금제(Spark)로 동작하도록 설계했습니다.

---

## 1. 전체 시스템 아키텍처

```
┌─────────────────────┐        HTTPS        ┌──────────────────────────┐
│   브라우저 (PC/모바일) │ ───────────────────▶ │   GitHub Pages (정적 파일) │
│  index.html/css/js   │ ◀─────────────────── │   index.html, css/, js/   │
└──────────┬───────────┘                      └──────────────────────────┘
           │  Firebase JS SDK (모듈, CDN)
           ▼
┌───────────────────────────────────────────────────────────┐
│                     Firebase (Spark 무료 요금제)              │
│  ┌───────────────────┐     ┌────────────────────────────┐ │
│  │  Authentication    │     │  Firestore Database         │ │
│  │  (익명 로그인)        │     │  users / groups / invitations│ │
│  │                    │     │  groups/{id}/responses      │ │
│  └───────────────────┘     └────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

- 서버 코드가 없는 **완전 정적 SPA**입니다. 모든 로직(등록, 그룹 생성/참여, 일정 입력, 결과 집계)은 브라우저에서 Firestore SDK를 직접 호출해 처리합니다.
- Cloud Functions는 사용하지 않습니다. Spark 무료 요금제만으로 충분히 동작하도록 의도적으로 뺐습니다(향후 확장 참고).
- 라우팅은 해시 기반(`#/group`, `#/schedule/xxx` 등)이라 별도 서버 설정 없이 GitHub Pages에 그대로 올릴 수 있습니다.

---

## 2. Firebase / Firestore 데이터 구조

| 컬렉션 | 문서 ID | 필드 |
|---|---|---|
| `users` | 자동 ID | `name`, `birth`, `userKey`(`이름_생년월일`), `createdAt` |
| `groups` | 자동 ID | `name`, `type`(`date`\|`time`), `passwordHash`, `periodDays`, `deadlineAt`, `createdBy`, `createdAt`, `members[]` |
| `groups/{id}/responses` | `userKey` | `userName`, `answers`(맵), `updatedAt` |
| `groups/{id}/results` | `summary` | `totals`, `computedAt` (클라이언트가 계산 후 캐시, 선택 사항) |
| `invitations` | 초대코드(8자 무작위) | `groupId`, `createdAt` |

**`answers` 맵 형식**

- 날짜형: `{ "2026-08-01": "O", "2026-08-02": "△", ... }`
- 시간형: `{ "2026-08-01_09:00": "O", "2026-08-01_09:30": "X", ... }`

**동명이인 구분**: `userKey = 이름_생년월일6자리` 조합을 문서 조회 키로 사용해 중복 등록을 막습니다.

**초대 링크**: `groups` 문서의 자동 ID를 그대로 노출하지 않고, 짧은 무작위 코드(`invitations/{code} → groupId`)를 따로 발급해 `https://example.com/#/invite/xxxxxxxx` 형태로 공유합니다.

---

## 3. 화면 설계 (와이어프레임 요약)

```
[등록]                    [그룹 홈]                  [약속 생성]
이름 ______               기존 약속 참여               약속 이름 ______
생년월일 ______           약속이름/비밀번호             비밀번호 ______
[ 시작하기 ]               [ 참여하기 ]                 유형: (날짜)(시간)
                          ── 또는 ──                   기간: 3 7 8 14 [직접]
                          [ 약속 만들기 ]                [ 약속 생성 ]

[일정 입력 - 날짜형]                    [일정 입력 - 시간형]
⏳ 약속이름   n일 남음                   달력에서 날짜 다중 선택(✓)
◀ 2026년 8월 ▶                          └ 선택된 날짜별로
일 월 화 수 목 금 토                        09:00 09:30 10:00 ... 슬롯 그리드
[캘린더 그리드, 클릭/드래그로 X○△]        (클릭/드래그로 X○△)
[현재까지 결과 보기] [저장하기]

[결과 화면]
"약속이름"   총 n명 참여
▇▇▇▇▇▇▇▇ 2026-08-01        100%  (진한 초록)
▇▇▇▇▇▇   2026-08-02         75%  (연한 초록)
▇▇▇▇     09:00 (08-03)      50%  (노랑)
▇▇       10:00 (08-03)      25%  (주황)
```

---

## 4. 폴더 구조

```
meetup-app/
├── index.html            # SPA 진입점, 모든 화면 컨테이너 + 도움말 모달
├── css/
│   └── style.css         # 디자인 토큰, 반응형, 컴포넌트 스타일
├── js/
│   ├── firebase-config.js  # Firebase 초기화 + 익명 로그인
│   ├── utils.js             # 해시, 날짜, 상태값 순환 등 유틸
│   ├── db.js                 # Firestore CRUD (users/groups/responses/invitations)
│   └── app.js                 # 라우터 + 화면 렌더링 + 달력/시간 선택 UI
├── firestore.rules        # Firestore 보안 규칙
└── README.md
```

---

## 5. Firebase 연동 방법

1. [Firebase 콘솔](https://console.firebase.google.com)에서 새 프로젝트 생성 (Spark 무료 요금제 그대로 사용 가능)
2. **Authentication → Sign-in method → 익명** 활성화
3. **Firestore Database** 생성 (프로덕션 모드로 시작)
4. 프로젝트 설정 → 일반 → "웹 앱 추가" 후 발급받은 설정값을 `js/firebase-config.js`의 `firebaseConfig` 객체에 붙여넣기
5. Firebase CLI로 보안 규칙 배포:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init firestore   # 기존 firestore.rules 사용하도록 선택
   firebase deploy --only firestore:rules
   ```

---

## 6. GitHub Pages 배포 방법

1. GitHub에 새 저장소 생성 후 `meetup-app` 폴더 내용을 push
2. 저장소 **Settings → Pages** 이동
3. **Source**를 `Deploy from a branch`로 설정, 브랜치는 `main`(또는 `master`), 폴더는 `/ (root)` 선택
4. 몇 분 후 `https://{사용자명}.github.io/{저장소명}/` 로 접속 가능
5. `js/app.js`의 초대 링크 생성 로직은 `location.origin + location.pathname`을 자동으로 사용하므로 별도 설정 없이 배포 주소에 맞춰 동작합니다.

> 커스텀 도메인을 쓰려면 저장소에 `CNAME` 파일을 추가하고 Pages 설정에서 도메인을 등록하세요.

---

## 7. 모바일 대응

- `viewport` 메타 태그 + 모든 레이아웃을 `rem`/`%`/`grid`로 구성해 반응형으로 동작합니다.
- 날짜·시간 선택은 마우스 드래그뿐 아니라 `touchstart/touchmove/touchend`를 함께 처리해 손가락 드래그로도 다중 선택이 가능합니다.
- 560px 이하 화면에서는 카드 여백, 버튼 배치, 슬롯 그리드 컬럼 수를 축소하는 미디어 쿼리를 적용했습니다.
- 포커스 링(`:focus-visible`)과 `prefers-reduced-motion` 대응을 포함해 접근성을 최소한으로 보장합니다.

---

## 8. 보안 고려사항

- **비밀번호 평문 저장 금지**: 그룹 비밀번호는 `crypto.subtle.digest("SHA-256", ...)`로 해시한 값만 Firestore에 저장합니다.
- **Firestore 규칙으로 접근 제한**: 모든 읽기/쓰기는 Firebase 익명 인증(`request.auth != null`)을 요구합니다. 그룹 가입(`members` 배열 갱신)은 제출한 비밀번호 해시가 저장된 해시와 정확히 일치할 때만 허용됩니다.
- **마감 후 쓰기 차단**: `responses` 쓰기 규칙이 그룹의 `deadlineAt`을 서버 시각(`request.time`)과 비교해, 마감 이후에는 신규 응답/수정 자체를 거부합니다.
- **추측 불가능한 링크**: 초대 코드는 8자리 무작위 문자열이며, `groups` 문서의 실제 ID와 별도로 관리됩니다.
- **알려진 한계 (MVP 트레이드오프)**: Cloud Functions 없이 순수 클라이언트 + Firestore 규칙만 사용하기 때문에, "이 브라우저가 정말 그 이름의 본인인지"까지는 암호학적으로 증명하지 못합니다(익명 인증 uid와 `userKey`가 분리되어 있음). 친구 단위 소규모 그룹 조율 용도로는 충분하지만, 더 강한 신원 보증이 필요하다면 이메일/OAuth 로그인 전환이나 Cloud Functions + Firebase App Check 도입을 권장합니다.

---

## 9. 향후 확장 기능 제안

- 이메일/OAuth 로그인으로 전환해 기기 간 로그인 상태 동기화
- Cloud Functions로 마감 시각에 자동 알림(이메일/카카오톡 알림톡) 발송
- 참여자별 "최적 시간대 추천"(가능 인원이 가장 많은 상위 N개 자동 하이라이트)
- 그룹장 전용 관리 기능(마감 연장, 참여자 강제 제외, 약속 삭제)
- 캘린더(Google Calendar 등) 내보내기(.ics) 지원
- 다국어(영어 등) UI 지원

---

## 10. 로컬에서 테스트하기

정적 파일이라 별도 빌드 없이 실행할 수 있습니다.

```bash
cd meetup-app
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

`js/firebase-config.js`에 실제 Firebase 프로젝트 값을 넣어야 등록/그룹 생성 등 실제 데이터 동작을 확인할 수 있습니다.
