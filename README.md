# IntentPatch

[![CI](https://github.com/xx2xxjaeil/intent-patch/actions/workflows/ci.yml/badge.svg)](https://github.com/xx2xxjaeil/intent-patch/actions/workflows/ci.yml)

> AI 코딩 에이전트가 만든 변경을 근거 중심으로 분석하는 오픈소스 도구

Codex, Claude Code, Cursor 같은 AI 코딩 에이전트는 짧은 요청만으로 여러 파일을 빠르게
수정합니다. 하지만 변경된 파일이 많아질수록 다음 질문에 답하기 어려워집니다.

- 요청한 범위보다 많은 파일을 수정하지 않았는가?
- 기존 코드를 재사용하지 않고 비슷한 로직을 새로 만들지 않았는가?
- 불필요한 라이브러리나 추상화를 추가하지 않았는가?
- 이번 변경이 다른 모듈에 어디까지 영향을 주는가?
- 중요한 동작에 대한 테스트가 함께 추가되었는가?

IntentPatch는 이러한 질문에 답하기 위해 **Git diff, 정적 분석, 의존 관계 분석**을 결합합니다.
LLM 없이도 재현 가능한 분석을 제공하고, AI 설명 기능은 선택적으로 결합하는 것을 목표로
합니다.

## 프로젝트가 지향하는 결과

```text
IntentPatch Change Report

Target               HEAD → working tree
Files changed        12
Lines                +438 / -51
Direct dependents    2
Transitive impact    4
Tests changed        3
Missing test changes 1
New dependencies     2
Risky API changes    1

Impacted files

→  direct              src/api/delete-user.ts
   changed: src/lib/auth.ts
→  transitive · 2 hops src/app.ts
   changed: src/lib/auth.ts

Potential issues

HIGH    기존 인증 로직과 유사한 구현 발견
MEDIUM  요청과 관련성이 낮아 보이는 파일 4개 변경
LOW     구현체가 하나뿐인 추상화 추가
```

분석 결과는 단순한 경고 문구가 아니라 관련 파일, 규칙 ID, 판단 근거와 함께 제공하는 것을
원칙으로 합니다.

## 현재 구현된 기능

현재 버전은 Git 변경사항 수집, 루트 `package.json`의 직접 dependency 분석, TypeScript
최상위 심볼 변경 분석, import graph 기반 영향 범위와 테스트 동반 변경 분석을 제공합니다.

- `HEAD`와 현재 working tree 비교
- 두 Git reference 또는 브랜치 비교
- 추가, 수정, 삭제, 이름 변경 등 파일 상태 분류
- 파일별 추가·삭제 라인 수 계산
- binary 파일 구분
- working tree 분석 시 untracked 파일 포함
- 터미널용 텍스트 보고서
- 후속 도구 연동을 위한 JSON 보고서
- 요약 카드, finding, 테스트 신호와 영향 그래프를 담은 단일 HTML 보고서
- 외부 CDN이나 JavaScript dependency가 필요 없는 인라인 CSS·SVG 시각화
- production·development dependency 추가 탐지
- dependency 삭제, 버전 변경, 섹션 이동 탐지
- 잘못된 `package.json`을 예외 대신 근거가 포함된 finding으로 보고
- finding 심각도(`high`, `medium`, `low`) 집계
- CI 품질 게이트를 위한 `--fail-on` 종료 코드
- `.ts`·`.tsx` 파일의 최상위 함수·클래스·인터페이스·타입 별칭 추출
- 심볼 추가·수정·삭제 탐지와 소스 위치 표시
- 직접 `export`된 선언과 내부 선언을 구분해 심볼 변경 근거에 보존
- 공개 심볼 삭제와 `export` 해제를 호환성 위험 `high` finding으로 탐지
- rename 전후 파일 경로를 사용한 심볼 비교
- 구문 오류가 있는 파일을 누락시키지 않고 분석 불가 근거로 보고
- `.ts`·`.tsx` 파일의 상대 경로 정적 import와 re-export 관계 수집
- `.js`·`.jsx`·`.mjs`·`.cjs` specifier를 대응하는 TypeScript 소스로 해석
- 변경 모듈을 import하는 직접 의존자와 여러 단계를 거친 간접 영향 파일 계산
- 해결하지 못한 상대 import와 읽기·파싱 실패를 분석 근거로 보존
- working tree의 tracked·untracked 파일 또는 지정한 head ref를 동일한 결과점에서 분석
- `.intentpatch.json`에 요청 의도, 예상 경로, 허용 경로와 변경량 예산 선언
- 예상·허용 패턴을 벗어난 변경 파일을 파일별 `medium` finding으로 탐지
- 변경 파일 수와 측정 라인 예산 초과를 수치 근거가 있는 `low` finding으로 탐지
- Contract가 지정한 소스·테스트 경로를 분류하고 파일명 기준으로 관련 변경 연결
- 테스트 변경 수와 추가·삭제 수를 별도의 분석 사실로 집계
- 관련 테스트 변경이 없는 소스 파일을 `medium` finding으로 탐지
- `*`, `**`, `?` 기반의 저장소 상대 경로 패턴 지원

아직 re-export와 함수 시그니처 호환성, lockfile의 전이 dependency 분석, path alias 해석,
AI 리뷰 기능은 구현되지 않았습니다.

## 실행 방법

Node.js 20 이상과 Git이 필요합니다.

```bash
npm install
npm run build
```

현재 저장소의 working tree를 분석합니다.

```bash
node dist/presentation/cli/main.js analyze
```

다른 Git 저장소를 분석할 수도 있습니다.

```bash
node dist/presentation/cli/main.js analyze --cwd /path/to/repository
```

두 브랜치를 비교합니다. 내부적으로 merge base 기준의 변경사항을 분석합니다.

```bash
node dist/presentation/cli/main.js analyze \
  --cwd /path/to/repository \
  --base main \
  --head feature/account-deletion
```

JSON으로 출력합니다.

```bash
node dist/presentation/cli/main.js analyze --json
```

브라우저에서 볼 수 있는 HTML 보고서를 파일로 생성합니다.

```bash
node dist/presentation/cli/main.js analyze \
  --format html \
  --output intentpatch-report.html
```

HTML 파일에는 스타일과 dependency 영향 SVG 그래프가 모두 포함되므로 별도 서버나 API key 없이
바로 열 수 있습니다. `--output`은 텍스트와 JSON 형식에도 사용할 수 있으며 상대 경로는
IntentPatch를 실행한 현재 디렉터리를 기준으로 해석합니다. 기존 `--json`은
`--format json`의 단축 옵션입니다.

### Change Contract로 요청 범위 검사

분석할 저장소의 `.intentpatch.json`에 이번 요청의 기대 범위를 선언할 수 있습니다.

```json
{
  "intent": "회원 탈퇴 기능 구현",
  "scope": {
    "include": ["src/user/**", "tests/user/**"],
    "allow": ["package.json", "package-lock.json"],
    "maxFiles": 8,
    "maxLines": 300
  },
  "tests": {
    "requireFor": ["src/**/*.ts", "src/**/*.tsx"],
    "include": ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    "exclude": ["src/**/*.d.ts"]
  }
}
```

- `include`: 요청 수행 중 변경될 것으로 예상한 경로
- `allow`: 설정이나 lockfile처럼 함께 변경되어도 허용하는 예외 경로
- `maxFiles`: 변경 파일 수의 상한
- `maxLines`: 측정 가능한 추가·삭제 라인 합의 상한
- `tests.requireFor`: 테스트 동반 변경을 확인할 소스 경로
- `tests.include`: 테스트 파일로 분류할 경로
- `tests.exclude`: 생성 파일이나 선언 파일처럼 검사에서 제외할 소스 경로

테스트 연결은 결정적인 결과를 위해 파일명을 사용합니다. 예를 들어 `src/user.ts`는
`tests/user.test.ts`, `user.spec.ts`, `user.integration.test.ts` 같은 변경과 연결됩니다.

기본 파일 대신 별도 계약을 사용하려면 `--config`를 지정합니다. 상대 경로는 `--cwd`를 기준으로
해석합니다.

```bash
node dist/presentation/cli/main.js analyze \
  --cwd /path/to/repository \
  --config contracts/delete-user.json
```

복사해서 시작할 수 있는 설정은 [`.intentpatch.example.json`](./.intentpatch.example.json)에
있습니다. Contract가 없으면 기존 분석은 그대로 실행되고 scope 규칙만 비활성화됩니다.

지정한 심각도 이상의 finding이 있으면 보고서를 출력한 뒤 종료 코드 `1`을 반환합니다.

```bash
node dist/presentation/cli/main.js analyze --fail-on medium
```

`medium`은 `medium`과 `high` finding에 반응하며, `low`를 지정하면 모든 finding을 품질
게이트 대상으로 취급합니다. 잘못된 CLI 사용은 종료 코드 `2`를 반환합니다.

dependency 변경과 코드 영향 범위를 다음과 같이 근거와 함께 출력합니다.

```text
IntentPatch Change Report

Files changed        2
Changed symbols      2
Import edges         18
Direct dependents    1
Transitive impact    2
Tests changed        1
Tests added          0
Missing test changes 1
New dependencies     1
Risky API changes    1
Findings             4

Changed symbols

M  Class         UserService                  src/user/service.ts:12
A  Function      deleteUser                   src/user/service.ts:48

Impacted files

→  direct              src/api/delete-user.ts
   changed: src/user/service.ts
→  transitive · 2 hops src/app.ts
   changed: src/user/service.ts

Potential issues

HIGH    Public export removed
        src/user/service.ts · api/export-removed
        The function deleteUser is no longer exported.

MEDIUM  New production dependency
        package.json · dependency/new-production
        dayjs@^1.11.0 was added to dependencies.

MEDIUM  Change outside expected scope
        src/payment/billing.ts · scope/outside-expected-path
        src/payment/billing.ts does not match any expected or allowed path pattern.

MEDIUM  Source change without matching test change
        src/payment/billing.ts · tests/missing-related-change
        src/payment/billing.ts changed without a changed test sharing the same basename.
```

개발 중에는 빌드 없이 실행할 수 있습니다.

```bash
npm run dev -- analyze --cwd /path/to/repository
```

## 아키텍처

기능이 늘어나도 Git, UI, 분석 규칙이 서로 강하게 결합되지 않도록 클린 아키텍처의 의존성
방향을 적용했습니다.

```text
presentation ───────▶ application ───────▶ domain
      │                     ▲
      └──▶ infrastructure ──┘
```

| 계층 | 책임 |
| --- | --- |
| `domain` | 변경 파일, Change Contract, finding, 심볼 변경, dependency 영향 등 핵심 모델 |
| `application` | 분석 유스케이스, 규칙 엔진, 심볼·영향 계산과 외부 데이터 포트 |
| `infrastructure` | Git 명령·diff 파싱·프로젝트 파일 공급·TypeScript AST 파싱 |
| `presentation` | CLI 인자 처리, 의존성 조립, 텍스트·JSON·HTML 출력 |

하위 계층이 외부 구현을 참조하지 않도록 아키텍처 테스트가 import 방향을 검사합니다.
구현상의 주요 판단과 확장 지점은 [상세 아키텍처 문서](./docs/architecture.md)에서 설명합니다.

## 설계 원칙

- **Deterministic first:** 핵심 분석은 동일한 입력에 동일한 결과를 반환합니다.
- **Evidence over claims:** 확실하지 않은 판단을 사실처럼 단정하지 않습니다.
- **LLM optional:** AI 연결 없이도 기본 분석 기능을 사용할 수 있어야 합니다.
- **Dependency minimalism:** 편의를 위한 라이브러리를 무분별하게 추가하지 않습니다.
- **Explicit boundaries:** 도메인 로직과 Git·CLI 같은 외부 기술을 분리합니다.

## 테스트와 품질 검사

```bash
npm run check
```

위 명령은 다음 검사를 순서대로 실행합니다.

- 엄격한 TypeScript 타입 검사
- Biome 린트 및 포맷 검사
- 도메인과 유스케이스 단위 테스트
- 실제 임시 Git 저장소를 사용하는 통합 테스트
- 계층 간 의존 방향을 검증하는 아키텍처 테스트

프로덕션 빌드만 확인하려면 다음 명령을 사용합니다.

```bash
npm run build
```

## 로드맵

1. ✅ `package.json` 직접 dependency 변경 탐지와 규칙 엔진
2. ✅ TypeScript AST 기반 함수·클래스·인터페이스·타입 변경 분석
3. ✅ 상대 경로 정적 import graph 기반 변경 영향 범위 계산
4. ✅ Change Contract 기반 예상 범위 이탈과 변경량 예산 탐지
5. ✅ Contract 기반 관련 테스트 변경 누락 탐지
6. lockfile과 workspace를 고려한 package manager adapter
7. ✅ 직접 export된 공개 심볼 삭제와 export 해제 탐지
8. ✅ 단일 HTML 대시보드와 SVG 기반 dependency 영향 그래프
9. re-export·함수 시그니처 호환성과 기존 코드 중복 가능성 탐지
10. GitHub Action 및 Codex·Claude Code·Cursor adapter
11. 근거 기반 결과에 대한 선택적 LLM 설명

## 현재 제한사항

- 분석 대상은 최소 한 번 이상 커밋된 Git 저장소여야 합니다.
- untracked symbolic link는 안전을 위해 내용을 읽지 않습니다.
- 10 MiB를 초과하는 untracked 파일은 라인 수를 측정하지 않습니다.
- dependency 분석은 저장소 루트의 npm `package.json`에 선언된 `dependencies`와
  `devDependencies`를 대상으로 합니다.
- lockfile의 전이 dependency, workspace package, 코드에서의 실제 사용 여부는 아직 분석하지 않습니다.
- 심볼 분석은 `.ts`와 `.tsx`의 이름이 있는 최상위 함수, 클래스, 인터페이스, 타입
  별칭만 지원합니다.
- 공개 API 규칙은 선언에 직접 붙은 `export` modifier만 확인합니다. `export { name }`,
  `export *`, package `exports`, 익명 default export와 함수 시그니처 호환성은 아직 해석하지 않습니다.
- 메서드, 변수 선언, enum, 중첩 선언, JavaScript 파일은 아직 심볼 분석 대상이 아닙니다.
- 선언 내부의 포맷이나 주석 변경도 심볼 수정으로 집계될 수 있습니다.
- 영향 분석은 `.ts`·`.tsx` 파일의 상대 경로 정적 `import`, side-effect import,
  `export ... from`, `import = require()`를 대상으로 합니다.
- 외부 package import는 그래프에서 제외하며 path alias, dynamic `import()`, 일반 `require()`는
  아직 해석하지 않습니다.
- 영향 그래프는 비교 결과점(working tree 또는 head ref)의 파일을 기준으로 만듭니다. 따라서
  삭제된 모듈을 가리키던 과거 import의 영향은 현재 단계에서 계산할 수 없습니다.
- 영향 분석용 소스 파일은 파일당 1 MiB로 제한하며, symbolic link는 읽지 않습니다.
- IntentPatch는 자연어 intent만으로 예상 경로를 추측하지 않습니다. 범위 판단은 Contract에 명시한
  `include`와 `allow`를 기준으로 수행합니다.
- 경로 패턴은 저장소 상대 경로와 `*`, `**`, `?`만 지원합니다. 부정 패턴과 brace 확장은 아직
  지원하지 않습니다.
- `maxLines`는 측정 가능한 텍스트 파일의 추가·삭제 라인만 합산합니다. Binary와 측정 불가 파일을
  0줄이라고 간주하지 않지만, 해당 파일의 크기를 라인 예산에 포함하지도 않습니다.
- 테스트 분석은 실행 결과나 코드 커버리지를 측정하지 않고 Contract에 지정된 변경 파일만
  비교합니다.
- 관련 테스트는 현재 소스와 테스트의 파일명이 같은지로 판단하므로 이름이 다른 통합 테스트나
  하나의 테스트가 여러 소스를 검증하는 관계는 자동으로 연결하지 못합니다.
- HTML 영향 그래프는 변경 모듈과 영향 파일을 결정적인 두 열 레이아웃으로 표시합니다. 노드 이동,
  확대·축소와 필터링을 제공하는 대화형 웹 UI는 아직 구현하지 않았습니다.

## 라이선스

[MIT](./LICENSE)
