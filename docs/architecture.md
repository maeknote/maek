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
- `.maek/sessions/web/<browser-session-id>/`: 브라우저별 탭과 최근 파일
- `.maek/assets/`: 붙여넣거나 가져온 이미지

구버전 `.maek/tabs.json`과 `.maek/recentFiles.json`은 마이그레이션 입력으로만 읽습니다.
웹 클라이언트는 데스크톱 세션 파일을 덮어쓰지 않습니다.

## Data invariants

- 모든 파일 API 경로는 workspace-relative이며 realpath containment 검사를 통과해야 합니다.
- 저장은 기존 hash와 mtime을 모두 확인하고 임시 파일을 원자적으로 교체합니다.
- 충돌한 외부 변경을 자동으로 덮어쓰지 않습니다.
- 일반 `notes`, `history` 폴더를 앱 데이터로 간주하거나 자동 삭제하지 않습니다.
- 앱 메타데이터와 의존성·빌드 캐시는 탐색 트리에 표시하지 않습니다.
- 동일한 workspace를 보는 클라이언트는 하나의 파일 감시 런타임을 공유합니다.

## Verification

변경 후 `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`를 실행합니다.
Finder 선택 창, 휴지통 이동과 기본 앱 열기는 실제 macOS 환경에서 별도로 확인합니다.
