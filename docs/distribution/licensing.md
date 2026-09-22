# Maek 오픈소스 라이선스 조사

조사일: 2026-09-17

## 먼저 구분할 것

GitHub에 소스가 보인다고 자동으로 오픈소스가 되는 것은 아니다. 명시적 라이선스가 없으면 일반적으로 저작권자가 모든 권리를 보유하며, 타인이 복제·수정·배포할 권리를 얻지 못한다. 반대로 OSI 승인 오픈소스 라이선스는 상업적 사용을 포함한 사용·수정·재배포를 허용한다.

“비상업적 사용만 허용”, “경쟁 서비스 금지”, “개인 용도만 허용” 같은 조건을 붙인 source-available 라이선스는 공개 소스일 수는 있어도 일반적인 의미의 오픈소스는 아니다.

## 주요 선택지

| 라이선스 | 성격 | 수정 소스 공개 의무 | 네트워크 서비스 공개 의무 | 상업·폐쇄형 결합 | Maek 관점 |
|---|---|---|---|---|---|
| MIT | permissive | 없음 | 없음 | 허용 | 가장 단순하고 채택 장벽이 낮음 |
| Apache-2.0 | permissive + 명시적 특허 허여 | 없음 | 없음 | 허용 | 특허 조항이 필요할 때 MIT보다 명확 |
| MPL-2.0 | 파일 단위 weak copyleft | 배포 시 수정된 MPL 파일 공개 | 없음 | 별도 파일은 폐쇄 가능 | 완화된 상호공유를 원할 때 |
| GPL-3.0 | strong copyleft | 배포되는 파생 프로그램 전체에 적용 | 단순 서버 운영에는 없음 | 폐쇄형 파생 배포 제약 | 데스크톱/배포물 상호공유에는 강하지만 SaaS 빈틈 존재 |
| AGPL-3.0 | network copyleft | GPL 수준 | 수정 서버의 네트워크 사용자에게 대응 소스 제공 | 폐쇄형 hosted fork 제약 | 셀프호스팅 웹앱 보호 목적에 가장 직접적 |

### MIT

장점은 짧고 이해하기 쉬우며, 개인·기업·Linux 배포판·NAS 앱스토어 등이 채택하기 편하다는 점이다. 수정판을 유료로 판매하거나 소스를 공개하지 않는 제품에 포함하는 것도 허용된다. 요구사항은 저작권 및 라이선스 고지를 보존하는 정도다.

단점은 누군가 Maek를 수정해 폐쇄형 제품이나 호스팅 서비스로 제공해도 그 변경을 돌려받을 권리가 없다는 점이다.

### Apache-2.0

MIT와 비슷하게 permissive지만 기여자의 명시적 특허 라이선스와 특허 소송 시 종료 조항이 있다. 수정 사실 및 NOTICE 관리가 더 명확한 대신, 작은 개인 프로젝트에는 절차가 조금 더 무겁다. 프로젝트명과 상표 사용 권한을 주지 않는다는 점도 명시적이다.

### MPL-2.0

MPL 파일을 수정해 배포하면 해당 파일의 소스를 MPL로 제공해야 하지만, 새 파일이나 더 큰 결합 프로그램 전체까지 같은 라이선스로 만들 필요는 없다. “수정은 공유하되 다른 제품과의 결합은 막지 않겠다”는 중간 지점이다. 다만 서버에서만 실행하고 배포하지 않는 수정에는 일반적으로 네트워크 공개 의무가 없다.

### GPL-3.0

프로그램을 수정해 배포할 때 파생물 전체에 강한 copyleft를 적용한다. 그러나 수정 프로그램을 자기 서버에서만 실행하고 사용자에게 바이너리를 배포하지 않으면 소스 제공 의무가 발생하지 않는 이른바 SaaS loophole이 있다.

### AGPL-3.0

GPL-3.0에 네트워크 사용 조항을 더한다. 수정 버전을 서버에서 실행해 다른 사용자가 네트워크로 이용하게 하면 그 사용자에게 대응 소스를 받을 방법을 제공해야 한다. 공개 호스팅 포크의 수정도 다시 공개되기를 원할 때 적합하다.

단점은 기업 도입 정책상 AGPL 사용을 금지하거나 법무 검토를 요구하는 조직이 적지 않고, 외부 기여·통합·패키징의 장벽이 MIT보다 높다는 점이다. 또한 AGPL이라고 해서 상표, 데이터, 유료 호스팅 자체를 금지하는 것은 아니다.

## 비교 프로젝트의 선택

| 프로젝트 | 라이선스 | 해석 |
|---|---|---|
| flatnotes | MIT | 파일 기반 셀프호스팅 앱의 채택과 포크 자유를 우선 |
| SilverBullet | MIT | 로컬 바이너리·Docker·확장 생태계의 낮은 통합 장벽을 우선 |
| Memos | MIT | 서버·클라이언트·API 생태계와 폭넓은 재사용을 우선 |
| Trilium | AGPL-3.0-or-later | 서버에서 운영되는 수정판까지 source-sharing 범위에 포함 |

## 현재 Maek 의존성 점검

2026-09-17 현재 설치된 **최상위 runtime/dev dependency**의 `package.json` 라이선스를 확인했다.

