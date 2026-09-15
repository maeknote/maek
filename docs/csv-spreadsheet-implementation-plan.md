# CSV 스프레드시트 구현 계획

상태: 구현 완료 (2026-09-15)
기술 선택: `react-data-grid` + `papaparse`
저장 포맷: CSV만 지원

구현 결과: CSV 파일 종류·생성·탭 복원·충돌 저장 경로, Worker 파싱, React Data Grid 편집기, 범위 선택과 TSV 클립보드, 행·열 작업, undo/redo, 정렬·필터·찾기·통계, 크기 정책과 테스트가 적용되었다. 성능 목표의 시간 수치는 실제 대형 fixture 벤치마크가 추가되기 전까지 목표값으로 유지한다.

## 1. 목표

Maek에서 `.csv` 파일을 표 형태로 열고 편집하고 저장할 수 있게 한다. Markdown 편집 경험과 같은 탭, 자동 저장, 외부 변경 충돌 처리, 파일 탐색기 흐름을 유지한다.

첫 버전은 CSV가 표현할 수 있는 값과 행·열 구조만 영구 저장한다. 셀 배경색, 글자색, 글꼴, 병합, 수식 계산, 여러 시트는 포함하지 않는다. 열 너비, 선택 위치, 필터 같은 화면 상태는 CSV 데이터와 분리한다.

## 2. 채택 패키지

### react-data-grid

- 설치 패키지: `react-data-grid`
- 역할: 가상화된 표 렌더링, 셀 편집, 키보드 이동, 열 크기 조절, 정렬 상태, 사용자 정의 렌더러
- 선택 이유: React 19.2 지원이 명시되어 있고 외부 런타임 의존성이 없으며, Maek의 React 상태 구조와 자연스럽게 결합된다.
- 앱 구현이 필요한 부분: 직사각형 범위 선택, 범위 표시, 다중 셀 복사·붙여넣기, 행·열 구조 변경, 실행 취소, 필터 데이터 처리
- Vite 8 주의사항: 라이브러리 CSS의 `light-dark()` 압축 문제가 재현되는 경우에만 Vite `cssMinify` 또는 `cssTarget` 설정을 조정한다.

### papaparse

- 설치 패키지: `papaparse`
- 개발 타입: 필요한 경우 `@types/papaparse`
- 역할: CSV 문자열 파싱과 직렬화, 따옴표·구분자·셀 내부 개행 처리
- 기본 설정: `header: false`, `dynamicTyping: false`, `skipEmptyLines: false`
- 모든 셀 값은 문자열로 유지한다. `00123`, 긴 정수, 전화번호, 날짜처럼 보이는 문자열을 자동 변환하지 않는다.

두 패키지는 외부 API를 호출하지 않고 앱 번들 안에서 로컬로 실행한다. 시트 코드와 CSS는 첫 CSV 파일을 열 때 동적으로 불러온다.

## 3. 사용자 기능 범위

### 필수 기능

- 탐색기에서 CSV 열기, 새 CSV 만들기, 이름 변경, 복사, 이동, 삭제
- 행 번호와 열 헤더가 있는 표 표시
- 클릭, 더블클릭, Enter/F2로 셀 편집
- Enter, Tab, Shift+Tab, 방향키로 이동
- 마우스 드래그와 Shift 키로 직사각형 범위 선택
- 선택 범위 복사, 잘라내기, 값 지우기
- Excel·Google Sheets와 TSV 형식으로 다중 셀 복사·붙여넣기
- 붙여넣기 영역이 현재 행·열을 넘으면 문서 확장
- 행과 열 추가·삭제
- 열 너비 변경
- 실행 취소·다시 실행
- 한 열 기준 오름차순·내림차순 정렬
- 간단한 텍스트 필터와 시트 내 찾기
- 선택 범위의 비어 있지 않은 셀 수 표시
- 숫자로 명확히 읽히는 선택 값의 합계·평균 표시
- 1.5초 자동 저장과 Cmd/Ctrl+S
- 저장 중, 저장 완료, 저장 실패, 외부 변경 충돌 표시
- 밝은/어두운 테마와 한국어 IME 입력

### 명확한 동작 규칙

