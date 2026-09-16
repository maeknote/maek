# maek

macOS localhost에서 실행하는 개인용 Markdown Workspace 앱입니다.
Maek Note의 디자인 컴포넌트, Tiptap 에디터 확장과 react-arborist 트리를 이식했습니다.

## 실행

Node.js 22.12+ 또는 24+에서 실행합니다.

```sh
npm install
npm run dev
```

http://127.0.0.1:3000 에서 Open Folder로 기존 폴더를 선택합니다.
`npm run dev`는 UI/HMR(:3000)과 Local Core(:3001)를 독립 프로세스로
실행합니다. 일반 사용은 `npm run build && npm start`로 실행하며, 이때는
Local Core 하나가 빌드된 UI와 파일 API를 함께 제공합니다.

### Desktop 아이콘 (macOS)

빌드 후 아래 명령을 한 번 실행하면 Desktop에 `Maek.app`이 생깁니다.
아이콘을 클릭하면 `npm start`로 서버를 실행하고 브라우저를 엽니다. 이미 실행 중이면
새 서버를 만들지 않고 기존 창을 엽니다.

```sh
npm run build
npm run install:desktop
```

앱 안에서는 Settings(⌘,) → **Quit server**로 로컬 서버를 종료할 수 있습니다.
프로젝트 폴더를 다른 곳으로 옮긴 경우에는 `npm run install:desktop`을 다시 실행하세요.

네이티브 창을 사용할 수 없으면 Enter folder path에 절대 경로를 입력합니다.
설정 또는 사이드바 폴더 메뉴에서 Workspace를 바꿀 수 있습니다.
다음 실행 시 마지막 Workspace와 탭을 복원합니다.

## 파일과 메타데이터

```text
선택한 Workspace/
  기존 노트.md
  내 폴더/중첩 노트.md
  .maek/
    config.json
    tabs.json
    assets/붙여넣은 이미지.png
    sessions/web/<브라우저 세션>/ui.json
    sessions/web/<브라우저 세션>/recentFiles.json
```

실제 파일 이름과 위치를 유지합니다. `.maek-data`, `notes/`, `history/`,
`databases.json`을 자동 생성하지 않습니다. 열린 탭 목록과 순서는 workspace 루트의
`.maek/tabs.json`(원본 앱 version 4 형식)을 단일 원본으로 공유하며, 데스크톱 앱이
파일을 바꾸면 웹에도 실시간 반영합니다. 웹은 파일·데이터베이스·워크스페이스 설정 탭을 관리하고
원본 전용 탭·그룹·분할 정보와 알 수 없는 필드는 병합 저장으로 보존합니다. 테마·
사이드바 폭·펼침·스크롤·선택 탭 같은 표시 상태는 브라우저 세션별 `ui.json`에,
최근 파일은 앱과 공유하는 `.maek/recentFiles.json`에 열람 횟수와 함께 저장합니다. 원본 Maek Note의 version 4 탭 및
version 1 최근 파일 구조를 앱과 동일하게 읽고 씁니다. 기존 웹 세션별 최근 파일은 한 번 병합합니다. 브라우저
localStorage에는 마지막 경로와 표시용 최근 Workspace만 저장합니다. 일반 `notes`·
`history` 폴더는 사용자 파일로 취급하며 자동 삭제하지 않습니다.

편집 후 1.5초, 탭 전환, 창 포커스 해제, Cmd+S에 저장합니다. 파일 해시·수정 시각을
검사한 뒤 원자적으로 교체합니다. 외부 편집과 충돌하면 로컬 편집본을 유지하며
Reload, Save a copy, Close를 제공합니다. 저장되지 않은 편집본이 있으면 창 종료를 경고합니다.
원자적 교체 직전 외부 프로그램이 쓰는 극히 짧은 경합까지 OS 파일 잠금으로 차단하지는 않습니다.

## 기능

- 원본 Tiptap 표·코드·수식·체크리스트·제목 접기·슬래시 메뉴·선택 툴바
- YAML Frontmatter 원본/속성 편집, 내부 노트 링크, 이미지 삽입·붙여넣기
- 재귀 가상화 트리, 새 노트/폴더, 이름 변경, 드래그 이동, 복제, 복사/붙여넣기
- Finder 드롭 가져오기, Finder에서 보기, macOS 휴지통 이동
- 다중 탭, 탭 순서 이동, 빠른 파일 검색, 최근 파일, Workspace·스크롤·테마 복원
- 외부 파일 변경과 이름 변경 실시간 반영, 미저장 충돌 보호
- 이미지·PDF·텍스트 읽기 전용 미리보기, 주변 JS·CSS·JSON을 함께 읽는 sandboxed HTML 아티팩트, 미지원 형식의 기본 앱 열기
- HTML 아티팩트 새로고침과 브라우저 열기
- CSV 스프레드시트 편집: 가상화 표, 셀·행·열 편집, 범위 선택, Excel/Google Sheets 호환 복사·붙여넣기, undo/redo, 정렬·필터·찾기·선택 통계
- 앱과 공유하는 폴더 데이터베이스: 표·칸반·캘린더·타임라인 뷰, 이름 있는 뷰, 열 형식·집계, 다중 정렬·필터, 행·열·카드·기간 드래그 이동

CSV는 문자열 값만 저장하며 색상·셀 서식·수식 계산·다중 시트는 지원하지 않습니다.
UTF-8(BOM 포함) CSV를 최대 5 MiB, 50,000행, 200열, 500,000필드까지 편집합니다.
그보다 큰 CSV는 원문 보호를 위해 읽기 전용으로 엽니다. 데이터베이스는 앱과 동일하게
폴더의 `.maek-database.json`, Markdown frontmatter, 워크스페이스의 `.maek/database.sqlite`를 사용합니다.
회의, AI와 터미널은 미지원입니다. Markdown은 1 MiB 초과 시 읽기 전용, 텍스트는 32 MiB 초과 시 미지원으로 처리합니다. 심볼릭 링크와
원본의 의존성·빌드 캐시 폴더는 탐색 대상에서 제외됩니다.

## 단축키와 검증

Cmd+P/O 검색, Cmd+N 새 노트, Cmd+S 저장, Cmd+W 탭 닫기, Cmd+, 설정.
트리에서 Cmd+C/V 복사·붙여넣기, Cmd+D 복제, Cmd+Backspace 휴지통.
CSV 표에서는 Cmd+C/X/V 범위 복사·잘라내기·붙여넣기, Cmd+Z/Shift+Cmd+Z undo/redo를 사용합니다.

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

현재 런타임 경계와 데이터 보존 규칙은 [아키텍처 문서](docs/architecture.md)를 참고하세요.

데이터베이스·워크스페이스 설정의 원본 이식 범위와 저장 규칙은 [이식 문서](docs/database-desktop-parity.md)를 참고하세요.
