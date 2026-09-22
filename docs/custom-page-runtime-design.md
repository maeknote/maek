# Custom Page Runtime 설계와 구현 계획

작성일: 2026-09-22

## 한 줄 결론

새 앱은 자기 폴더에 `maek.page.json`을 두기만 하면 된다. Maek은 HTML을 열 때 이 파일을
자동으로 찾고, 선언된 JSON/text 파일에 한해서 읽기·쓰기·충돌 확인·백업·묶음 저장을
제공한다. 화면과 편집 규칙은 각 앱의 HTML/JavaScript에 남는다. 일반적인 파일 편집 앱은
Maek 중앙 코드에 따로 등록하지 않는다.

```text
앱 폴더
├── index.html          화면 + 앱 고유 편집 로직
├── maek.page.json      이 앱이 쓸 파일과 권한
└── data.json           실제 데이터
        │
        │ HTML을 Maek에서 열기
        v
Maek Custom Page Host
├── manifest 자동 발견
├── 격리된 페이지 URL 제공
├── 허용 파일만 읽기/쓰기
├── 버전 충돌 방지
├── 자동 백업
└── 여러 파일 묶음 저장
```

별도 Python/Node 서버를 자동 실행하는 구조는 쓰지 않는다. 서버가 둘이면 포트 충돌,
프로세스 종료, 런타임 설치, 로그 관리 문제가 다시 생기기 때문이다.

## 질문에 대한 설계 결정

### 파일 읽기·쓰기는 공용 API이고 편집 로직은 각 모듈에 두는가?

그렇다.

- Maek 책임: 파일 접근 권한, 경로 안전성, 크기 제한, ETag 버전, 충돌 거부, 백업,
  원자 교체에 가까운 transaction.
- 모듈 책임: 어떤 필드를 보여줄지, 입력 검증, 버튼 동작, 데이터 계산, 함께 저장할 파일,
  사용자 오류 문구.

루틴을 예로 들면 “격주 월요일인지 계산”, “정의를 Markdown으로 변환”, “기록 체크를
어떻게 갱신할지”는 루틴 HTML의 로직이다. Maek은 `routines.json`, `routine-log.json`,
`routines.md`라는 허용된 파일을 안전하게 보관한다.

### 중앙 등록이 꼭 필요한가?

일반 파일 편집 모듈에는 필요 없다. 폴더 옆 manifest가 자기 등록의 전부다. Maek 서버가
파일을 열 때 다음 순서로 자동 발견한다.

1. `<열려는 HTML>.maek.json`
2. 같은 폴더의 `maek.page.json`
3. 둘 다 없으면 기존 읽기 전용 HTML 미리보기

중앙에 페이지 ID, route, provider를 한 번 더 적지 않는다. manifest의 `entry`와 실제로
연 HTML이 일치해야 권한이 생기므로, 같은 폴더의 다른 HTML에 우연히 쓰기 권한이
부여되지 않는다.

중앙 확장이 필요한 예외는 파일 API로 표현할 수 없는 기능뿐이다. 예를 들어 비밀키 사용,
운영체제 명령 실행, 장시간 백그라운드 작업, 외부 서비스의 관리자 권한 호출이다. 이
경우에는 별도의 검토된 Maek 기능을 추가해야 하며, 임의의 workspace 코드를 서버에서
자동 실행하지 않는다.

## Manifest 규격

예시:

```json
{
  "schemaVersion": 1,
  "id": "tracker",
  "title": "습관 추적기",
  "entry": "index.html",
  "assetsRoot": ".",
  "resources": {
    "data": {
      "path": "data.json",
      "format": "json",
      "access": "read-write",
      "maxBytes": 1000000,
      "backup": { "keep": 20 }
    }
  }
}
```

- 모든 경로는 manifest가 있는 폴더 기준 상대 경로다.
- 절대 경로, `..`, 역슬래시, `.maek` 경로는 거부한다.
- `entry`는 `assetsRoot` 안에 있어야 한다.
- resource 이름은 브라우저가 쓰는 논리 이름이다. API 요청에 실제 파일 경로를 보내지
  않는다.
- `access`는 `read` 또는 `read-write`다.
- JSON과 text만 지원한다. 이 범위가 검증과 충돌 방지에 가장 단순하고 예측 가능하다.
- manifest는 정적 asset으로 내려주지 않는다.

같은 폴더에 독립된 HTML 앱이 여러 개라면 각 HTML 옆에
`<파일명>.maek.json`을 둔다. 앱 하나가 폴더 전체를 대표한다면 `maek.page.json`을 쓴다.

## 실행 구조

```text
127.0.0.1:<port>                    localhost:<같은 port>
Maek React UI                       Custom Page iframe
      |                                      |
      | POST /api/custom-pages/mount         |
      | entry + workspace id                 |
      |------------------------------------->|
      |      mountPath 또는 static           |
      |<-------------------------------------|
                                             | GET /_pages/<mount>/
                                             | GET .../_api/resources/data
                                             | PUT .../_api/resources/data
                                             | POST .../_api/transaction
                                             v
                                  Maek의 같은 Fastify 프로세스
                                             |
                                      workspace 직렬화 lock
                                             |
                             data 파일 + .maek 내부 자동 백업
```