- 첫 행 헤더 모드는 기본으로 끈다. 사용자가 켜면 첫 행을 열 이름으로 표시하지만 CSV 데이터에는 그대로 남긴다.
- 정렬은 실제 행 순서를 변경하는 편집 명령이며 undo 대상이다. 헤더 모드에서는 첫 행을 제외한다.
- 필터는 화면에 보이는 행만 바꾸며 CSV 저장에는 모든 행을 포함한다.
- 필터가 활성화된 동안 첫 버전에서는 범위 붙여넣기와 행 삽입·삭제를 막아 숨겨진 행을 잘못 수정하지 않게 한다. 단일 셀 편집은 허용한다.
- 셀 수식처럼 보이는 `=SUM(A1:A3)`도 일반 문자열로 저장한다.
- 셀 형식과 색상은 저장하지 않는다. 선택 강조와 오류 강조 등 앱 UI 색상만 표시한다.

## 4. 현재 코드 변경 지점

| 위치 | 변경 |
| --- | --- |
| `server/workspace/file-kind.ts` | `.csv`를 `text`에서 `sheet`로 분류 |
| `shared/workspace.ts` | `PreviewKind`에 `sheet` 추가 |
| `shared/contract.ts` | CSV 편집 가능 여부와 읽기 전용 사유를 표현할 응답 확장 |
| `server/fs/readFile.ts` | CSV 크기 정책, UTF-8/BOM 정보 처리 |
| `server/host.ts` | CSV PUT과 새 CSV 생성을 허용하고 서버에서 크기 제한 검증 |
| `client/src/features/editor/types.ts` | `spreadsheet` 탭 종류 추가 |
| `client/src/store.ts` | CSV 문서 핸들, dirty 상태, 저장 revision, 충돌·재로드 연결 |
| `client/src/features/editor/utils/frontmatter.ts` | Markdown 전용 dirty/직렬화와 공통 저장 경계 분리 |
| `client/src/App.tsx` | `React.lazy()`로 `SpreadsheetEditor` 분기 추가 |
| `client/src/features/explorer/Explorer.tsx` | 새 CSV 생성 메뉴, 아이콘과 표시 이름 처리 |

기존 `server/fs/writeFile.ts`의 mtime/hash 충돌 검사와 임시 파일 교체 저장은 그대로 재사용한다.

## 5. 프런트엔드 구조

```text
client/src/features/spreadsheet/
  SpreadsheetEditor.tsx       편집 화면과 툴바
  SpreadsheetGrid.tsx         react-data-grid 어댑터
  spreadsheet.css             테마와 선택 범위 표시
  model.ts                    CSV 문서, 행/열 ID, revision
  commands.ts                 편집 명령과 undo/redo
  selection.ts                직사각형 범위 상태와 키보드 확장
  clipboard.ts                TSV 복사/붙여넣기
  sorting.ts                  안정적인 행 정렬
  filtering.ts                표시 행 계산
  csv-codec.ts                Papa Parse 래퍼와 보존 정책
  csv.worker.ts               파싱/직렬화 Worker
```

### 문서 모델

```ts
interface SpreadsheetDocument {
  rows: SpreadsheetRow[];
  columns: SpreadsheetColumn[];
  dialect: CsvDialect;
  revision: number;
  savedRevision: number;
}

interface SpreadsheetRow {
  id: string;
  cells: string[];
  fieldCount: number;
}
```

- 안정적인 행·열 ID를 사용해 정렬·필터 후에도 편집 대상이 바뀌지 않게 한다.
- 화면은 직사각형이지만 행마다 원래 필드 수를 보존한다. 짧은 행을 화면 표시 때문에 빈 필드로 일괄 확장하지 않는다.
- 전역 Zustand 탭에는 전체 CSV 문자열 대신 문서 핸들과 저장 상태를 둔다.
- 매 셀 입력 시 전체 CSV를 다시 만들지 않는다. 저장 시점에 불변 스냅샷을 Worker로 보낸다.

### React Data Grid 보완 계층

React Data Grid의 셀 중심 복사·붙여넣기 훅 위에 앱의 범위 모델을 둔다.

1. 포인터 다운 셀을 anchor로 저장한다.
2. 드래그 또는 Shift 이동으로 focus 셀을 갱신한다.
3. 두 좌표의 최소/최대로 직사각형을 계산한다.
4. 별도 overlay로 범위 테두리와 채움을 표시한다.
5. 복사 시 선택 범위를 `\t`와 `\n`으로 직렬화한다.
6. 붙여넣기 시 클립보드 TSV를 2차원 배열로 파싱하고 anchor부터 적용한다.
7. 대량 붙여넣기는 하나의 명령과 하나의 undo 단위로 기록한다.

