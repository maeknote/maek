# Maek 제품 포지셔닝과 오픈소스 런칭 논지

작성일: 2026-09-17  
상태: 초안. 제품 방향과 시장 조사는 반영했으며, 아래의 잠정 전제와 런칭 범위는 최종 승인 전이다.

## 문서 목적

이 문서는 Maek을 오픈소스로 공개할 때 무엇으로 소개해야 하는지, 기존 Markdown·지식 관리·AI workspace 제품과 무엇이 다른지, 현재 제품이 실제로 경쟁 가능한지에 대한 논의와 조사를 정리한다.

목표는 구현력을 전시하는 포트폴리오를 만드는 데 그치지 않는다. **좋은 제품을 만들고, 그 제품이 꽤 많은 사람에게 실제로 닿게 하는 것**이 목표다.

## 한 문장 결론

> **Maek은 AI가 들어간 Markdown 에디터가 아니다. 에이전트가 로컬 폴더에 남긴 맥락과 산출물을 사람이 읽고, 검토하고, 조작하는 인터페이스다.**

영문 표현의 첫 후보는 다음과 같다.

> **Your agents work in files. Maek makes them usable.**

보조 설명:

> Open any local folder and work with agent-made documents, data, databases, and interactive artifacts through interfaces built for humans. Use any agent. Keep every result as files you own.

## 제품을 다시 정의한 배경

초기 질문은 다른 오픈소스 Markdown 에디터와 Maek이 어떻게 다른가였다. 저장소를 확인하면 Maek은 이미 단순 편집기보다 넓다.

- 실제 폴더와 파일을 유일한 원본으로 사용한다.
- Markdown을 WYSIWYG 방식으로 편집하고 YAML frontmatter를 속성으로 다룬다.
- Markdown 파일 묶음을 표·칸반·캘린더·타임라인으로 표현한다.
- CSV를 가상화 스프레드시트로 직접 편집한다.
- HTML과 주변 JS·CSS·JSON·이미지를 sandboxed artifact로 실행한다.
- 이미지·PDF·텍스트를 각 형식에 맞게 미리 본다.
- 외부 프로그램이 바꾼 파일과 이름 변경을 실시간 반영한다.
- 외부 변경과 로컬 초안이 충돌할 때 자동으로 덮어쓰지 않는다.

그러나 현재 README는 Maek을 "macOS localhost에서 실행하는 개인용 Markdown Workspace"라고 소개하고 AI와 터미널을 미지원 항목으로 분류한다. 이 표현은 구현된 기능은 설명하지만 앞으로의 제품 범주는 설명하지 못한다.

새 제품 정의에서는 AI를 내장하지 않는 것이 결핍이 아니다. Maek은 Codex, Claude Code, OpenCode처럼 이미 존재하는 에이전트 하네스와 경쟁하지 않는다. 에이전트는 외부에서 작업하고, 파일시스템이 공통 계약이 된다.

## 핵심 사용 루프

Maek이 보여줘야 하는 것은 단발성 prompt-to-artifact가 아니라 맥락이 계속 축적되는 다음 루프다.

1. 에이전트가 기존 로컬 폴더의 노트, 데이터, 지침과 과거 산출물을 읽는다.
2. 에이전트가 작업에 적합한 형식으로 Markdown, CSV, HTML 등의 파일을 만들거나 수정한다.
3. Maek이 외부 변경을 감지하고 각 파일을 사람에게 적합한 인터페이스로 보여준다.
4. 사용자는 문서·속성·표·보드·캘린더·인터랙티브 artifact에서 결과를 검토하고 수정한다.
5. 다음 에이전트 작업은 사용자가 수정한 같은 폴더의 맥락에서 이어진다.

이 루프의 결과는 앱의 채팅 기록이나 독점 데이터베이스가 아니라 사용자가 소유한 폴더에 남는다.

## 초기 사용자와 확장 경로

### 초기 진입점

첫 사용자는 **코딩 에이전트를 업무 전반에 사용하기 시작한 개발자와 1인 창업자**다.

- 이미 로컬 에이전트와 폴더 기반 작업 방식에 익숙하다.
- 새로운 AI 사용법을 교육할 필요가 없다.
- 조사, 기획, 데이터 정리, 콘텐츠, HTML prototype 같은 비개발 작업에도 같은 하네스를 사용하기 시작했다.
- GitHub, Hacker News, 개발자 커뮤니티처럼 접근 가능한 초기 배포 채널이 있다.

