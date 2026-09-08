# Maek Note 디자인 시스템 이식

원본: `/Users/yoonchul/dev/maeknote-app/src/renderer/shared/design` 및
`shared/components`, `features/explorer/components/FolderSelector.tsx`.

`client/src/design/css/variables.css`, `effects.css`, `tokens/`는 원본을 그대로
가져온 스냅샷입니다. 색·배경·다크 테마·폰트·반경·그림자·전환 효과의 기준입니다.
`system.css`는 원본 typography 값과 Tailwind 기본 간격 단위를 CSS 변수로 노출합니다.
앱 전용 상태색은 기존 의미 토큰에서 파생합니다.

Root의 `DesignProvider`가 전역 CSS와 테마 저장·복원을 담당합니다.
모든 활성 UI의 버튼은 공통 `Button`, 필드는 `Input`/`Select`/`Textarea`,
상단 바는 `Header`, 폴더 선택 트리거는 `FolderSelector`를 사용합니다.
Button의 variant/size, Header의 48px 높이, FolderSelector의 아이콘·배치를
원본에서 가져와 현재 React/Vite 환경의 CSS로 표현했습니다.
Electron alias, Tailwind 런타임 및 사용하지 않는 앱 기능은 의존하지 않습니다.
모달은 기존 Radix 포커스·Esc·스크린리더 동작에 원본 `glass-modal`을 적용합니다.
키보드 포커스는 Maek Red로 표시합니다.

`notes.css`에는 화면 레이아웃만 구성하며 색·폰트 크기·굵기·간격·반경·그림자는
전역 토큰을 참조합니다. `legacy/`는 실행되지 않는 보존본이므로 이식 대상이 아닙니다.
KaTeX 자체 CSS는 수식 렌더링 의존성으로 유지합니다.

## Workspace

최초 실행의 폴더 선택 버튼과 사이드바 폴더명 → 워크스페이스 설정에서 OS 네이티브
단일 폴더 선택을 실행합니다. macOS는 choose folder, Windows는 FolderBrowserDialog,
Linux는 zenity/kdialog를 사용합니다. 취소하면 기존 상태를 유지하며, 네이티브 창이
없는 환경에서는 절대 경로를 입력할 수 있습니다.

정규화된 경로를 `oh-my-maek:workspace`에 저장하고, 재실행 때 서버에 재등록해 새로운
프로세스에서도 열 수 있습니다. 저장소를 읽을 수 없는 경우 시작 화면에서 재선택합니다.
선택은 WorkspaceContext에 제공하고 각 API 요청에 해당 workspace ID를 지정합니다.
여러 탭이 서로 다른 폴더를 열어도 전역 서버 저장소를 바꾸지 않습니다.
폴더 변경 전에 편집본 저장이 성공해야 하며 복구 캐시는 폴더와 탭별로 분리됩니다.

`fs.watch`의 재귀 OS 이벤트를 SSE로 전달합니다. 각 연결은 선택한 루트만 감시하고,
150ms 단위로 이벤트를 합칩니다. 연결 종료·폴더 전환·서버 종료 때 리스너를 해제합니다.
클라이언트는 변경 또는 재연결 시 라이브러리를 다시 읽으며 미저장 편집본을 유지합니다.
기존 내용 해시 기반 409 충돌 방지가 그대로 적용됩니다.

데이터 형식은 기존 앱과 동일하게 선택한 폴더 아래 `notes/<uuid>.md`,
`databases.json`, `history/`입니다. 임의 이름의 기존 Markdown은 가져오기 기능으로
등록합니다. 워크스페이스 선택이 일반 파일 탐색기나 임의 Markdown 색인을 추가하지는 않습니다.
