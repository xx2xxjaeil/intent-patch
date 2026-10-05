# IntentPatch 아키텍처

이 문서는 IntentPatch의 코드 구조와 주요 설계 판단을 설명합니다. 목표는 기능 수보다 변경에
강한 경계를 만드는 것입니다.

## 전체 흐름

```text
CLI 인자
  │
  ▼
AnalyzeChanges 유스케이스
  │ ChangeSource 포트
  ▼
GitChangeSource 어댑터
  ├─ git diff --name-status -z
  ├─ git diff --numstat -z
  └─ git ls-files --others -z
  │
  ▼
createChangeSet 도메인 팩토리
  │
  ├─ 텍스트 보고서
  └─ JSON 보고서
```

## 계층과 의존 방향

```text
presentation ───────▶ application ───────▶ domain
      │                     ▲
      └──▶ infrastructure ──┘
```

### Domain

`FileChange`, `LineDelta`, `ChangeSet`처럼 분석 결과의 의미를 표현합니다. Git, 파일 시스템,
CLI를 알지 못합니다. `LineDelta`는 측정된 값, binary, 측정 불가를 구별된 유니온으로 표현해
`0줄 변경`과 `알 수 없음`이 섞이지 않게 합니다.

### Application

`AnalyzeChanges` 유스케이스와 `ChangeSource` 포트를 포함합니다. 입력을 정규화하고 분석 흐름을
조율하지만 데이터를 어떻게 수집하고 출력하는지는 결정하지 않습니다.

### Infrastructure

Git 명령 실행, NUL 구분 출력 파싱, untracked 파일 측정을 담당합니다. 이 계층의 결과는 도메인
모델로 변환되어 바깥 기술의 세부 형식이 내부로 전파되지 않습니다.

### Presentation

CLI 인자와 출력 형식을 담당합니다. `main.ts`는 유스케이스와 Git 어댑터를 연결하는 composition
root 역할도 수행합니다.

## 주요 설계 판단

### 1. Git 라이브러리 대신 Git CLI 사용

사용자가 보는 결과와 Git 자체의 결과가 달라지는 일을 줄이고 런타임 dependency를 추가하지
않기 위해 설치된 Git을 직접 실행합니다. `execFile`을 사용하므로 인자를 shell 문자열로
재해석하지 않습니다.

### 2. 파일 상태와 라인 통계를 분리 수집

`--name-status`는 rename을 포함한 파일 상태에 적합하고, `--numstat`은 추가·삭제 라인 계산에
적합합니다. 두 출력을 최종 파일 경로로 병합해 하나의 `FileChange`를 만듭니다.

### 3. NUL 구분 출력 사용

Git 경로에는 공백뿐 아니라 탭과 개행도 들어갈 수 있습니다. `-z` 옵션으로 NUL 구분 출력을
요청해 경로를 줄 단위로 파싱할 때 생기는 모호함을 제거합니다.

### 4. Working tree와 ref 비교 구분

ref 비교에는 공통 조상 이후 변경을 보는 `base...head`를 사용합니다. working tree 분석에서는
`git diff`가 제공하지 않는 untracked 파일을 별도로 수집합니다.

### 5. 분석 불확실성을 모델에 보존

binary, symbolic link, 크기 제한 파일을 임의로 0줄로 계산하지 않습니다. 측정할 수 없는 이유를
`unavailable` 상태로 유지해 이후 규칙 엔진이 잘못된 결론을 만들지 않게 합니다.

### 6. 아키텍처를 테스트로 보호

`tests/architecture/dependency-direction.test.ts`가 소스 import를 검사합니다. 문서와 실제 코드의
의존 방향이 달라지면 테스트가 실패합니다.

## 확장 지점

- 다른 변경 소스: `ChangeSource` 구현 추가
- 새로운 언어 분석기: application 포트와 infrastructure 어댑터 추가
- 새로운 출력 형식: `ChangeReport`를 입력받는 formatter 추가
- 새로운 규칙: 도메인 finding 모델과 독립 규칙 구현 추가

현재는 DI 컨테이너, 플러그인 프레임워크, 데이터베이스를 도입하지 않았습니다. 실제 두 번째
구현이나 영속성 요구가 생기기 전까지는 단순한 생성자 주입과 명시적인 composition root가 더
읽기 쉽고 유지보수하기 좋다고 판단했습니다.