## 6. CSV 보존 정책

- UTF-8과 UTF-8 BOM을 지원하고 BOM 유무를 저장 시 보존한다.
- 기존 delimiter를 탐지해 보존한다. 쉼표를 기본값으로 하며 탭·세미콜론도 읽을 수 있다.
- LF/CRLF와 마지막 개행 유무를 보존한다.
- 인용된 쉼표, 큰따옴표, 셀 내부 개행, 공백, 빈 행, 마지막 빈 필드를 테스트한다.
- 행마다 필드 수가 다른 CSV도 허용한다.
- 닫히지 않은 따옴표 등 복구가 불확실한 파싱 오류는 읽기 전용으로 열고 원본 덮어쓰기를 막는다.
- CP949/EUC-KR/UTF-16 자동 변환은 첫 버전에서 제외한다. 지원하지 않는 인코딩임을 보여준다.
- 파일을 열기만 해서는 저장하지 않는다.
- 편집 후 데이터 의미와 dialect는 보존하지만 불필요한 따옴표 위치까지 원문과 바이트 단위로 동일함을 보장하지 않는다.
- 일반 저장에서 CSV formula injection 방지를 위해 값을 임의 변경하지 않는다. 별도의 안전 내보내기가 생길 때 Papa Parse `escapeFormulae`를 사용할 수 있다.

## 7. 저장과 외부 변경 처리

1. 셀 편집을 확정하면 revision을 증가시키고 1.5초 자동 저장을 예약한다.
2. IME 조합 중에는 편집 완료나 저장을 확정하지 않는다.
3. 저장 시 문서 ID, 경로, generation, revision이 포함된 스냅샷을 Worker에서 CSV로 만든다.
4. 기존 PUT API에 CSV 문자열, baseHash, baseMtimeMs를 전송한다.
5. 응답이 성공하면 전송했던 revision까지만 saved로 표시한다.
6. 저장 중 생긴 편집은 dirty 상태로 남겨 다음 저장을 실행한다.
7. 자신의 저장에서 발생한 SSE 파일 변경 이벤트는 hash와 진행 중 요청으로 식별해 재로드하지 않는다.
8. 외부 변경 시 clean 문서는 재로드하고 dirty 문서는 자동 저장을 멈춘 뒤 충돌 UI를 표시한다.
9. 충돌 UI는 다시 불러오기, CSV 복사본 저장, 닫기를 제공한다.
10. 탭 닫기, Save All, 워크스페이스 전환은 활성 셀 편집을 확정하고 저장 완료를 기다린다. 실패하면 문서를 유지한다.

## 8. 크기와 성능 정책

초기 편집 한도는 다음 조건을 모두 만족하는 파일로 잡고 실제 측정 후 조정한다.

- UTF-8 기준 5 MiB 이하
- 50,000행 이하
- 200열 이하
- 실제 필드 총 500,000개 이하
- 단일 셀 100,000자 이하

서버는 바이트 크기를 검증하고 Worker는 파싱 중 행·열·필드·셀 길이 제한을 검사한다. 붙여넣기와 행·열 추가에도 같은 제한을 적용한다. 제한을 넘으면 원본을 보존하고 읽기 전용 미리보기와 이유를 보여준다.

성능 목표:

- CSV를 열지 않을 때 `react-data-grid`, Papa Parse, Worker 코드를 초기 번들에서 로드하지 않음
- 10,000행 × 20열에서 첫 사용 가능한 화면 1초 이내
- 단일 셀 편집 확정 p95 50ms 이내
- 100 × 100 셀 붙여넣기 500ms 이내, undo 한 번
- 한도 근처 파일에서도 탭 전환과 취소가 가능할 것
- undo 이력은 100명령 또는 추정 20MiB 중 먼저 도달한 한도로 제한

## 9. 구현 단계

### 1단계: 패키지 및 수직 검증

- `react-data-grid`, `papaparse`, 필요 시 `@types/papaparse` 설치
- CSV fixture를 열어 셀 한 개 수정 후 저장하는 최소 경로 구현
- React 19.2, Vite 8 production build, Electron, 한글 IME 확인
- 실제 lazy 청크 크기 기록