### 장기 정체성

장기적으로는 **자신의 맥락과 결과물을 로컬 파일로 소유하려는 지식 노동자**에게 확장한다. 초기 사용자는 개발자지만 데모의 내용은 코딩에 한정하지 않는다. 그렇지 않으면 Maek이 개발자 전용 도구로 고착된다.

## 제품 경계

초기 방향은 다음과 같다.

- Maek은 모델을 선택하거나 호출하지 않는다.
- Maek은 채팅, prompt 실행, 권한 승인, agent orchestration을 제공하지 않는다.
- 특정 agent SDK, MCP 서버 또는 vendor API를 통합의 필수 조건으로 삼지 않는다.
- Codex, Claude Code, OpenCode뿐 아니라 미래의 다른 하네스도 일반 파일을 남기면 그대로 작동해야 한다.
- Maek의 책임은 산출물을 발견하고, 적절히 표현하고, 사람이 안전하게 수정하도록 돕는 것이다.

이 경계는 범위를 줄이기 위한 임시 결정이 아니라 제품 철학이다. 에이전트 하네스가 빠르게 바뀌어도 일반 파일과 사람이 결과를 검토해야 한다는 요구는 남는다.

## 시장 조사 결론

### 문제는 실제다

에이전트가 일반 지식 업무까지 수행할수록 사람의 역할은 직접 생성에서 검토와 확장으로 이동한다. 2026년 연구는 에이전트 사용 이후 후속 행동이 검증과 확장 쪽으로 이동하는 현상을 보고한다. 또 mixed-format 업무에서는 에이전트가 읽은 parsed view, 수정한 native file, 사람이 검토하는 artifact가 서로 다른 버전을 가리킬 수 있다는 workspace-state 문제가 별도 연구 주제가 됐다.

이 사실은 다음 필요를 뒷받침한다.

- 채팅보다 오래 남는 durable context
- 여러 형식의 native artifact
- 외부 변경을 정확히 반영하는 interface
- 사람이 결과를 검토하고 수정할 수 있는 view
- 다음 agent run이 다시 사용할 수 있는 canonical workspace state

### 범주는 새롭지 않다

"local-first AI workspace", "agent-native workspace", "plain Markdown for humans and agents"는 이미 여러 제품이 사용한다.

