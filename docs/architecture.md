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

## State ownership

- TanStack Query: 서버에서 읽은 파일 snapshot과 요청 중복 제거
- Zustand: UI 세션, 열린 탭과 Tiptap 편집 초안
- `.maek/tabs.json`: 열린 탭 목록과 순서의 단일 원본
- `.maek/sessions/web/<browser-session-id>/ui.json`: 브라우저별 UI 상태
- `.maek/recentFiles.json`: 앱과 웹이 공유하는 최근 파일·열람 횟수
- `.maek/assets/`: 붙여넣거나 가져온 이미지

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