완료 조건: 패키지가 타입 검사와 production build를 통과하고 CSV 한 셀 수정이 재실행 후 유지된다.

### 2단계: 파일 타입과 저장 기반

- `sheet` 타입과 API 허용 목록 추가
- CSV 생성, 읽기, 저장, BOM/dialect 보존 구현
- Markdown과 CSV의 dirty/저장 전략 분리
- 외부 변경 및 저장 충돌 연결

완료 조건: CSV fixture 왕복 테스트와 Markdown 저장 회귀 테스트가 통과한다.

### 3단계: 기본 그리드 편집

- 셀 편집, 키보드 이동, 행/열 헤더와 크기 조절
- 행·열 삽입/삭제
- 앱 범위 선택 overlay
- TSV 범위 복사·붙여넣기와 문서 자동 확장
- undo/redo 명령 이력

완료 조건: Excel/Google Sheets와 2차원 복사·붙여넣기, 한글 편집, 대량 작업 한 번의 undo가 동작한다.

### 4단계: 데이터 도구와 앱 통합

- 헤더 모드, 정렬, 필터, 찾기, 선택 통계
- 탐색기 생성/아이콘, 이름 변경, 복사본, 탭 복원
- 저장 중 닫기/전환, SSE 자기 저장 구분
- 테마, 포커스와 키보드 접근성

완료 조건: 전체 E2E 흐름과 성능 목표를 통과한다.

### 5단계: 안정화

- 제한 경계와 손상된 CSV 처리
- 여러 CSV 탭 메모리 회수 확인
- README에 CSV 지원 범위와 인코딩 제한 추가
- 개발 중 임시 플래그 제거 또는 정식 기능 플래그 확정

## 10. 테스트 계획

### 단위 테스트

- 빈 파일, 단일 셀, 한 열
- BOM, LF/CRLF, 마지막 개행
- 쉼표/탭/세미콜론 delimiter
- 따옴표, 셀 내부 개행, 빈 행과 마지막 빈 필드
- ragged rows, 긴 숫자, 앞자리 0, 공백, 수식형 문자열
- 손상된 CSV와 비 UTF-8 입력
- 범위 정규화, TSV 복사/붙여넣기
- 행·열 명령과 undo/redo
- 정렬 후 안정적인 ID, 필터 숨김 행 보존
- 저장 중 추가 편집과 revision 처리

### 통합 및 E2E

- 탐색기에서 CSV 생성 → 열기 → 한글 입력 → 범위 붙여넣기 → undo/redo → 저장 → 재열기
- Excel 및 Google Sheets와 복사·붙여넣기
- 외부 파일 수정·삭제 충돌
- 읽기 전용과 크기 제한
- 저장 실패 시 탭과 편집 내용 유지
- 이름 변경과 워크스페이스 전환 중 늦은 저장 응답 무시
- Markdown 열기·편집·자동 저장 회귀 없음
- 밝은/어두운 테마와 키보드 전용 조작

검증 명령:

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

## 11. 첫 버전 완료 정의

다음 조건을 모두 만족하면 CSV 지원을 완료한 것으로 본다.

- 기존·신규 CSV가 전용 표 편집기로 열린다.
- 셀과 직사각형 범위를 키보드·마우스로 편집할 수 있다.
- Excel/Google Sheets와 여러 셀을 복사·붙여넣을 수 있다.
- 행·열 구조 변경과 undo/redo가 동작한다.
- 정렬·필터·찾기와 기본 선택 통계가 동작한다.
- 문자열 값과 CSV dialect가 정의된 보존 정책대로 유지된다.
- 자동 저장, 외부 충돌, 탭 닫기와 워크스페이스 전환에서 데이터가 유실되지 않는다.
- CSV 기능은 지연 로딩되어 Markdown 초기 로딩에 그리드 코드를 추가하지 않는다.
- 단위 테스트, 타입 검사, production build, 관련 E2E와 성능 검증을 통과한다.

## 참고 자료

- [React Data Grid 공식 저장소](https://github.com/Comcast/react-data-grid)
- [Papa Parse 공식 저장소](https://github.com/mholt/PapaParse)
- [Papa Parse 설정 문서](https://www.papaparse.com/docs)
