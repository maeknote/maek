# Maek Note 디자인 이식

기준: maeknote-app a9786d6. 현재 사용하는 CSS 토큰과 공통 컴포넌트는
`client/src/shared/design/css`, `client/src/shared/components`에 있습니다.
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

런타임과 데이터 보존 규칙은 [아키텍처 문서](architecture.md)를 참고하세요.

## 멀티뷰 탭

기억할 문장: **두 문서를 붙여 둔 작업 공간이 탭 하나처럼 계속 살아 있다.**

### 제품 모델

Open Tabs의 한 항목은 더 이상 항상 파일 하나를 뜻하지 않는다. 한 항목은
사용자가 다시 돌아올 수 있는 `view group`이며, 다음 두 형태를 같은 계층에서
다룬다.

- `single`: 파일 또는 가상 뷰 하나
- `split`: 좌우 파일, 활성 pane, 분할 비율을 함께 보존하는 두-pane 작업 공간

파일 데이터와 view group을 분리한다. 열린 파일은 기존 `tabs`와
`.maek/tabs.json`의 호환 모델을 유지하고, view group의 순서·활성 항목·분할
구성은 브라우저별 `ui.json`에 저장한다. 따라서 다른 브라우저나 원본 데스크톱
앱의 탭 목록을 덮어쓰지 않는다.

```ts
type ViewGroup =
  | { id: string; kind: "single"; tabId: string }
  | {
      id: string;
      kind: "split";
      left: string;
      right: string;
      active: "left" | "right";
      ratio: number;
    };
```

첫 버전은 가로 2분할만 지원한다. 데이터베이스, Kanban, Workspace Settings 같은
비파일 surface는 single group으로만 연다.

### Open Tabs 표현

single group은 현재 28px 탭 행을 그대로 사용한다. split group도 같은 높이와
선택 배경을 유지하되 `Columns2` 아이콘과 좌우로 나뉜 이름을 표시한다.

```text
  README.md                            ×
▥ Plan.md  |  Research.pdf            ×
  Database                              ×
```

- split 행 전체가 하나의 `role="tab"`이며 `aria-label`은
  `Split view: Plan.md and Research.pdf` 형식을 사용한다.
- 선택 상태는 행 전체에 `maek-red` 10% 배경을 준다. 마지막 활성 pane의 이름만
  `maek-red`로 표시해 복원될 포커스를 예고한다.
- 폭이 부족하면 활성 파일명을 남기고 다른 쪽을 `+1`로 줄인다. hover/focus
  tooltip에는 두 전체 경로와 현재 분할 비율을 보여 준다.
- 닫기 버튼, middle-click, 드래그 정렬은 group 전체에 적용한다. split group은
  Open Tabs에서 언제나 한 개의 정렬 단위다.
- 아이콘만으로 상태를 전달하지 않는다. 두 이름 사이의 세로 divider와
  `Split view: …` 접근성 이름을 함께 사용한다.

### 전환과 편집 규칙

- single group에서 `Open file to the side`를 실행하면 그 group 자체가 split으로
  바뀐다. 새 Open Tabs 행을 만들지 않는다.
- 다른 Open Tabs 항목을 선택하면 현재 group의 좌우 파일, 비율, 활성 pane을
  변경하지 않고 숨긴다. split group으로 돌아오면 네 값을 그대로 복원한다.
- 숨겨진 group에 이미 포함된 파일을 Files나 검색에서 열면 파일을 빼앗거나
  중복 생성하지 않고 그 group과 해당 pane을 활성화한다.
- split 화면에서 다른 pane을 누르면 group의 `active`만 바뀐다. Open Tabs의
  선택 행은 그대로다.
- `Single pane`은 파괴적 축소가 아니라 `Ungroup`으로 동작한다. 두 파일을 같은
  위치의 연속된 single group으로 되돌리고 선택한 pane의 파일을 활성화한다.
- group 닫기는 두 파일을 한 번에 닫는 동작이다. 저장 충돌이나 실패가 하나라도
  있으면 어느 파일도 group에서 제거하지 않는다. 한 pane만 떼거나 닫는 동작은
  pane 헤더의 context action으로 제공한다.
- `Cmd+W`는 활성 group을 닫는다. split group도 사용자에게는 탭 하나이므로 두
  파일을 대상으로 한다.

### 복원과 호환

- `activeViewGroupId`와 `viewGroups`를 브라우저별 `ui.json`에 저장한다.
  `.maek/tabs.json`에는 group 정보를 새로 쓰지 않고 열린 파일의 기존 순서와
  메타데이터를 보존한다.
- 기존 `ui.split`이 있으면 첫 실행에서 해당 좌우 파일을 split group 하나로
  옮기고 나머지 파일을 single group으로 만든다. 마이그레이션 결과는 다음
  `ui.json` 저장부터 기록한다.
- 복원 중 한 파일이 사라졌다면 split group을 남은 파일의 single group으로
  안전하게 축소한다. 둘 다 사라졌을 때만 group을 제거한다.
- 이름 변경과 폴더 이동은 현재 탭 remap과 같은 규칙으로 모든 group 참조를
  함께 갱신한다.
- PDF, HTML, CSV, text/image의 런타임 view cache와 Markdown scroll position은
  현재 방식을 유지한다. view group은 layout 기억을 추가할 뿐, 파일 view를
  불필요하게 재생성하지 않는다.

### 시각 및 동작 기준

- 기존 warm vellum, neutral ink, Maek red 토큰과 글꼴을 유지한다. 새 색이나 새
  장식은 도입하지 않는다.
- group 전환은 120ms opacity 전환만 허용한다. pane이 미끄러지거나 재배치되는
  애니메이션은 공간 기억을 흐리므로 사용하지 않는다.
- split ratio는 기존 25–75% 제한과 2% 키보드 step을 유지한다.
- 선택한 group, 활성 pane, 포커스 링은 각각 구분되어야 하며 색만으로 상태를
  전달하지 않는다.

### 의도한 위험

split을 파일 두 개가 아니라 하나의 작업 탭으로 취급하면 사용자의 공간 기억은
강해지지만, `Close`와 `Cmd+W`의 영향 범위가 두 파일로 넓어진다. 이를 숨기지
않고 split 아이콘, 이중 이름, group 단위 hover를 일관되게 사용한다. 반대로
전역 split을 유지하고 Open Tabs에 badge만 더하는 방식은 구현은 작지만 탭을
오갈 때 구성이 덮어써져 이 기능의 핵심 약속을 지키지 못하므로 사용하지 않는다.