- MIT: React, Fastify, Tiptap, better-sqlite3, Vite, Electron 등을 포함한 대부분
- Apache-2.0: `@hello-pangea/dnd`, Playwright, `class-variance-authority`, Fuse.js, TypeScript
- BSD-3-Clause: highlight.js
- ISC: lucide-react, markdown-it-task-lists, yaml

이 구성은 통상 MIT, Apache-2.0, MPL-2.0, GPL/AGPL 프로젝트에서 사용할 수 있는 permissive 의존성들이다. `react-arborist`에 적용한 로컬 patch도 원 패키지의 MIT 고지를 보존해야 한다.

이 검사는 최상위 패키지의 선언값만 본 1차 점검이다. 공개 이미지·바이너리를 만들기 전에는 다음을 자동화해야 한다.

- 전체 transitive dependency와 번들에 실제 포함되는 패키지의 license scan
- 폰트, 아이콘, 이미지, syntax definition 등 비코드 자산 검사
- `THIRD_PARTY_NOTICES` 또는 동등한 고지 파일 생성
- lockfile 변경 PR에서 금지 또는 검토 대상 라이선스 감지
- Docker base image와 OS package의 고지 보존

## Maek에 대한 권고

### 현재 목표에는 MIT가 가장 맞다

사용자가 로컬에서 쉽게 실행하고, 패키저와 기여자가 부담 없이 참여하며, 초기 생태계를 넓히는 것이 우선이라면 **MIT License**를 권한다.

근거는 다음과 같다.

- 가장 가까운 flatnotes를 포함해 비교 프로젝트 4개 중 3개가 MIT다.
- 현재 직접 의존성의 대부분이 permissive이고 MIT와 충돌하지 않는다.
- 프로젝트가 아직 초기라 설치·기여·재배포 장벽을 낮추는 가치가 크다.
- 이름과 로고 보호는 코드 라이선스를 제한하지 않고 별도 상표 정책으로 처리할 수 있다.
- 유료 공식 호스팅이나 유료 지원을 나중에 제공하는 것과도 충돌하지 않는다.

### 이 질문에 “예”라면 AGPL을 다시 검토한다

> 다른 회사가 Maek를 고쳐 폐쇄형 유료 호스팅으로 제공하면서 수정 코드를 전혀 공개하지 않는 것을 반드시 막아야 하는가?

이것이 핵심 사업·커뮤니티 원칙이라면 `AGPL-3.0-or-later`가 더 맞다. 단지 “코드를 훔쳐 가는 것이 싫다”는 막연한 이유만으로 선택하면 실제 사용자와 기여자의 법적 부담이 더 커질 수 있다.

MPL-2.0은 배포된 수정 파일을 공유시키는 절충안이지만, Maek의 중심 사용 형태가 웹 서버라면 네트워크로만 제공되는 수정판 문제를 해결하지 못한다. 따라서 Maek에는 MIT와 AGPL 사이에서 결정하는 편이 목적이 더 분명하다.

## 권리와 운영 체크리스트

라이선스를 선택하는 것보다 먼저, 그 라이선스를 부여할 권리가 있는지 확인해야 한다.

1. README는 Maek Note의 디자인 컴포넌트와 에디터 확장을 이식했다고 밝힌다. 원본 코드가 본인 단독 저작물인지, 공동 저작·고용·외주 계약의 제한이 없는지 확인한다.
2. 아이콘(`client/public`, `resources`)의 제작자와 사용 조건을 확인한다.
3. 외부 코드에서 복사한 부분이 있다면 원 라이선스와 저작권 고지를 식별한다.
4. 첫 공개 커밋 전에 전체 Git 이력의 secret·개인 데이터·대형 산출물을 검사한다.
5. `LICENSE`를 루트에 두고 `package.json`에 SPDX 식별자(`MIT` 또는 `AGPL-3.0-or-later`)를 넣는다.
6. `README`에 코드 라이선스와 상표/브랜드 정책을 구분해 적는다.
7. 외부 기여를 받을 때는 `CONTRIBUTING.md`와 DCO 사용 여부를 정한다.

라이선스는 이미 받은 사본에 대해 사후 철회할 수 없다. 나중에 라이선스를 바꾸려면 변경 시점 이후 코드에만 적용하거나, 해당 코드의 모든 저작권자로부터 동의를 받아야 한다. 향후 AGPL + 상용 라이선스의 dual licensing 가능성을 중요하게 생각한다면 외부 기여를 받기 전에 CLA 등 저작권 관리 방식을 법률 검토와 함께 설계해야 한다.

## 공식 참고자료

- [Open Source Initiative: 승인 라이선스와 오픈소스 정의](https://opensource.org/licenses)
- [Open Source Initiative: MIT License](https://opensource.org/license/mit)
- [Choose a License: 주요 라이선스 비교](https://choosealicense.com/licenses/)
- [Mozilla: MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [GNU Project: Why the Affero GPL](https://www.gnu.org/licenses/why-affero-gpl.html)
- [flatnotes MIT License](https://github.com/dullage/flatnotes/blob/develop/LICENSE)
- [SilverBullet 저장소(MIT)](https://github.com/silverbulletmd/silverbullet)
- [Memos MIT License](https://github.com/usememos/memos/blob/main/LICENSE)
- [Trilium AGPL License](https://github.com/TriliumNext/Trilium/blob/main/LICENSE)

이 문서는 법률 자문이 아니다.

