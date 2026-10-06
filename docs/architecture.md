# Architecture

maek은 브라우저 UI와 로컬 파일 시스템 코어로 구성된 macOS용 Markdown
workspace입니다. 실제 파일이 유일한 원본이며 인덱스와 UI 상태는 다시 만들 수 있는
파생 데이터로 취급합니다.

## Runtime

개발 환경에서는 Vite가 UI 변환과 HMR을 담당하고 Local Core로 `/api`를 프록시합니다.
Local Core는 Fastify API, macOS 네이티브 작업, workspace 인덱스, 파일 감시와
메타데이터를 담당합니다. 프로덕션에서는 Local Core가 빌드된 UI와 API를 같은
origin에서 제공합니다.

하나의 정규화된 workspace root는 하나의 `WorkspaceRuntime`에 대응합니다. 런타임은
`WorkspaceFileIndex`와 `WorkspaceWatchHub`를 하나씩 소유하며 여러 SSE 연결이 같은
OS watcher를 공유합니다. 이벤트 재생이 불가능하면 클라이언트는 전체 트리 snapshot으로
상태를 다시 맞춥니다.

탐색 트리와 DB manifest 발견은 같은 파일 인덱스와 제외 규칙을 사용합니다. 초기 발견과
명시적인 복구 시에는 workspace를 순회하고, 이후 경로 추가·삭제·이동은 인덱스에
증분 반영합니다. 파일 내용 변경은 경로 인덱스를 무효화하지 않습니다. 내부 인덱스의
`.maek-database.json`은 DB 발견에 사용하되 탐색기 snapshot에서는 숨깁니다.

SSE는 변경 순서를 유지한 채 최대 50ms 또는 512건 단위로 전달합니다. 같은 경로의
반복 내용 변경만 합치고, 삭제·재생성·이동 순서는 보존합니다. 느린 연결의 버퍼가
256KiB를 넘으면 연결을 종료해 재연결과 snapshot 복구를 사용합니다. HTTP 요청과 SSE
구독이 끝난 뒤 60초 동안 사용자가 없는 런타임은 watcher, 인덱스, SQLite 연결을 회수합니다.

## State ownership

- TanStack Query: 서버에서 읽은 파일·DB 등록 목록·DB 행 snapshot과 요청 중복 제거
- Zustand: UI 세션, 열린 탭과 Tiptap 편집 초안
- `.maek/tabs.json`: 열린 탭 목록과 순서의 단일 원본
- `.maek/sessions/web/<browser-session-id>/ui.json`: 브라우저별 UI 상태
- `.maek/sessions/web/<browser-profile-id>/editor.json`: workspace별 헤더 접힘 상태.
  프로필 ID는 localStorage에 보존하며 같은 프로필의 창은 BroadcastChannel로 공유합니다.
- `.maek/recentFiles.json`: 앱과 웹이 공유하는 최근 파일·열람 횟수
- `.maek/assets/`: 붙여넣거나 가져온 이미지

파일 변경은 도메인별 영향 범위를 판정합니다. 탐색기는 구조 변경만 묶어서 반영하고,
DB 등록 목록은 manifest·등록된 폴더 이동/삭제·외부 SQLite 변경으로 갱신합니다.
DB 행은 해당 DB의 직접 하위 Markdown 변경으로 갱신합니다. DB 기능이 이 판정과
Query 갱신을 소유하며, 각 화면이 별도로 workspace 전체 재검색을 요청하지 않습니다.
목록 갱신은 100ms, 행 갱신은 150ms의 고정 구간을 사용해 연속 변경 중에도 진행됩니다.

복원된 파일 미리보기는 처음 선택될 때 생성합니다. 한번 방문한 HTML/PDF/CSV 등은
열린 탭의 상태를 유지하되, HTML에 활성 상태를 전달해 비활성 상태의 반복 작업을
줄입니다. 파일 트리는 기존 노드와 영향받지 않은 가지의 참조를 유지하고, UI 구독은
각 화면에서 사용하는 상태로 제한합니다. 파일 선택창은 전체 검색 결과를 유지하되
화면 주변의 행만 렌더링하며 스크롤과 키보드 선택으로 모든 결과에 접근할 수 있습니다.

## Data invariants

- 모든 파일 API 경로는 workspace-relative이며 realpath containment 검사를 통과해야 합니다.
- 저장은 기존 hash와 mtime을 모두 확인하고 임시 파일을 원자적으로 교체합니다.
- 충돌한 외부 변경을 자동으로 덮어쓰지 않습니다.
- 일반 `notes`, `history` 폴더를 앱 데이터로 간주하거나 자동 삭제하지 않습니다.
- 앱 메타데이터와 의존성·빌드 캐시는 탐색 트리에 표시하지 않습니다.
- 동일한 workspace를 보는 클라이언트는 하나의 파일 감시 런타임을 공유합니다.

## Feature ownership

Maek is organized by product feature. A feature owns its UI, state, domain logic,
and feature-specific helpers; it exposes only the small public API in its
`index.ts`.

## Client

- `client/src/app`: application assembly, providers, and startup only.
- `client/src/features/<feature>`: independently understandable product areas.
  Current areas include `workspace`, `editor`, `explorer`, `database`,
  `custom-page`, `spreadsheet`, `search`, and `settings`.
- `client/src/shared`: reusable UI, API transport, hooks, design tokens, and
  utilities. Shared code must not depend on `app` or a feature.

Use `@renderer/features/<feature>` when one feature needs another feature's
public capability. Do not import another feature's internal file. `app` may
compose feature public APIs. A new custom page is manifest-discovered and uses
the shared custom-page/file APIs; it does not require a separate server or a
central registration list.

## Server

- `server/app`: Fastify composition and HTTP application bootstrap.
- `server/features`: domain services and routes, such as database and custom
  pages.
- `server/core`: infrastructure that is safe to share everywhere, including
  filesystem guards and RPC errors.
- `server/workspace` and `server/metadata`: established workspace domain
  services, retained as cohesive feature namespaces during the gradual move.

The HTTP contract in `shared/` is the boundary between client and server.
Feature code may depend on `core`; `core` must never depend on a feature.

## Change rules

1. Add new product code inside the owning feature first.
2. Put genuinely cross-feature code in `shared` (client) or `core` (server).
3. Export only intentional public APIs from a feature `index.ts`.
4. Run `npm run check` before handing off. It runs TypeScript and the lightweight
   feature-boundary checker.
5. Keep compatibility re-exports only while migrating callers, then remove
   them in the same change or a tracked follow-up.

DB 및 대시보드의 공유 저장·호환성·검증은
[원본 이식 문서](database-desktop-parity.md)에 정리합니다. module-local manifest 기반
HTML 페이지의 데이터 API와 확장 방식은
[Custom Page Runtime 설계와 구현 계획](custom-page-runtime-design.md)에 정리합니다.
