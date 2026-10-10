# 릴리스 운영 가이드

IntentPatch는 Git tag를 단일 릴리스 시작점으로 사용합니다. `release.yml`은 태그와 패키지 버전을
검증하고, 품질 검사를 통과한 결과만 npm과 GitHub Release에 순서대로 공개합니다.

```text
vX.Y.Z tag
    │
    ▼
기본 브랜치·버전·품질 검사
    │
    ▼
npm Trusted Publishing (OIDC)
    │
    ▼
GitHub Release + 자동 생성 변경 내역
```

## 자동화가 보장하는 조건

- 태그 이름은 `package.json`의 `version` 앞에 `v`를 붙인 값과 정확히 같아야 합니다.
- 태그가 가리키는 커밋은 저장소의 기본 브랜치에 포함되어야 합니다.
- 타입 검사, lint, 테스트, GitHub Action bundle 검증이 모두 통과해야 합니다.
- `npm pack --dry-run`으로 공개될 파일을 확인한 뒤에만 배포합니다.
- npm 배포가 성공한 뒤에만 GitHub Release를 만듭니다.
- npm 인증에는 장기 token 대신 GitHub Actions OIDC를 사용합니다.
- 같은 버전이 이미 npm에 공개됐다면 tarball 무결성을 먼저 확인합니다. 압축 결과가
  달라도 배포 파일의 경로와 내용이 모두 같으면 npm 재배포를 건너뛰고 GitHub Release를
  만듭니다. 파일이 다르면 릴리스를 중단합니다.

## 최초 릴리스 준비

npm은 registry에 존재하는 패키지에만 Trusted Publisher를 설정할 수 있습니다. 신규 패키지를
`npm stage publish`로 등록하면 공개 페이지에는 `0.0.0-stage` placeholder가 만들어지고 실제
버전은 승인 전까지 staging 영역에 보관됩니다.

staging은 패키지 이름을 먼저 등록하는 bootstrap 용도로 사용할 수 있지만, 최종 소스가 아닌
tarball을 승인해서는 안 됩니다. 문서나 빌드 결과가 달라졌다면 npm 계정에 2FA를 활성화한 뒤
Staged Packages 화면 또는 CLI에서 기존 stage를 거절합니다.

```bash
npm stage list intentpatch
npm stage view <stage-id>
npm stage reject <stage-id>
```

`stage reject`는 staging된 버전을 제거해 같은 버전을 다시 배포할 수 있게 하며 2FA 확인이
필수입니다. `0.0.0-stage` placeholder는 패키지 namespace가 생성됐다는 의미일 뿐 실제
`v0.1.0` 릴리스가 아닙니다.

IntentPatch의 최초 정식 릴리스는 다음 순서를 따릅니다.

1. 잘못되거나 오래된 `0.1.0` stage가 있다면 2FA로 거절합니다.
2. 릴리스 자동화 PR을 `main`에 merge합니다.
3. 아래 설정으로 npm Trusted Publisher를 연결합니다.
4. 최신 `main`에서 `npm run check`와 `npm pack --dry-run`을 실행합니다.
5. `v0.1.0` annotated tag를 만들고 push해 자동 워크플로를 시작합니다.

```bash
git switch main
git pull --ff-only
npm run check
npm pack --dry-run
npm run release:verify -- v0.1.0
git tag -a v0.1.0 -m "IntentPatch v0.1.0"
git push origin v0.1.0
```

npm에 공개된 버전은 같은 번호로 덮어쓸 수 없으므로 tag를 push하기 전에 tarball 내용을 반드시
확인합니다. 자동 배포가 성공하면 별도로 같은 버전을 수동 publish하지 않습니다.

## npm Trusted Publisher 연결

패키지가 존재하고 다음 자동 릴리스 버전이 준비되면 npm package settings의
**Trusted Publisher**에 다음 값을 입력합니다.

| 항목 | 값 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `xx2xxjaeil` |
| Repository | `intent-patch` |
| Workflow filename | `release.yml` |
| Environment | 입력하지 않음 |
| Allowed action | `npm publish` 허용 |

CLI로 설정할 때는 Node.js 22.14 이상, npm 11.15 이상, npm 계정 2FA가 필요합니다.

```bash
npm install --global npm@11
npm login
npm trust github intentpatch \
  --file release.yml \
  --repo xx2xxjaeil/intent-patch \
  --allow-publish
```

새 Trusted Publisher 설정은 2일 안에 첫 성공 배포를 완료해야 합니다. 따라서 버전 변경 PR이
merge되어 tag를 push할 준비가 된 시점에 연결합니다. 첫 OIDC 배포가 성공한 뒤에는 npm package
settings의 Publishing access를 **Require two-factor authentication and disallow tokens**로
설정하는 것을 권장합니다.

## 이후 버전 릴리스

버전 변경은 기능 변경과 별도의 PR로 남깁니다. 다음 예시는 patch 버전을 올리되 tag는 만들지
않습니다.

```bash
git switch -c release/v0.1.1
npm version patch --no-git-tag-version
npm run check
git add package.json package-lock.json
git commit -m "chore(release): prepare v0.1.1"
```

PR을 merge한 뒤 최신 `main`에서 버전과 tag가 일치하는지 확인하고 tag를 push합니다.

```bash
git switch main
git pull --ff-only
npm run release:verify -- v0.1.1
git tag -a v0.1.1 -m "IntentPatch v0.1.1"
git push origin v0.1.1
```

GitHub Actions의 `Release` workflow에서 다음 세 job이 모두 성공해야 릴리스가 완료됩니다.

1. `Validate release`
2. `Publish to npm`
3. `Create GitHub Release`

`Publish to npm`은 성공했지만 마지막 job만 실패했다면 전체 workflow를 다시 실행하지 말고
`Create GitHub Release` job만 재실행합니다. 이미 공개된 npm 버전을 다시 publish하면 충돌하기
때문입니다.

## 문제 해결

- `ENEEDAUTH`: Trusted Publisher의 저장소와 `release.yml` 파일명이 정확한지, workflow에
  `id-token: write`가 있는지 확인합니다.
- 태그 검증 실패: tag의 `v` 접두사와 `package.json` 버전을 비교합니다.
- 기본 브랜치 검증 실패: 아직 merge되지 않은 feature branch commit에 tag를 만들지 않았는지
  확인합니다.
- npm 버전 충돌: 공개된 버전을 재사용하지 말고 `package.json`과 lockfile의 버전을 올립니다.
- GitHub Release 실패: npm 배포 성공 여부를 먼저 확인하고 마지막 job만 재실행합니다.
