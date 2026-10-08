# IntentPatch GitHub Action

IntentPatch Action은 GitHub API key나 쓰기 권한 없이 checkout된 Git 저장소를 분석합니다. 결과는
Job Summary, workflow annotation, JSON·HTML 파일과 Action output으로 제공됩니다.

## 기본 workflow

```yaml
name: IntentPatch

on:
  pull_request:

permissions:
  contents: read

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Analyze pull request
        id: intentpatch
        uses: xx2xxjaeil/intent-patch@main
        with:
          config: .intentpatch.json
          fail-on: high

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: intentpatch-report
          path: intentpatch-report
```

`fetch-depth: 0`을 지정해야 PR의 base와 head commit을 모두 찾을 수 있습니다. Action은 분석
중 대상 저장소의 스크립트나 테스트를 실행하지 않습니다.

## 입력

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `working-directory` | `.` | `GITHUB_WORKSPACE` 안의 분석 대상 저장소 |
| `config` | 없음 | 분석 대상 저장소 기준 Change Contract 경로 |
| `base` | 자동 | 직접 지정할 base Git ref |
| `head` | 자동 | 직접 지정할 head Git ref |
| `fail-on` | `high` | Action을 실패시킬 최저 심각도 |
| `report-directory` | `intentpatch-report` | `GITHUB_WORKSPACE` 안의 보고서 디렉터리 |

`base`와 `head`는 항상 함께 지정해야 합니다. 지정하지 않으면 이벤트에서 다음과 같이
결정합니다.

| 이벤트 | base | head |
| --- | --- | --- |
| `pull_request` | `pull_request.base.sha` | `pull_request.head.sha` |
| `push` | `before` | `after` |
| 기타 | `HEAD^` | `HEAD` |

새 브랜치의 첫 push는 GitHub payload에 base commit이 없으므로 `base`와 `head`를 명시해야 합니다.

## 출력

| 이름 | 설명 |
| --- | --- |
| `json-report` | JSON 보고서의 절대 경로 |
| `html-report` | 단일 HTML 보고서의 절대 경로 |
| `findings` | 전체 finding 수 |
| `high-findings` | high finding 수 |
| `medium-findings` | medium finding 수 |
| `low-findings` | low finding 수 |

보고서를 artifact로 보존하는 일은 workflow의 `actions/upload-artifact` 단계가 담당합니다. 이
경계를 분리해 IntentPatch Action 자체는 `contents: read` 이외의 GitHub 권한을 요구하지 않습니다.

## Action 번들 갱신

`src/presentation/github` 코드를 수정한 뒤에는 다음 명령으로 배포 번들을 갱신합니다.

```bash
npm run build:action
npm run check
```

`npm run check`는 번들을 다시 만든 뒤 커밋된 `action-dist/index.cjs`와 다른지 검사합니다.
