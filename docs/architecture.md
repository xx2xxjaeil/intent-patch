# IntentPatch 아키텍처

이 문서는 IntentPatch의 코드 구조와 주요 설계 판단을 설명합니다. 목표는 기능 수보다 변경에
강한 경계를 만드는 것입니다.

## 전체 흐름

```text
CLI 인자
  │
  ▼
AnalyzeChanges 유스케이스
  ├─ ChangeSource 포트 ─────▶ GitChangeSource
  │                           ├─ git diff --name-status -z
  │                           ├─ git diff --numstat -z
  │                           └─ git ls-files --others -z
  │
  ├─ RuleEngine
  │   └─ PackageDependencyRule
  │       └─ FileSnapshotSource 포트 ─▶ GitFileSnapshotSource
  │                                     ├─ 기준 revision의 package.json
  │                                     └─ working tree 또는 head의 package.json
  │
  ├─ CompareSourceSymbols
  │   ├─ FileSnapshotSource 포트 ─────▶ GitFileSnapshotSource
  │   └─ SourceSymbolExtractor 포트 ──▶ TypeScriptSymbolExtractor
  │
  └─ AnalyzeImportImpact
      ├─ ProjectFileSource 포트 ──────▶ GitProjectFileSource
      │                                ├─ working tree의 tracked·untracked 파일
      │                                └─ head ref의 전체 파일 tree
      └─ ModuleReferenceExtractor ────▶ TypeScriptModuleReferenceExtractor
  │
  ▼
ChangeReport
  ├─ ChangeSet
  ├─ FindingSet
  ├─ SymbolChangeSet
  ├─ ImpactAnalysis
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

`FileChange`, `ChangeSet`, `Finding`, `Severity`, `SymbolChange`, `ImpactAnalysis`처럼 분석 결과의
의미를 표현합니다. Git, TypeScript Compiler API, 파일 시스템, CLI를 알지 못합니다.
`LineDelta`는 측정된 값, binary, 측정 불가를 구별된 유니온으로 표현해 `0줄 변경`과
`알 수 없음`이 섞이지 않게 합니다.

### Application

`AnalyzeChanges` 유스케이스, `RuleEngine`, 분석 규칙과 외부 데이터 포트를 포함합니다.
`PackageDependencyRule`은 package manifest의 의미만 알고, Git이나 파일 시스템에서 내용을
읽는 방법은 `FileSnapshotSource`에 위임합니다. `CompareSourceSymbols`는 이전·현재 심볼
목록의 차이만 계산하고 언어별 파싱은 `SourceSymbolExtractor`에 위임합니다.
`AnalyzeImportImpact`는 module graph를 역방향으로 탐색하지만 파일을 얻는 방법과 언어별 import
문법은 각각 `ProjectFileSource`, `ModuleReferenceExtractor` 포트에 위임합니다.

### Infrastructure

Git 명령 실행, NUL 구분 출력 파싱, untracked 파일 측정, 기준·현재 파일 스냅샷 읽기와
TypeScript AST 파싱을 담당합니다. `GitProjectFileSource`는 working tree나 지정한 ref의 전체 파일
목록을 제공하고, TypeScript 어댑터는 최상위 선언 또는 정적 module specifier로 변환합니다.
Compiler API의 노드 타입은 application과 domain 계층으로 전파되지 않습니다.

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

### 7. 규칙은 주장과 근거를 함께 반환

규칙은 문자열 경고 대신 `Finding`을 반환합니다. Finding에는 안정적인 규칙 ID, 심각도, 관련
파일, 설명, 기계가 읽을 수 있는 evidence가 포함됩니다. CLI와 JSON 출력은 동일한 finding을
사용하므로 CI 판단과 사람이 보는 보고서가 어긋나지 않습니다.

### 8. diff와 동일한 기준점에서 파일 비교

브랜치 비교는 `base...head` diff와 일치하도록 merge base의 파일을 기준으로 읽습니다. working
tree 분석은 지정한 base ref와 현재 디스크 파일을 비교합니다. 따라서 dependency 결과와 변경
파일 목록이 서로 다른 기준점을 사용하는 오류를 방지합니다.

### 9. 심볼 변경과 위험 finding을 분리

함수 추가나 클래스 수정은 그 자체로 문제가 아니라 관찰된 사실입니다. 따라서 심볼 변경은
`Finding`으로 만들지 않고 `SymbolChangeSet`에 별도로 보존합니다. 이후 테스트 누락이나 공개 API
삭제 규칙이 이 사실을 근거로 위험 finding을 만들 수 있습니다.

### 10. 원문 코드 대신 fingerprint 비교

TypeScript 어댑터는 선언 원문을 SHA-256 fingerprint로 바꾸고 application 계층에는 원문 코드를
전달하지 않습니다. 보고서 크기와 코드 노출을 줄이면서 동일 선언의 변경 여부를 결정적으로
비교할 수 있습니다.

### 11. 현재 그래프를 역방향으로 탐색

각 `importer → imported` 관계를 만든 뒤 역방향 인접 목록을 너비 우선 탐색합니다. 변경 모듈을
직접 import하는 파일은 거리 1, 그 파일을 다시 import하는 파일은 거리 2 이상으로 기록합니다.
여러 변경 모듈에서 같은 파일에 도달하면 최단 거리와 모든 변경 원인을 함께 보존합니다.

### 12. 영향 사실과 위험 판단을 분리

영향을 받는 파일이 많다는 사실만으로 잘못된 변경이라고 단정하지 않습니다. import graph 결과는
`ImpactAnalysis`라는 관찰 결과로 제공하고, 위험 여부는 이후 scope 규칙이 근거와 함께
`Finding`으로 판단하도록 경계를 나눴습니다.

## 확장 지점

- 다른 변경 소스: `ChangeSource` 구현 추가
- 새로운 언어 분석기: `SourceSymbolExtractor` 포트의 infrastructure 어댑터 추가
- 새로운 import 문법 분석기: `ModuleReferenceExtractor` 포트의 infrastructure 어댑터 추가
- 새로운 출력 형식: `ChangeReport`를 입력받는 formatter 추가
- 새로운 규칙: `AnalysisRule` 구현을 추가하고 composition root에서 `RuleEngine`에 등록
- 새로운 파일 공급자: `FileSnapshotSource` 구현 추가
- 새로운 프로젝트 tree 공급자: `ProjectFileSource` 구현 추가

현재는 DI 컨테이너, 플러그인 프레임워크, 데이터베이스를 도입하지 않았습니다. 실제 두 번째
구현이나 영속성 요구가 생기기 전까지는 단순한 생성자 주입과 명시적인 composition root가 더
읽기 쉽고 유지보수하기 좋다고 판단했습니다.
