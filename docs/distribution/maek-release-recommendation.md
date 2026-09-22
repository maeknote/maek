# Maek 공개 배포 권고안

조사일: 2026-09-17

## 현재 상태

Maek는 이미 production UI를 빌드해 Fastify가 정적 파일과 API를 함께 제공할 수 있다.

```sh
npm run build
npm start
```

그러나 현재의 production 모드는 **같은 Mac에서 한 사용자가 실행하는 localhost 앱**을 전제로 한다.

- 서버가 `127.0.0.1`에만 listen한다.
- Host는 `localhost` 또는 `127.0.0.1`만 허용한다.
- API Origin도 동일 origin만 허용한다.
- `localhost` 요청의 API 접근을 차단해 artifact preview origin과 앱 origin을 분리한다.
- 클라이언트 일부 URL 생성 로직에 `localhost` 또는 `127.0.0.1` 가정이 있다.
- 폴더 picker와 휴지통 이동이 macOS API/AppleScript에 의존한다.
- `/api/workspaces/open`은 사용자가 보낸 절대 경로를 등록한다.
- production 서버도 TypeScript를 `tsx`로 직접 실행하며 `tsx`는 devDependency다.
- 루트에 `LICENSE`, Dockerfile, Compose, image release workflow가 없다.
- `package.json`은 `private: true`다. 이는 GitHub 공개에는 문제가 없지만 npm package publish는 막는다.

현재의 Host/Origin 검사는 로컬 앱에는 좋은 방어선이지만 Docker나 LAN 모드를 단순히 `0.0.0.0`으로 바꾸면 동작하지 않으며, 그렇게 우회해서도 안 된다.

## 권장 제품 경계

첫 공개 버전은 실행 모드를 두 개로 정의한다.

### Local mode

- 기본 listen: `127.0.0.1`
- 폴더 picker와 절대 경로 입력 허용
- 인증 없음
- 현재 macOS 런처 사용 가능
- 같은 컴퓨터의 브라우저만 지원

### Container workspace mode

- 컨테이너 내부 listen: `0.0.0.0`
- workspace root: 환경변수로 지정된 `/workspace` 하나
- startup 시 해당 workspace를 자동 등록
- picker 비활성화
- 임의 절대 경로 입력과 다른 workspace 등록 비활성화
- 호스트 포트 기본 예제: `127.0.0.1:3000:3000`
- 외부 네트워크 공개는 지원 범위 밖이라고 명시
- Linux에서 휴지통 기능은 안전한 대체 구현 전까지 비활성화하거나 명시적 오류 표시

이 구분을 두지 않으면 로컬 편의를 위해 만든 파일 API가 서버 환경에서 호스트 파일 탐색 API가 될 수 있다.

## 권장 Compose 계약

최종 사용자 문서에는 버전 태그를 고정한 다음 형태를 기본으로 제시한다.

```yaml
services:
  maek:
    image: ghcr.io/OWNER/maek:v1.0.0
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      MAEK_MODE: container
      MAEK_HOST: 0.0.0.0
      MAEK_PORT: 3000
      MAEK_WORKSPACE: /workspace
    volumes:
      - ./workspace:/workspace
```

여기서 핵심은 `MAEK_HOST=0.0.0.0` 자체가 아니라 Docker가 호스트 쪽 포트를 `127.0.0.1`에만 노출하고, 애플리케이션이 `/workspace` 밖을 등록하지 못하게 하는 것이다.

## 구현 순서

### 0단계: 공개 가능성 확인

- Maek Note 이식 코드와 디자인의 저작권 확인
- 아이콘·자산 출처 확인
- Git 이력의 secret과 개인 데이터 검사
- MIT 또는 AGPL 최종 결정

이 단계가 끝나기 전에는 저장소를 public으로 바꾸지 않는다.

### 1단계: headless 실행 경계

- `MAEK_MODE`, `MAEK_HOST`, `MAEK_PORT`, `MAEK_WORKSPACE` 설정 도입
- container mode에서는 고정 workspace를 시작 시 등록
- container mode에서 `/api/workspaces/open`과 `/api/workspaces/pick`의 권한 축소
- 클라이언트 URL을 hard-coded hostname 대신 현재 origin 기반 상대 URL로 변경
- Local mode의 artifact preview origin 격리가 유지되는지 테스트
- Linux에서 macOS 전용 동작을 UI capability로 표시
- `/healthz`처럼 파일을 수정하지 않는 health endpoint 추가

### 2단계: production artifact

현재 `npm start`는 `tsx`로 TypeScript 서버를 실행한다. production 이미지에서 devDependency 전체를 유지하지 않으려면 다음 중 하나를 선택해야 한다.

1. 서버를 JavaScript로 compile/bundle하고 runtime dependency만 설치한다. **권장**
2. `tsx`를 runtime dependency로 옮기고 TypeScript 소스를 이미지에 넣는다. 초기 구현은 쉽지만 이미지와 공격면이 커진다.

