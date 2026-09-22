# 셀프호스팅 노트 앱 4개 배포 사례

조사일: 2026-09-17

## 한눈에 보기

| 프로젝트 | 주 배포 방식 | 영속 데이터 | 컨테이너 포트 | 이미지/아키텍처 | 인증·외부 접속 | 라이선스 |
|---|---|---|---:|---|---|---|
| flatnotes | Docker / Compose, PikaPods | `/data`의 Markdown과 검색 인덱스 | 8080 | Docker Hub 이미지 | none/read-only/password, 2FA 기능 | MIT |
| SilverBullet | 단일 바이너리, Docker / Compose, 데스크톱, PikaPods | 데이터 루트에 Markdown space와 설정 | 3000 | GHCR·Docker Hub, amd64/arm64/armv7 | 외부 접속 전 인증과 TLS 요구 | MIT |
| Memos | Docker / Compose, 단일 바이너리, Kubernetes, 소스 빌드 | `/var/opt/memos`의 DB와 assets 또는 외부 DB/S3 | 5230 | multi-arch stable/version/latest 채널 | 첫 admin 계정, 접근 정책, reverse proxy | MIT |
| Trilium | 데스크톱 릴리스, Docker / Compose, Linux 패키지, Kubernetes | `trilium-data`의 DB와 설정 | 8080 | Docker Hub, amd64/arm64/armv7 | 서버 로그인, reverse proxy/TLS 문서 | AGPL-3.0-or-later |

## 1. flatnotes

### 배포 모델

flatnotes는 네 사례 중 Maek와 가장 비슷하다. 데이터베이스를 주 저장소로 삼지 않고 사용자의 Markdown 파일 디렉터리를 직접 사용한다. 공식 README는 셀프호스팅 시 Docker를 권장하며, Docker Compose 예제도 함께 제공한다. 관리형 선택지로 PikaPods도 연결한다.

공식 예제의 핵심 계약은 다음과 같다.

- 이미지: `dullage/flatnotes:latest`
- 컨테이너 데이터 경로: `/data`
- 포트: `8080`
- 재시작 정책: `unless-stopped`
- `PUID`, `PGID`로 bind mount 파일 소유권 문제 조정
- `FLATNOTES_AUTH_TYPE`, 사용자명, 비밀번호, secret key를 환경변수로 설정

Dockerfile은 Node 기반 프런트엔드 빌더와 Python 런타임을 분리한 multi-stage build다. 런타임 이미지에는 빌드 도구와 프런트엔드 소스 전체를 넣지 않고, 빌드 결과와 서버 런타임만 복사한다. healthcheck도 포함한다.

### 데이터와 보안

`FLATNOTES_PATH`가 노트 디렉터리를 지정하며 Docker 이미지에서는 `/data`가 기본값이다. 인증 모드는 `none`, `read_only`, `password`를 제공한다. 컨테이너 내부에서는 기본적으로 `0.0.0.0:8080`에 바인딩하므로 외부 공개 범위는 Docker 포트 매핑이나 reverse proxy에서 결정한다.

### Maek에 적용할 점

- 사용자가 선택할 수 있는 서버의 전체 파일시스템 대신 **한 개의 명시적 데이터 루트**를 컨테이너 계약으로 삼는다.
- Markdown 원본과 검색/앱 메타데이터를 사용자가 이해할 수 있는 볼륨 안에 둔다.
- UID/GID 대응을 처음부터 문서화한다.
- 로컬 전용이어도 healthcheck를 제공한다.
- 인증을 넣기 전에는 `127.0.0.1` 포트 매핑을 기본 예제로 제시한다.

### 공식 근거

