# 워크스페이스 시작 멈춤: 원인과 개선 계획

작성: 2026-09-09 · 기준 커밋: `acaf782`
상태: 원인 재현 및 개선 후보 검증 완료. 앱의 버그 수정은 미적용. 임시 진단 로그 제거 완료.

## 확정한 원인

워크스페이스의 **FIFO(named pipe)를 일반 파일처럼 감시하려는 동작**이
macOS에서 Node 메인 스레드를 동기적으로 막는다.
트리 스캐너는 일반 파일/디렉터리만 취급하지만 watcher의 필터는 경로 이름만 검사한다.
이 불일치로 스캐너가 제외한 FIFO가 watcher에는 들어간다.

`WorkspaceRuntime` 생성자가 watcher를 즉시 구독하고, 구독은 파일 감시를 시작한다.
따라서 첫 `GET /api/tree`에서 이 문제가 발생한다.
메인 스레드가 정지하면 다른 HTTP 요청, JS 타이머, 종료 신호 처리까지 진행하지 못한다.
클라이언트는 트리/세션 요청의 `Promise.all`을 기다리며 `restoring=true`로 남는다.
이때 시작 화면은 `Opening…`이며 폴더 선택 버튼도 비활성화되어 있다.

이번 재현에서 네이티브 폴더 선택 요청은 없었다.
저장 경로 복원 또는 직접 경로 열기가 성공한 뒤 초기 감시 등록에서 멈춘 것이다.
기존의 “Finder 창이 뒤에 숨었다”, “전체 스캔이 단순히 오래 걸린다”는 가설은
이번 멈춤을 설명하는 직접 원인으로 채택하지 않는다.

## 증거

### 사용자 로그의 타임라인

| 시각 (UTC) | 관찰 |
| --- | --- |
| 10:13:51.331 | Core 시작: PID 98121, Node v24.3.0, macOS, Ghostty, SSH 아님 |
| 10:14:02.402 | `POST /api/workspaces/open` 수신 |
| 10:14:02.408 | 경로 등록 완료: 1ms |
| 10:14:02.410 | 메타데이터 준비 완료: 2ms |
| 10:14:02.411 | `/open` 200 응답 완료: 총 10ms |
| 10:14:02.417 | `tree.snapshot.start` |
| 10:14:02.418–419 | tabs/recent-files 요청 수신, 첨부 범위에 완료 기록 없음 |

첨부 로그 자체는 마지막 요청 수신에서 끝나므로 이 자료만으로 장기 정지를 확정하지 않았다.
아래 실시간 확인과 별도 재현으로 원인을 좁혔다.

### 실행 중인 Core 확인

로그에 나온 PID 98121이 그대로 실행 중이었고 3000/3001 모두 리스닝하고 있었다.
파일 처리가 없는 존재하지 않는 API 경로에도 3초 안에 응답하지 못했다.
19:15:44 KST부터 약 2초간 수집한 182회 샘플에서 메인 스레드가 모두 같은 위치였다.

```text
fs 통계 결과 → Promise callback
  → FSEventWrap::Start
  → uv_fs_event_start
  → open
  → __open                 ← 182/182 샘플
```

이는 CPU를 계속 쓰는 대형 정렬이나 단순 async 파일 읽기 대기와 다른 증거다.
5초 후 대기 로그를 찍도록 했어도 메인 스레드가 막히면 타이머 콜백 자체를 실행할 수 없다.

