# Release Workflow

이 문서는 Claude Cockpit의 릴리즈/브랜치/버전 정책을 정의합니다.

## 브랜치 모델

- **`main`** — 트렁크. 모든 신규 개발(feature/fix/refactor)은 main에 직접 또는 PR로 머지됩니다.
- **`release/vX.Y.Z`** — 각 정식 릴리즈 시점의 스냅샷 브랜치. 해당 버전의 hotfix 후보 라인.
- **태그 `vX.Y.Z`** — 릴리즈 시점에 해당 release 브랜치 HEAD에 부여.

## 버전 규칙 (SemVer)

`MAJOR.MINOR.PATCH`

- **MAJOR**: 호환성 깨지는 변경 (API 시그니처, 저장 포맷 등)
- **MINOR**: 신규 기능, 호환성 유지
- **PATCH**: 버그 수정, 보안 hotfix

베타는 `vX.Y.Z-beta` 접미사. 예: `v1.0.9-beta`.

## 정상 릴리즈 프로세스

`main`에서 다음 정식 릴리즈를 컷할 때:

```bash
# 1) main이 릴리즈 가능한 상태인지 확인
git checkout main && git pull --ff-only

# 2) release 브랜치 생성
git checkout -b release/v1.2.0

# 3) 푸시
git push -u origin release/v1.2.0

# 4) 태그 부여
git tag -a v1.2.0 -m "v1.2.0: <요약>"
git push origin v1.2.0
```

이후 `main`에서 다음 사이클(v1.3.0 후보) 개발을 계속 진행합니다.

## Hotfix 프로세스 (보안/긴급 버그)

이미 릴리즈된 버전(`vX.Y.Z`)의 사용자에게 수정사항을 제공해야 할 때:

```bash
# 1) 해당 release 브랜치에서 작업 시작
git checkout release/v1.1.0 && git pull --ff-only

# 2) 수정 적용 (cherry-pick 또는 직접 패치)
#    - 가능하면 main의 커밋을 cherry-pick
#    - 충돌 또는 코드베이스 차이가 크면 직접 패치
git cherry-pick <main의 hotfix 커밋> ...

# 3) 푸시 + PATCH 버전 태그
git push origin release/v1.1.0
git tag -a v1.1.1 -m "v1.1.1: security hotfix - <요약>"
git push origin v1.1.1

# 4) main에도 동일 변경이 반영되어 있는지 확인
#    - main이 이미 포함하면 끝
#    - 아니면 main에도 적용
```

## 커밋 메시지 컨벤션

`type: 한글 요약` 형식. 가능한 type:

- `feat:` — 신규 기능
- `fix:` — 버그 수정
- `refactor:` — 동작 변경 없는 구조 개선
- `security:` — 보안 패치
- `remove:` — 삭제
- `docs:` — 문서

본문에는 변경 의도와 영향 범위를 간결히 적습니다.

## 단위 커밋 원칙

- 한 커밋 = 한 논리적 변경. 무관한 변경을 한 커밋에 섞지 않습니다.
- 의존성 있는 변경은 의존받는 쪽 먼저 커밋해 각 커밋이 단독 빌드되도록 합니다.

## CI

`.github/workflows/ci.yml`이 다음을 검증합니다:

- 백엔드 모듈 import 스모크 테스트
- `tests/` 디렉터리의 pytest 실행

PR이 main 또는 `release/*`에 들어가기 전에 통과해야 합니다.