- [flatnotes GitHub README](https://github.com/dullage/flatnotes)
- [flatnotes Dockerfile](https://github.com/dullage/flatnotes/blob/develop/Dockerfile)
- [flatnotes 환경변수 문서](https://github.com/dullage/flatnotes/wiki/Environment-Variables)
- [flatnotes MIT License](https://github.com/dullage/flatnotes/blob/develop/LICENSE)

## 2. SilverBullet

### 배포 모델

SilverBullet은 로컬 실행과 서버 실행을 명시적으로 나눈다. 설치 선택지는 다음과 같다.

- macOS, Linux, Windows, FreeBSD용 단일 서버 바이너리
- Docker 또는 Docker Compose
- 데스크톱 앱
- PikaPods 관리형 호스팅

단일 바이너리는 데이터 폴더를 인자로 받아 기본적으로 `127.0.0.1:3000`에 뜬다. LAN 바인딩은 별도 옵션으로 켜며, 공식 문서는 다른 컴퓨터에서 접근할 경우 인증과 TLS를 먼저 설정하라고 경고한다.

Docker 이미지는 GHCR와 Docker Hub에 게시된다. 공식 Docker 문서는 amd64, arm64, armv7을 지원한다고 설명하고 다음 채널을 분리한다.

- `latest`: 최신 안정 릴리스
- 명시적 버전 태그: 재현 가능한 설치
- `edge`: `main`의 최신 빌드
- `slim`: Chromium/runtime API를 제외한 소형 이미지

Compose가 권장 운영 방식이며 영속 데이터 디렉터리, `SB_USER`, 포트, `restart: unless-stopped`를 한 파일에 둔다. 컨테이너는 데이터 디렉터리 소유자의 UID/GID를 감지하거나 `PUID`/`PGID`로 재정의한다. 이미지에는 healthcheck와 `tini` 기반 프로세스 처리가 들어 있다.

### 데이터와 업그레이드

페이지는 Markdown 파일로 유지된다. 바이너리 문서는 서버 실행 파일 자체의 stable/edge 업그레이드 명령을 제공하고, Docker 문서는 image pull 후 컨테이너 재생성을 안내한다.

공식 문서의 최신 Docker 데이터 루트 설명과 저장소 안 일부 오래된 실행 예제에는 `/data`와 `/space` 표기가 함께 보인다. 이는 Maek에서도 **버전별 문서와 이미지의 mount contract를 한 곳에서 생성·검증해야 한다**는 교훈이다.

### Maek에 적용할 점

- 로컬 모드는 loopback 기본, 서버 모드는 명시적 opt-in으로 분리한다.
- stable, edge, versioned tag의 의미를 문서로 고정한다.
- 소형 이미지가 필요하면 기능 차이를 태그 이름과 릴리스 문서에서 명확히 드러낸다.
- 장기적으로 “프런트엔드를 포함한 단일 실행 파일”은 Docker가 부담스러운 사용자를 위한 좋은 2차 배포 방식이다.

### 공식 근거

- [SilverBullet GitHub 저장소](https://github.com/silverbulletmd/silverbullet)
- [공식 설치 개요](https://edge.silverbullet.md/Install)
- [공식 단일 바이너리 설치](https://edge.silverbullet.md/Install/Binary)
- [공식 Docker 설치](https://edge.silverbullet.md/Install/Docker)
- [SilverBullet Dockerfile](https://github.com/silverbulletmd/silverbullet/blob/main/Dockerfile)

## 3. Memos

### 배포 모델

Memos는 배포 선택지가 가장 체계적이다.

- Docker
- Docker Compose
- Linux/macOS/Windows용 바이너리
- Kubernetes
- 소스 빌드
- reverse proxy 배포

공식 quick start는 단일 컨테이너와 SQLite를 사용한다.

- 이미지: `neosmemo/memos:stable`
- 포트: `5230`
- 영속 경로: `/var/opt/memos`
- 호스트 예시: `~/.memos`
- 재시작 정책: `unless-stopped`

이미지는 `linux/amd64`, `linux/arm64`, `linux/arm/v7` multi-arch manifest를 제공한다. 태그 정책도 운영 목적별로 구분한다.

- `stable`: 운영 기본값
- `0.30.0` 같은 버전 태그: 완전 고정
- `0.30` 같은 minor 태그: 해당 계열 최신 patch
- `latest`: 개발 지향

컨테이너는 기본적으로 non-root UID/GID로 실행하고, 필요할 경우 환경변수로 조정한다. 환경변수와 CLI flag를 대응시키며 `_FILE` 접미사를 통한 Docker secret 입력도 지원한다.

### 데이터, 계정, 운영

기본 저장소는 SQLite이며 데이터 디렉터리에 DB와 로컬 attachment가 함께 들어간다. 필요하면 MySQL/PostgreSQL과 S3 호환 스토리지로 확장한다. 첫 사용자가 admin이 되고 접근 정책과 가입 정책을 설정한다.

운영 문서는 백업 대상을 DB, attachment, 배포 설정의 하나의 복구 세트로 본다. SQLite migration 후 단순 바이너리 downgrade만으로 복구되지 않을 수 있으므로 업그레이드 전 백업과 실제 restore 검증을 요구한다.

### Maek에 적용할 점

- README의 한 줄 quick start와 별개로 배포·업그레이드·백업 문서를 독립시킨다.
- `stable`, 버전 고정, 개발 빌드의 의미를 섞지 않는다.
- 첫 릴리스부터 multi-arch 이미지를 만들고 non-root 실행을 검증한다.
- 메모 파일만이 아니라 `.maek/` 메타데이터와 배포 설정까지 백업 범위로 명시한다.
- 스키마 변경이 생기면 migration과 rollback 정책을 릴리스 노트에 넣는다.

### 공식 근거

- [Memos GitHub 저장소](https://github.com/usememos/memos)
- [공식 배포 개요](https://usememos.com/docs/deploy)
- [공식 Docker 문서](https://usememos.com/docs/deploy/docker)
- [공식 Docker Compose 문서](https://usememos.com/docs/deploy/docker-compose)
- [공식 바이너리 문서](https://usememos.com/docs/deploy/binary)
- [공식 백업·복원 문서](https://usememos.com/docs/operations/backup-restore)
- [Memos MIT License](https://github.com/usememos/memos/blob/main/LICENSE)

## 4. Trilium

### 배포 모델

Trilium은 데스크톱 앱과 셀프호스팅 서버를 모두 공식 제품 경로로 제공한다. 서버 쪽은 Docker Compose, raw Docker, Linux 패키지, 수동 설치, Kubernetes/Helm을 지원한다.

Docker의 주요 계약은 다음과 같다.

- 이미지: `triliumnext/trilium:<version>`
- 포트: `8080`
- 영속 경로: `/home/node/trilium-data`
- 호스트 기본 예시: `~/trilium-data`
- amd64, arm64, armv7 이미지
- `USER_UID`, `USER_GID`로 볼륨 권한 조정
- 일반 이미지와 별도 rootless 이미지 제공

공식 문서는 `latest`가 새 minor로 자동 이동해 sync나 데이터 호환 문제를 만들 수 있다며 버전 태그 고정을 권한다. 로컬 전용 예시는 `127.0.0.1:8080:8080`으로 포트를 묶고, 외부 공개와 reverse proxy 설정은 별도로 다룬다.

Trilium 데이터의 중심은 Markdown 디렉터리가 아니라 애플리케이션 DB다. 이 점은 Maek와 다르지만, 데스크톱과 서버가 동일한 제품 경험을 공유하고 데이터 스키마 호환성을 릴리스의 일부로 관리한다는 점이 중요하다.

### 라이선스 선택

Trilium은 `AGPL-3.0-or-later`를 사용한다. 수정 버전을 네트워크 서비스로 제공할 때 그 사용자에게 대응 소스를 제공하게 만드는 강한 copyleft가 셀프호스팅 서버 제품에서 실제로 사용되는 사례다.

### Maek에 적용할 점

- 데스크톱 런처와 서버 이미지를 별도 설치 경로로 제공하되 데이터 형식은 동일하게 유지한다.
- `latest`보다 명시적 버전 태그를 문서 기본값으로 삼는다.
- rootless 이미지를 처음부터 만들거나, 최소한 런타임 프로세스가 root가 아닌지 보장한다.
- 데이터 포맷 변경 시 데스크톱/서버 호환 범위를 릴리스 노트에 명시한다.

### 공식 근거

- [Trilium GitHub 저장소와 README](https://github.com/TriliumNext/Trilium)
- [공식 서버 설치 개요](https://docs.triliumnotes.org/user-guide/setup/server/installation)
- [공식 Docker 설치 문서](https://github.com/TriliumNext/Trilium/blob/main/docs/User%20Guide/User%20Guide/Installation%20%26%20Setup/Server%20Installation/1.%20Installing%20the%20server/Using%20Docker.md)
- [공식 docker-compose.yml](https://github.com/TriliumNext/Trilium/blob/main/docker-compose.yml)
- [공식 Kubernetes/Helm 문서](https://docs.triliumnotes.org/user-guide/setup/server/installation/kubernetes)
- [Trilium AGPL License](https://github.com/TriliumNext/Trilium/blob/main/LICENSE)

## 사례에서 공통으로 확인된 패턴

1. **애플리케이션과 데이터의 생명주기를 분리한다.** 컨테이너는 교체 가능하고 데이터는 명시적 볼륨에 남는다.
2. **Compose를 복사 가능한 운영 계약으로 제공한다.** 포트, 볼륨, 환경변수, restart policy가 코드 리뷰 가능한 한 파일에 있다.
3. **버전 태그를 제공한다.** 운영자는 upgrade 시점을 선택하고 rollback 전 백업을 만들 수 있다.
4. **amd64와 arm64를 함께 지원한다.** 개인 서버와 Apple Silicon/Raspberry Pi 사용자를 모두 커버한다.
5. **볼륨 권한을 제품 문제로 취급한다.** UID/GID, non-root 실행, 디렉터리 소유권을 문서화한다.
6. **외부 접속은 별도 보안 모드다.** 인증, TLS, reverse proxy, 신뢰할 Host/Origin 경계를 다룬다.
7. **업그레이드보다 복구 가능성이 우선이다.** 어떤 파일을 백업해야 하는지와 migration 위험을 문서화한다.