libuv의 macOS/kqueue 구현에도 감시 등록 과정의 동기 `open(path, O_RDONLY)`가 보인다.
이 공개 소스는 구현 설명의 참고이며, 실행 버전의 동작은 위 스택과 아래 재현으로 확인했다.
[libuv kqueue 구현](https://github.com/libuv/libuv/blob/v1.x/src/unix/kqueue.c#L570).

### 실제 워크스페이스의 파일 유형

Core가 감시 중인 `/Users/yoonchul/life-os`를 파일 내용 없이 디렉터리 엔트리만 조사했다.
현재 앱의 제외 규칙 적용 후 406개 디렉터리, 2,815개 일반 파일, FIFO 2개가 확인됐다.

두 FIFO는 시스템프로그래밍 과제의 다음 위치에 있다
(표시용 경로의 한글은 실제 파일시스템에서 분해형 Unicode일 수 있다).

- `400_Archives/403_SNU/26-1/시스템프로그래밍/HW/lab2/lab-2-input-and-output/tools/test3/subdir1/pipe`
- `400_Archives/403_SNU/26-1/시스템프로그래밍/HW/lab2/lab-2-input-and-output/tools/demo/subdir3/pipe`

두 FIFO 중 당시 커널 open에 전달된 정확한 하나의 경로는 스택 샘플에 포함되지 않았다.
그러나 두 개 모두 현재 감시 대상이며, 아래 최소 재현과 실제 workspace 대조에서
동일한 원인과 수정 조건을 확인했다. 사용자 FIFO를 열어 데이터를 읽거나 쓰거나 삭제하지 않았다.

### 최소 재현과 개선 후보 대조

Node v24.3.0 / libuv 1.51.0 / 프로젝트의 Chokidar 5.0.0으로
임시 폴더에 FIFO 하나를 만들고 동일한 감시 옵션을 사용했다.

| 조건 | 관찰 |
| --- | --- |
| 기존 경로 필터 | START 이후 ready와 250ms 타이머 모두 실행되지 않음. 부모 프로세스가 2초 후 테스트 자식만 종료 |
| 경로 필터 + 일반 파일/디렉터리만 허용 | READY와 TIMER 실행, 오류 없이 exit 0 |
| 같은 필터로 실제 life-os를 읽기 전용 감시 | 449ms에 감시 초기화 및 종료 완료, add 2,814개, 오류 0, 타이머 정상 |

마지막 측정은 watcher의 초기화/종료 시간이다. 앱 전체 시작 시간이나 tree 응답 시간은 아니다.
디렉터리 조사와 watcher는 서로 다른 시점에 실행했으므로 파일 개수 차이 1은
이 진단만으로 특정 파일 누락이라고 판정하지 않는다.
샌드박스 안의 첫 비교에서는 별도 EMFILE 오류가 있어, OS 감시가 허용된 환경에서
위 비교를 다시 실행하고 오류 없는 결과를 확인했다.

## 코드상의 결함 위치

- `server/workspace/watch-hub.ts:80`: Chokidar ignored callback이 stats를 받지 않고
  경로 이름만 검사한다.
- `server/workspace/filesystem.ts:91` 부근: 스캐너는 `isDirectory()/isFile()`로
  FIFO·소켓 등의 특수 파일을 이미 제외한다.
- 설치된 `node_modules/chokidar/handler.js`의 `_addToNodeFs`: 디렉터리와
  심볼릭 링크가 아닌 엔트리를 파일 처리 경로로 보내며, 앱의 stats 필터가 없으면
  FIFO도 `fs.watch`에 도달한다.
- `server/workspace/runtime-manager.ts:13`: runtime 생성과 동시에 watcher를 시작한다.
- `client/src/store.ts:225`: tree/tabs/recents가 모두 끝나야 다음 단계로 간다.
  시작 실패/지연 동안 다른 workspace 열기도 같은 restoring 플래그로 막힌다.

Chokidar는 ignored 필터에 경로와 사용 가능한 stats를 전달하는 인터페이스를 제공한다.
[Chokidar 공식 설명](https://github.com/paulmillr/chokidar#api).

## 구현 계획

### 1. 직접 원인 수정 — 최우선

watcher의 ignored callback이 stats도 사용하게 한다.
기존 경로 제외 규칙을 유지하고, stats가 있는 엔트리는 일반 파일 또는 디렉터리만 허용한다.
FIFO, 소켓, 장치 파일 및 현재 정책상 미지원 심볼릭 링크는 감시에서 제외한다.

```ts
ignored: (absolutePath, stats) =>
  isIgnored(relativePath) ||
  (stats !== undefined && !stats.isFile() && !stats.isDirectory())
```

위는 설계 예시이며 아직 앱에 적용하지 않았다.
stats가 없는 초기 검사에서는 경로 규칙만 적용해야 한다.
정보가 없다는 이유로 전부 제외하면 정상 디렉터리 탐색도 막힌다.
검사 조건을 scanner와 watcher에서 공유할 수 있는 작은 파일 유형 정책으로 정리한다.
삭제 이벤트는 stats가 없을 수 있으므로 이벤트 처리에서도 이를 일괄 폐기하지 않는다.

워크스페이스의 FIFO를 삭제하거나 과제 폴더 전체를 제외하는 우회는 필요하지 않다.
폴링 전환, Finder/AppleScript 교체, 라이브러리 다운그레이드를 이번 수정에 포함하지 않는다.

### 2. 회귀 테스트 — 수정과 같은 단위로 수행

- macOS 임시 workspace에 일반 Markdown, 하위 폴더, FIFO를 함께 만든다.
- 초기 감시뿐 아니라 ready 이후 FIFO 추가도 검사한다.
- watcher ready, HTTP 응답 및 타이머가 제한 시간 안에 진행되어야 한다.
- FIFO는 tree/파일 이벤트 대상에서 제외되고 일반 노트 수정·추가·이름 변경·삭제는 유지되어야 한다.
- socket/심볼릭 링크와 stats 없음 조건은 필터 단위 테스트로 확인한다.
- 실제 멈춤 테스트는 별도 자식 프로세스에서 실행한다. 부모가 외부 deadline으로 종료해야
  잘못된 구현이 테스트 실행기 전체를 멈추지 않는다. 같은 프로세스의 test timeout은 충분하지 않다.
- 실제 macOS 통합 테스트에서 OS 감시 권한 문제와 앱 오류를 구분해 보고한다.

### 3. 시작 화면 복구 — 직접 원인 수정 후 별도 단위

폴더 선택/경로 등록/인덱싱/탭 복원을 별도 상태로 표시한다.
workspace 등록 성공 후에는 선택 화면 대신 대상 폴더와 콘텐츠 준비 상태를 보여 준다.
취소·다른 경로 선택을 제공하고, 작업 세대로 이전 요청의 늦은 응답을 무시한다.
자동 복원과 수동 선택을 구분하며 기존 미저장 탭·세션을 유지한다.

클라이언트 요청 기한은 UI 복구에는 도움이 되지만 서버의 동기 native 호출 정지를
해결하지 못한다. 서버 내부 setTimeout만 추가하는 수정도 이번 원인에는 효과가 없다.

### 4. 감시 격리 — 후속 구조 개선

watcher를 별도 프로세스로 분리하면 감시기의 native 호출이 멈춰도 Core HTTP를 유지할 수 있다.
Core가 heartbeat와 종료 유예를 관리하고, 실패 시 “실시간 감시 중단” 상태와 수동 새로고침을 제공한다.
정규화된 workspace root마다 watcher 하나라는 기존 규칙을 유지한다.
프로세스 재시작 시 이벤트 세대/전체 snapshot으로 일관성을 복구한다.

이 격리는 방어층이다. FIFO를 안전한 감시 대상으로 만드는 것은 아니므로 1번 필터가 선행한다.
현재 확인된 버그는 작은 필터 수정으로 먼저 해결할 수 있어 IPC 리팩터링을 선행하지 않는다.

## 완료 기준과 범위

구현 시 `npm run typecheck`, `npm test`, `npm run build`,
`npm run test:e2e` 및 위 실제 FIFO 회귀 검증을 수행한다.
마지막 workspace 자동 복원과 처음 선택한 workspace 열기를 각각 검증한다.
사용자 파일/메타데이터 포맷 변경 없이 정상 노트 감시가 유지되어야 한다.

이번 요청에서는 원인 분석, 계획 갱신, 이전에 추가한 진단 코드 제거까지만 수행한다.
`server/diagnostics.ts`와 server/client의 임시 로그·타이머·리스너를 제거했다.
원래 있던 Finder 활성화 미커밋 변경은 보존했다.
이전 계획의 광범위한 native picker 교체는 이번 원인의 해결 계획에서 제외했다.

제거 후 검증: 타입 검사, 단위/통합 테스트 62개, 빌드, E2E 9개 모두 통과했다.
기존 세 소스 파일은 HEAD와 일치하고 picker는 진단 추가 전 Finder 변경과 정확히
일치하는 것도 확인했다. 이 결과는 로그 제거 검증이며 FIFO 수정 완료를 뜻하지 않는다.

앱의 FIFO 필터 수정은 아직 적용하지 않았다. 실시간 분석 대상이었던 기존 Core는
메인 스레드가 막혀 종료 신호를 처리하지 못할 수 있어, 소스의 로그 제거와 현재
실행 중인 프로세스의 복구는 별개다.