| 제품 | 이미 점유한 가치 | Maek에 주는 압력 |
|---|---|---|
| [Stet](https://stet.md/) | Markdown 문서, 외부 agent, tracked suggestion, review와 version history | "AI + Markdown + local files"만으로는 차별화되지 않는다. |
| [Sundial](https://github.com/sundial-org/sundial-desktop) | 사람·팀·agent의 동시 편집, agent 변경 attribution과 review | agent 변경을 신뢰하고 검토하는 경험의 기준을 높인다. |
| [desk.md](https://github.com/v1lling/desk.md) | 외부 agent를 위한 durable Markdown context, 프로젝트·작업·문서·회의 | "agent는 외부에 둔다"는 철학까지 이미 겹친다. |
| [Busabase](https://github.com/busabase/busabase) | 외부 agent, 문서·DB·파일·앱·workflow, human-reviewed change request | agent workspace를 데이터·권한·감사까지 확장한다. |
| [Nomendex](https://nomendex.com/) | agent-native workspace, files over apps, Markdown as AI lingua franca | 범주명과 기본 메시지가 직접 겹친다. |
| [Obsidian Bases](https://obsidian.md/help/bases) | local Markdown properties를 table·list·cards·kanban·map으로 표현 | Markdown을 database view로 바꾸는 기능도 단독 차별점이 아니다. |
| [SilverBullet](https://github.com/silverbulletmd/silverbullet) | local Markdown, query, database, Lua automation, self-hosting | 성숙한 programmable Markdown 도구와 기능 수로 경쟁해서는 안 된다. |
| [Logseq](https://github.com/logseq/logseq) | privacy-first open-source knowledge management와 대규모 community | 기존 PKM 사용자를 기능 parity로 빼앗기는 어렵다. |
| [AppFlowy](https://appflowy.com/) | team·AI agent를 위한 source of truth, local/on-prem AI, cross-platform collaboration | all-in-one AI workspace와 범위 경쟁을 하면 진다. |
| [AFFiNE](https://github.com/toeverything/AFFiNE) | docs·canvas·tables·slides·AI를 결합한 local-first all-in-one workspace | "여러 형식을 한곳에서"만 주장해도 충분하지 않다. |

### 시장에서 피해야 할 포지셔닝

다음 문구는 이미 붐비거나 Maek을 불리한 기능 경쟁으로 끌고 간다.

- AI 시대의 Markdown editor
- Local-first AI workspace
- Open-source Obsidian 또는 Notion alternative
- 데이터 소유권을 지켜주는 knowledge tool
- Markdown 기반 agent-native workspace
- AI vendor lock-in이 없는 note app

이 표현들은 보조 설명으로 사용할 수 있지만 Maek의 핵심 headline이 되어서는 안 된다.

## Maek의 유망한 차별점

Maek이 점유할 수 있는 영역은 **note-native가 아니라 artifact-native**인 human interface다.

기존 지식 도구는 문서나 block을 중심으로 다른 자료를 자기 데이터 모델 안에 넣으려 한다. Maek은 에이전트가 선택한 일반 파일 형식을 유지하고, 형식마다 적합한 인터페이스를 제공한다.

| Agent가 남긴 파일 | Maek이 제공하는 사람용 인터페이스 |
|---|---|
| Markdown | WYSIWYG 문서, heading, task, table, code, math, properties |
| Frontmatter가 있는 Markdown 묶음 | Table, kanban, calendar, timeline |
| CSV | 편집 가능한 spreadsheet와 range operation |
| HTML + JS/CSS/JSON/image | 격리된 interactive artifact preview |
| Image, PDF, text | 형식별 preview와 외부 앱 연결 |

핵심 주장은 "많은 파일 형식을 지원한다"가 아니다.

> **Agent가 작업에 맞는 열린 파일 형식을 선택하면, Maek은 그 파일을 사람이 사용할 수 있는 최선의 인터페이스로 바꾼다.**

## EUREKA: agent를 넣지 않는 것이 제품 전략이다

현재 시장의 일반적인 접근은 agent와 chat을 workspace 안에 넣는 것이다. 이 접근은 AI 호출과 orchestration이 제품 가치의 중심이라는 가정을 가진다.

Maek의 반대 가설은 다음과 같다.

1. Agent harness와 model은 빠르게 강해지고 교체 가능해진다.
2. 각 앱이 agent runtime을 다시 만드는 것은 중복이다.
3. Harness가 상품화될수록 여러 agent가 공통으로 남기는 파일의 가치가 커진다.
4. 사람이 산출물을 검토하고 수정하는 interface는 agent와 별개의 지속적인 제품 층이다.

따라서 Maek은 agent runtime 경쟁을 피하고 **agent-agnostic artifact interface**를 점유해야 한다.

단, desk.md처럼 외부 agent와 file context를 내세우는 제품이 이미 있으므로 agent-agnostic만으로는 부족하다. Maek은 여러 artifact를 실제로 편집 가능한 native view로 바꾸는 경험을 증명해야 한다.

## 현재 경쟁력 평가

아래 점수는 코드·문서와 2026-09-17 현재 공개된 경쟁 제품을 기준으로 한 정성 평가다.

| 항목 | 점수 | 판단 |
|---|---:|---|
| 문제의 현실성 | 8/10 | Agent 산출물의 검토·수정·보존 문제는 커지고 있다. |
| 범주의 독창성 | 2/10 | 유사한 범주명과 철학을 쓰는 제품이 이미 다수 존재한다. |
| Maek의 잠재적 차별점 | 7/10 | 일반 파일을 여러 editable interface로 바꾸는 조합은 강하다. |
| 현재 포지셔닝 | 2/10 | README와 제품 소개가 새로운 논지를 전혀 전달하지 않는다. |
| 현재 오픈소스 런칭 준비도 | 3/10 | 권리, license, installer, release channel과 onboarding이 미완성이다. |
| 넓은 도달 가능성 | 7/10 | 설치와 message를 고치면 가능하지만 기능만 공개해서는 어렵다. |

### 지금 그대로 런칭할 경우

현재 상태로 공개하면 다음 반응이 나올 가능성이 높다.

- "Obsidian과 무엇이 다른가?"
- "VS Code에서 폴더를 열면 되지 않나?"
- "왜 Node를 설치하고 직접 build해야 하나?"
- "AI workspace라면서 AI가 어디에 있나?"
- "여러 기능을 가진 개인용 Markdown app 같다."

이는 제품 아이디어가 필요 없다는 뜻이 아니다. **현재 구현의 차이가 사용자에게 관찰 가능한 하나의 경험으로 묶이지 않았다는 뜻**이다.

## 현재 제품의 강점

### 1. 실제 파일이 canonical state다

가져오기나 proprietary database migration 없이 기존 폴더를 연다. Agent, shell, Git, Finder와 같은 도구가 같은 자료를 다룰 수 있다.

### 2. 외부 변경을 제품의 정상 흐름으로 취급한다

실시간 file watch, rename 반영, hash·mtime 검사, atomic save, conflict handling은 외부 agent와 함께 쓰기 위한 좋은 기반이다.

### 3. 산출물 형식의 폭이 넓다

Markdown editor 하나가 아니라 spreadsheet, structured database views, interactive HTML artifact까지 한 workspace에서 다룬다.

### 4. Agent vendor와 독립적이다

Agent가 일반 파일을 읽고 쓸 수 있으면 별도 integration 없이 작동한다. 특정 model이나 subscription의 변화가 핵심 제품을 무너뜨리지 않는다.

## 공개 전에 해결해야 할 약점

### 1. 제품 설명

README, repository description, screenshot, demo가 모두 Local Agent Workspace 논지로 다시 정렬되어야 한다. "AI 미지원"은 "built-in agent runtime 없음"으로 정확히 표현해야 한다.

### 2. Agent 변경 검토

현재 conflict protection은 데이터 손실을 막지만, agent가 무엇을 바꿨는지 이해하고 승인하는 경험은 제공하지 않는다. 시장의 강한 경쟁자는 tracked suggestion, attribution, diff, revert를 이미 핵심으로 내세운다.

최소한 다음 질문에 답해야 한다.

- 어떤 파일이 방금 바뀌었는가?
- 무엇이 추가·삭제·수정됐는가?
- 사람이 수정하기 전 상태로 돌아갈 수 있는가?
- 외부 변경과 현재 draft를 어떻게 비교할 것인가?

### 3. 하나의 대표 데모

기능 tour가 아니라 다음 결과를 60초 안에 보여줘야 한다.

1. 기존 맥락이 들어 있는 폴더를 agent가 읽는다.
2. Agent가 Markdown, CSV, HTML을 생성하거나 갱신한다.
3. Maek의 sidebar에 변경이 실시간으로 나타난다.
4. 문서는 읽기 좋은 편집 화면, CSV는 spreadsheet, HTML은 interactive report로 열린다.
5. 사람이 내용을 수정한다.
6. 다음 agent run이 수정된 파일을 다시 맥락으로 사용한다.

데모 주제는 개발자만 이해하는 code generation이 아니라 시장 조사, 제품 기획, 여행 계획, 연구 정리처럼 일반 지식 업무가 적절하다.

### 4. 설치와 배포

Node 설치, source build, 별도 launcher 설치는 넓은 도달을 막는다. 다운로드 가능한 desktop artifact나 검증된 한 단계 설치가 필요하다. 기존 배포 조사 문서의 Docker 경로는 self-hosting에는 유효하지만 로컬 개인 사용자에게 최고의 첫 경험인지는 별도로 판단해야 한다.

### 5. 공개 권리와 license

README는 Maek Note의 디자인 component와 editor extension을 이식했다고 밝힌다. 코드·디자인·아이콘·자산을 공개 license로 배포할 권리가 확인되지 않으면 저장소 공개를 중단해야 한다. 자세한 중단 조건은 [배포 리서치 README](README.md)와 [라이선스 조사](licensing.md)를 따른다.

### 6. 지원 플랫폼

현재 핵심 경로는 macOS localhost와 macOS native operation에 의존한다. 개발자 초기 사용자는 macOS만으로도 시작할 수 있지만, "꽤 많은 사람"에게 닿는 목표에는 Windows와 Linux 또는 browser/self-hosted 경로가 필요하다.

## 런칭 메시지 구조

### Hero

> **Your agents work in files. Maek makes them usable.**

### Three proofs

1. **Any agent**  
   Codex, Claude Code, OpenCode 또는 미래의 다른 agent를 그대로 사용한다.

2. **Every artifact gets a real interface**  
   Markdown은 문서로, CSV는 spreadsheet로, frontmatter는 database view로, HTML은 interactive artifact로 연다.

3. **Your context stays yours**  
   맥락과 결과물은 import 없이 사용자의 폴더에 일반 파일로 남는다.

### 피해야 할 첫 화면

- 빈 Markdown editor screenshot
- 기능 checklist만 나열한 README
- Obsidian과의 장표식 feature comparison
- Agent chat UI처럼 보이는 mockup
- "AI-powered"라는 단어만 강조한 hero

첫 화면은 하나의 실제 폴더 안에서 서로 다른 artifact가 열린 상태와 agent가 파일을 갱신하는 순간을 보여줘야 한다.

## 잠정 제품 전제

다음 전제는 지금까지의 논의와 조사에서 도출됐지만 최종 승인 전이다.

1. 핵심 문제는 Markdown 편집이 아니라 agent가 계속 갱신하는 mixed-format artifact를 사람이 검토하고 조작하는 일이다.
2. 초기 사용자는 외부 로컬 agent를 이미 사용하는 개발자·1인 창업자이고 이후 일반 지식 노동자로 확장한다.
3. Maek은 agent 실행, chat, model 선택을 맡지 않으며 filesystem을 유일한 integration contract로 사용한다.
4. 차별점은 local-first 자체가 아니라 Markdown·CSV·HTML·structured files를 각각 적합한 UI로 바꾸는 artifact-native interface다.
5. 공개 런칭 전에 권리·license와 설치 가능한 release를 해결해야 한다.

## 다음 결정

다음 논의에서는 최소 세 가지 런칭 접근을 비교해야 한다.

1. **최소 런칭:** 현재 기능을 하나의 agent-to-artifact demo와 설치 가능한 release로 묶는다.
2. **신뢰 중심 런칭:** 외부 변경 diff, activity, revert를 추가해 human review를 핵심 경험으로 만든다.
3. **Artifact platform 런칭:** 파일 형식과 view의 연결을 확장 가능한 구조로 만들고 "best interface for any agent-made artifact"를 장기 platform으로 제시한다.

선택한 접근은 README, demo, release scope, 향후 roadmap을 동시에 결정한다.

## 조사 근거

### 제품과 공식 문서

- [Stet](https://stet.md/)
- [Sundial Desktop](https://github.com/sundial-org/sundial-desktop)
- [desk.md](https://github.com/v1lling/desk.md)
- [Busabase](https://github.com/busabase/busabase)
- [Nomendex](https://nomendex.com/)
- [Knowforge](https://www.knowforge.net/)
- [Obsidian Bases](https://obsidian.md/help/bases)
- [Obsidian Manifesto](https://obsidian.md/about)
- [SilverBullet](https://github.com/silverbulletmd/silverbullet)
- [Logseq](https://github.com/logseq/logseq)
- [AppFlowy](https://appflowy.com/)
- [AFFiNE](https://github.com/toeverything/AFFiNE)

### 연구

- [StagedWorkspace: A Versioned Workspace for Knowledge-Work Agents](https://arxiv.org/abs/2608.18050)
- [How AI Agents Reshape Knowledge Work: Autonomy, Efficiency, and Scope](https://arxiv.org/abs/2606.07489)

## 최종 판단

Maek은 필요 없는 제품이 아니다. 반대로 category name이나 local-first 철학만으로 이길 수 있는 제품도 아니다.

현재 가장 설득력 있는 기회는 다음과 같다.

> **Agent runtime은 교체 가능하게 두고, agent가 로컬 폴더에 남긴 다양한 artifact를 사람이 신뢰하며 사용할 수 있는 최고의 interface가 된다.**

이 주장을 실제 경쟁력으로 만들려면 기능 추가보다 먼저 다음 네 가지가 필요하다.

1. 제품 전체를 묶는 하나의 agent-to-artifact demo
2. Agent가 만든 변경을 사람이 이해하고 되돌릴 수 있는 review 경험
3. 다운로드 후 바로 열 수 있는 배포 artifact
4. 공개 가능한 권리와 명확한 open-source license

이 네 가지 없이 공개하면 좋은 구현이 기능 목록으로 보인다. 네 가지를 해결하면 Maek은 crowded Markdown 시장이 아니라 아직 승자가 없는 **human interface for agent-made work** 시장에서 경쟁할 수 있다.