프로세스와 포트는 하나지만 hostname은 나눈다. 앱 UI의 전체 API는 `127.0.0.1`에서만
쓰고, 실행되는 커스텀 페이지는 `localhost`의 자기 mount 아래 API만 쓴다. 따라서 페이지가
Maek의 일반 `/api`를 호출할 수 없다.

mount ID는 192-bit 난수이며 메모리에만 존재한다. 탭이 닫히거나 미리보기가 다시
만들어지면 mount를 해제하고, 서버가 재시작되면 모두 사라진다. workspace의 실제 경로는
페이지 URL에 포함하지 않는다.

## 공용 API

### 상태

```http
GET _api/health
```

응답:

```json
{ "ok": true, "apiVersion": 1, "pageId": "tracker", "writable": true }
```

### 파일 읽기

```http
GET _api/resources/data
```

JSON 또는 text 원문을 반환하고 `ETag` 헤더에 SHA-256 기반 버전을 넣는다.

### 파일 하나 저장

```http
PUT _api/resources/data
Content-Type: application/json

{
  "baseVersion": "\"sha256-...\"",
  "content": { "count": 2 }
}
```

### 여러 파일 묶음 저장

```http
POST _api/transaction
Content-Type: application/json

{
  "writes": [
    { "resource": "view", "baseVersion": "\"sha256-...\"", "content": "Count: 2\n" },
    { "resource": "data", "baseVersion": "\"sha256-...\"", "content": { "count": 2 } }
  ]
}
```

저장은 workspace lock 안에서 다음 순서로 처리한다.

1. 모든 resource가 manifest에 있고 쓰기 가능한지 확인한다.
2. 현재 파일 버전이 브라우저가 읽은 `baseVersion`과 모두 같은지 확인한다.
3. 형식과 최대 크기를 확인하고 임시 파일을 만든다.
4. 현재 원본을 `.maek/custom-page-backups/<page>/<resource>/`에 백업한다.
5. 요청 순서대로 원본과 임시 파일을 교체한다.
6. 중간 실패 시 이미 교체한 파일을 원본으로 되돌린다.
7. 새 버전들을 반환하고 Maek의 파일 인덱스를 갱신한다.

파일이 외부에서 바뀐 경우 `409 conflict`를 반환한다. 강제 덮어쓰기는 제공하지 않는다.
페이지는 새로 읽은 뒤 사용자가 변경을 다시 적용하게 해야 한다.

## 새 앱을 붙이는 과정

1. 독립 폴더에 HTML/JS/CSS와 데이터 파일을 만든다.
2. 앱의 계산·편집·검증 로직을 그 폴더의 JavaScript에 구현한다.
3. 같은 폴더에 `maek.page.json`을 만들고 실제로 필요한 resource만 선언한다.
4. 페이지 시작 시 resource를 읽고 받은 `ETag`를 기억한다.
5. 저장할 때 내용과 `baseVersion`을 공용 API에 보낸다. 파생 파일까지 함께 바꾸면
   transaction을 쓴다.
6. Maek에서 HTML을 연다. 중앙 registry나 새 Fastify route는 추가하지 않는다.
7. 저장 후 파일 내용, 백업, 새로고침, 외부 변경 후 409 충돌을 확인한다.

최소 클라이언트 코드는 다음과 같다.

```js
const response = await fetch("_api/resources/data");
let version = response.headers.get("ETag");
let data = await response.json();

async function save() {
  const response = await fetch("_api/resources/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseVersion: version, content: data }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  version = result.versions.data;
}
```

이 과정에서 각 앱은 폴더째 복사하거나 제거할 수 있는 독립 모듈이다. 하지만 파일 권한,
오류 형식, 백업 위치, 충돌 정책, API 이름은 모두 Maek이 정하므로 시스템 전체 사용법은
일관된다.

## 현재 루틴 대시보드 이관

루틴 폴더에는 다음 manifest를 둔다.

```text
005_Routines/
├── 루틴-대쉬보드.html
├── maek.page.json
└── routine-workflow/
    ├── routines.json       definition resource
    ├── routine-log.json    log resource
    └── routines.md         markdown resource
```

루틴 HTML은 실행 위치를 보고 두 모드를 지원한다.

- Maek `/_pages/` 아래: 공용 resource/transaction API를 사용한다. 별도 서버가 필요 없다.
- 기존 `serve.py`: 전환 기간 동안 기존 API를 그대로 사용한다.

루틴 고유 로직은 중앙 provider로 옮기지 않았다.

