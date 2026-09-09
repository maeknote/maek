# Maek Note 디자인 이식

기준: maeknote-app a9786d6. 실제 원본 토큰과 공통 컴포넌트는
`client/src/shared/design`, `client/src/shared/components`에 있습니다.
`client/src/main.tsx`가 전역 CSS를 주입하고 Workspace store가 테마를 복원합니다.

원본 Button, FloatingMenu, MenuItem, Toast, FolderSelector, TitleBar,
FrontmatterPanel, BubbleToolbar, LinkHoverMenu, TableOverlay, HeadingRail,
코드·수식·이미지 NodeView 및 에디터 CSS를 사용합니다. 현재 호스트의 App/Explorer
연결부는 이 컴포넌트와 원본 레이아웃 클래스를 React/Fastify 상태에 연결합니다.
Tiptap, react-arborist, Zustand, Fuse와 Tailwind 의존성을 직접 사용합니다.

원본 `react-arborist+3.4.3.patch`는 postinstall에 적용합니다.
Electron IPC는 `client/src/host.ts`와 `server/host.ts`의 HTTP/SSE로 대체합니다.
색상 opacity는 원본 CSS 색 변수에 color-mix를 적용합니다.
패널 사이즈·메뉴 위치·트리 가상화 좌표 같은 동적 기하 값은 inline style로 유지합니다.

Workspace는 실제 폴더 전체를 스캔합니다. 파일은 기존 경로에서 편집하며
앱 메타데이터만 `.maek/`에 저장합니다. UI는 DB·회의·AI·터미널을 노출하지 않습니다.

[마스터 명세](v1/MASTER.md), [디자인 명세](v1/C2-design.md),
[검증 현황](v1/PROGRESS.md)을 참고하세요.