Dockerfile은 glibc 기반 Node 24 slim 이미지를 우선 권한다. `better-sqlite3` 같은 native addon은 Alpine/musl과 CPU architecture 조합에서 빌드·prebuild 문제가 생길 수 있기 때문이다.

권장 multi-stage 구조:

1. dependency/build stage에서 `npm ci`, patch 적용, UI와 서버 build
2. runtime stage에 production dependency, `dist`, server build 결과, 필요한 resource만 복사
3. non-root user로 실행
4. healthcheck 추가
5. `.dockerignore`로 `.git`, `node_modules`, 로컬 workspace, 테스트 산출물 제외

### 3단계: 릴리스 자동화

- PR: typecheck, unit test, build, container smoke test
- tag: `linux/amd64`, `linux/arm64` buildx 이미지 생성
- GHCR 태그: 정확한 버전, major/minor alias, commit SHA
- 운영 문서 기본값: 정확한 `vX.Y.Z`
- `latest`를 제공한다면 의미를 stable alias로 고정
- container image에서 새 노트 작성 → 재시작 → 데이터 유지 smoke test
- read-only volume, 잘못된 권한, workspace 밖 symlink 거부 테스트
- SBOM과 provenance attestation 생성 검토

### 4단계: 공개 저장소 기본 문서

- `LICENSE`
- 설치 중심 `README.md`
- `SECURITY.md`: 취약점 비공개 제보 경로, 지원 버전
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `CHANGELOG.md` 또는 GitHub Releases 기반 정책
- 백업/복원 문서
- 업그레이드/rollback 문서
- 외부 공개가 기본 지원이 아니라는 security note
- `THIRD_PARTY_NOTICES`

### 5단계: 후속 배포

Docker 릴리스가 안정화된 뒤 다음을 검토한다.

- macOS 서명·notarization된 `.app`
- Homebrew formula/cask
- Windows/Linux 단일 실행 파일 또는 데스크톱 wrapper
- 인증을 포함한 LAN/server mode
- NAS/홈서버 앱 카탈로그

## 인증 없는 첫 릴리스에서 지켜야 할 것

인증이 없는 동안 아래 배포는 공식 예제로 제공하지 않는다.

- `ports: ["3000:3000"]`처럼 모든 인터페이스에 직접 노출
- 공인 IP에서 바로 실행
- 인증 없는 reverse proxy 또는 tunnel 연결
- 컨테이너에 홈 디렉터리 전체나 `/` 마운트
- Docker socket 마운트

원격 접근을 향후 지원하려면 최소한 사용자 인증, session cookie 보안 속성, CSRF 정책, rate limiting, trusted proxy 설정, TLS 문서, websocket/SSE proxy 검증, admin bootstrap, password reset 및 보안 업데이트 정책이 필요하다.

## 데이터와 백업 계약

Maek의 장점은 Markdown 파일이 그대로 원본이라는 점이다. 공개 문서는 백업 범위를 다음처럼 정의해야 한다.

```text
workspace/
  사용자 Markdown 및 첨부 파일
  .maek/
    config.json
    tabs.json
    database.sqlite
    assets/
    sessions/
```

사용자 파일과 `.maek/`를 함께 백업해야 완전한 복원이 된다. SQLite 파일이 열려 있는 동안 단순 복사하는 방법은 일관성을 보장하지 않을 수 있으므로, 서버를 중지한 offline backup 또는 SQLite backup API를 이용한 절차가 필요하다. 복원 테스트를 release checklist에 포함한다.

## 첫 공개 릴리스의 완료 조건

- 새 컴퓨터에서 README의 Compose 명령만으로 10분 안에 실행 가능
- amd64와 arm64 모두 동일 테스트 통과
- 컨테이너가 `/workspace` 밖을 열거나 수정할 수 없음
- 컨테이너 교체 후 파일, `.maek` 상태, DB가 유지됨
- 기본 Compose로 LAN의 다른 기기에서는 접근할 수 없음
- local mode의 기존 macOS 기능이 회귀하지 않음
- LICENSE와 third-party notice가 이미지·소스 릴리스에 포함됨
- clean checkout에서 typecheck, test, build, container smoke test 통과
- 백업 후 실제 복원 테스트 통과

## 최종 권고

첫 목표는 “어디서나 접속 가능한 서버”가 아니라 **자기 파일을 자기 컴퓨터에서 다루는 안전한 오픈소스 localhost 도구**로 잡는 것이 좋다. 이 범위라면 Maek의 기존 구조를 살리면서 Docker Compose라는 보편적인 설치 경로를 추가할 수 있다.

권장 순서는 다음과 같다.

1. 권리 확인과 MIT 채택
2. 단일 workspace container mode 구현
3. Docker/Compose와 GHCR versioned release
4. 백업·업그레이드·보안 문서
5. 이후 인증을 갖춘 server mode 또는 서명된 데스크톱 앱