- 정의 편집 검증은 기존 HTML의 `validate()`를 사용한다.
- 정의와 파생 `routines.md`는 한 transaction으로 저장한다.
- 기록 토글은 HTML이 해당 날짜 record를 계산해 `routine-log.json`을 저장한다.
- 미래 날짜는 `Asia/Seoul` 기준으로 거부한다.
- 세 파일 모두 버전 충돌과 20개 백업 정책을 공용 Host에서 적용한다.

실제 HTML 파일명은 `루틴-대쉬보드.html`이므로, 이전에 공백 이름을 가리키던 legacy
스크립트와 문서도 이 이름으로 맞춘다. `serve.py`와 `.command`는 즉시 삭제하지 않는다.
Maek을 쓰지 않는 경우의 fallback과 롤백 수단으로 남긴다.

## 구현 파일과 책임

| 파일 | 책임 |
|---|---|
| `shared/custom-page.ts` | manifest와 API 응답 type/schema |
| `server/custom-pages/index.ts` | 자동 발견, mount, 정적 파일, 공용 resource/transaction API |
| `server/host.ts` | 공용 Host를 기존 Fastify와 workspace lock에 연결 |
| `client/src/features/editor/components/FilePane.tsx` | HTML을 열 때 mount 요청, iframe, 해제, 재시도 |
| `client/src/host.ts` | 격리된 `localhost` page URL 생성 |
| `vite.config.ts` | 개발 모드의 `/_pages` proxy |

규모가 커지면 `server/custom-pages/index.ts`를 mount manager, document store, static host로
나눌 수 있다. 외부 API는 그대로 유지하므로 앱은 영향을 받지 않는다.

## 실제 구현 계획과 상태

### Phase 1 — 공용 Runtime 기반: 완료

- [x] module-local manifest schema와 자동 발견
- [x] 기존 HTML의 정적 미리보기 fallback 유지
- [x] 격리된 mount URL과 manifest/`.maek` 차단
- [x] JSON/text 읽기, 쓰기, ETag 충돌, 크기 제한
- [x] 여러 파일 transaction, rollback, backup retention
- [x] iframe mount lifecycle과 오류 재시도 UI
- [x] 개발 Vite proxy
- [x] Fastify 통합 테스트와 실제 브라우저 E2E fixture

### Phase 2 — 루틴 선통합: 완료

- [x] `maek.page.json` 작성
- [x] 정의, 기록, Markdown resource 선언
- [x] 루틴 HTML에 Maek 공용 API adapter 추가
- [x] 정의 + Markdown 묶음 저장
- [x] 기록 토글 저장과 서울 시간 미래 날짜 방지
- [x] legacy 파일명 불일치 정리
- [x] 기존 전용 서버 fallback 유지

### Phase 3 — 작성 경험 개선: 후속

- [ ] 공용 API를 감싼 작은 `maek-page.js` SDK 제공
- [ ] “이 폴더를 Custom Page로 만들기” manifest 생성 UI
- [ ] iframe의 `ready`, `dirty`, `error` 상태를 Maek에 전달하는 선택적 SDK
- [ ] 열린 custom page를 외부 브라우저에서도 같은 mount로 여는 도구 모음 개선
- [ ] transaction 중 프로세스 자체가 종료된 경우를 위한 journal/recovery 검토

Phase 3는 새 앱 작성 시간을 줄이는 개선이며 현재 파일 기반 앱을 붙이는 데 필수는 아니다.

## 테스트와 완료 기준

자동 검증:

```text
npm run typecheck
npm test
npm run build
npm run test:e2e
```

핵심 수용 기준:

1. manifest 없는 HTML은 기존 정적 미리보기로 열린다.
2. manifest가 있는 HTML은 별도 서버 없이 선언한 파일을 읽고 쓴다.
3. 선언하지 않은 resource, `.maek`, workspace 밖 symlink, 일반 Maek `/api`에 접근할 수
   없다.
4. 외부에서 파일이 바뀌면 오래된 페이지의 저장은 `409`로 거부된다.
5. 저장 전 원본 백업이 보관되고 보관 개수를 넘으면 오래된 것부터 지운다.
6. 여러 파일 저장 중 실패하면 이미 교체된 파일을 되돌린다.
7. 루틴 정의 저장은 `routines.json`과 `routines.md`를 함께 갱신한다.
8. 루틴 기록 토글은 새로고침 후에도 남고 미래 날짜는 거부된다.
9. 개발 모드와 빌드 후 실행에서 같은 흐름이 작동한다.

## 확장 판단 기준

```text
정적 HTML인가?
  └─ 예: 기존 HTML preview

JSON/text 파일 편집인가?
  └─ 예: 폴더에 manifest만 추가 (중앙 등록 없음)

여러 파일을 같이 바꾸는가?
  └─ 예: 공용 transaction 사용 (중앙 등록 없음)

비밀키·OS 명령·백그라운드 작업이 필요한가?
  └─ 예: 별도의 검토된 Maek 기능 설계
```

핵심 원칙은 “페이지 수만큼 서버와 전역 route를 늘리지 않는다”와 “앱 로직은 모듈에,
파일 안전성은 Maek에”다.
