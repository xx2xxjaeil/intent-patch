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
New dependencies     2
Tests added          3

Potential issues

HIGH    기존 인증 로직과 유사한 구현 발견
MEDIUM  요청과 관련성이 낮아 보이는 파일 4개 변경
LOW     구현체가 하나뿐인 추상화 추가
```

분석 결과는 단순한 경고 문구가 아니라 관련 파일, 규칙 ID, 판단 근거와 함께 제공하는 것을
원칙으로 합니다.

## 현재 구현된 기능

현재 버전은 첫 번째 수직 기능으로 Git 변경사항 수집과 요약을 제공합니다.

- `HEAD`와 현재 working tree 비교
- 두 Git reference 또는 브랜치 비교
- 추가, 수정, 삭제, 이름 변경 등 파일 상태 분류
- 파일별 추가·삭제 라인 수 계산
- binary 파일 구분
- working tree 분석 시 untracked 파일 포함
- 터미널용 텍스트 보고서
- 후속 도구 연동을 위한 JSON 보고서

아직 dependency 분석, AST 분석, 영향 범위 그래프, AI 리뷰 기능은 구현되지 않았습니다.

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
| `domain` | 변경 파일, 라인 변화량, 분석 보고서 등 핵심 모델 |
| `application` | 분석 유스케이스와 외부 데이터 소스의 포트 정의 |
| `infrastructure` | Git 명령 실행, diff 파싱, 파일 시스템 접근 |
| `presentation` | CLI 인자 처리, 의존성 조립, 텍스트·JSON 출력 |

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

1. `package.json`과 lockfile diff를 이용한 신규 dependency 탐지
2. TypeScript AST 기반 함수·클래스·인터페이스 변경 분석
3. import graph 기반 변경 영향 범위 계산
4. 과잉 구현과 중복 가능성을 탐지하는 규칙 엔진
5. 분석 결과와 영향 범위를 보여주는 웹 UI
6. GitHub Action 및 Codex·Claude Code·Cursor adapter
7. 근거 기반 결과에 대한 선택적 LLM 설명

## 현재 제한사항

- 분석 대상은 최소 한 번 이상 커밋된 Git 저장소여야 합니다.
- untracked symbolic link는 안전을 위해 내용을 읽지 않습니다.
- 10 MiB를 초과하는 untracked 파일은 라인 수를 측정하지 않습니다.
- 현재 버전은 코드의 의미나 dependency 영향 범위까지 분석하지 않습니다.

## 라이선스

[MIT](./LICENSE)
