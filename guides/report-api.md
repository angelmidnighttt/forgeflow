# Báo deploy từ pipeline

Pipeline không dùng GitHub Deployments (GitLab CI, Jenkins, Argo CD hook, script tay…) báo deploy cho ForgeFlow bằng **API token của project**. Deployment báo lên hiện ở trang **Deployment** của project như deployment từ GitHub.

## 1. Tạo API token

Owner hoặc admin mở project → thẻ **API token** → đặt tên (ví dụ "GitLab CI production"), chọn thời hạn → **Tạo token**.

- Token (`ffp_…`) chỉ hiện **một lần**: chép ngay vào secret của CI (GitLab: Settings → CI/CD → Variables, đánh dấu Masked; Jenkins: Credentials; GitHub: Settings → Secrets).
- Token chỉ báo được deploy cho **project của nó**. Mỗi pipeline nên có token riêng, để thu hồi một token không làm hỏng pipeline khác.
- Lộ token: bấm **Thu hồi**, rồi tạo token mới. Danh sách token cho biết lần cuối mỗi token được dùng.

Pipeline cần hai biến: `FORGEFLOW_URL` (địa chỉ ForgeFlow, ví dụ `https://forgeflow.example.com`) và `FORGEFLOW_TOKEN`.

## 2. Báo deploy

Một lần deploy gồm hai lời gọi: **bắt đầu** (ForgeFlow trả về id của deployment), rồi **kết thúc** với kết quả.

### Bằng script

[`tools/report-deployment.sh`](../tools/report-deployment.sh) chỉ cần `sh` và `curl`. Chép file vào repository của bạn (đừng tải nó từ nhánh `main` mỗi lần chạy):

```sh
id=$(sh tools/report-deployment.sh start --environment production --version v1.4.0 \
       --sha "$COMMIT_SHA" --ref main --url "$JOB_URL")
./deploy.sh
sh tools/report-deployment.sh finish "$id" --status success --environment-url https://app.example.com
```

| Tuỳ chọn            | `start`  | `finish` | Ý nghĩa                                                                                         |
| ------------------- | -------- | -------- | ----------------------------------------------------------------------------------------------- |
| `--environment`     | bắt buộc |          | Tên environment trong project; tên mới thì ForgeFlow tự thêm                                    |
| `--status`          | tuỳ chọn | bắt buộc | `in_progress` (mặc định khi bắt đầu), `success`, `failure`, `error`, `cancelled`, hoặc `queued` |
| `--version`         | tuỳ chọn |          | Phiên bản hiển thị; không có thì lấy ref, rồi 7 ký tự đầu của commit                            |
| `--sha`, `--ref`    | tuỳ chọn |          | Commit (7–40 ký tự hex) và nhánh / tag                                                          |
| `--url`             | tuỳ chọn | tuỳ chọn | Trang log của job (`http(s)` thôi)                                                              |
| `--environment-url` | tuỳ chọn | tuỳ chọn | Địa chỉ của bản vừa deploy                                                                      |
| `--description`     | tuỳ chọn | tuỳ chọn | Ghi chú ngắn (tối đa 500 ký tự)                                                                 |
| `--creator`         | tuỳ chọn |          | Người deploy                                                                                    |
| `--key`             | tuỳ chọn |          | `Idempotency-Key` (xem dưới); mặc định lấy từ lần chạy CI                                       |

### GitLab CI

```yaml
deploy_production:
  stage: deploy
  environment: production
  script:
    - id=$(sh tools/report-deployment.sh start --environment production --sha "$CI_COMMIT_SHA" --ref "$CI_COMMIT_REF_NAME" --version "$CI_COMMIT_TAG" --url "$CI_JOB_URL" --creator "$GITLAB_USER_LOGIN")
    - ./deploy.sh || { sh tools/report-deployment.sh finish "$id" --status failure; exit 1; }
    - sh tools/report-deployment.sh finish "$id" --status success
```

### Jenkins (Declarative Pipeline)

```groovy
stage('Deploy') {
  environment {
    FORGEFLOW_URL = 'https://forgeflow.example.com'
    FORGEFLOW_TOKEN = credentials('forgeflow-token')
  }
  steps {
    script {
      env.DEPLOYMENT_ID = sh(returnStdout: true, script: '''
        sh tools/report-deployment.sh start --environment production --sha "$GIT_COMMIT" --url "$BUILD_URL"
      ''').trim()
    }
    sh './deploy.sh'
  }
  post {
    success { sh 'sh tools/report-deployment.sh finish "$DEPLOYMENT_ID" --status success' }
    failure { sh 'sh tools/report-deployment.sh finish "$DEPLOYMENT_ID" --status failure' }
  }
}
```

### GitHub Actions, khi không dùng `environment:`

Job có `environment:` đã được GitHub App theo dõi ([Theo dõi deployment từ GitHub](github.md)). Workflow deploy theo cách khác thì dùng action đi kèm:

```yaml
- id: forgeflow
  uses: <owner>/forgeflow/.github/actions/report-deployment@main
  with:
    forgeflow-url: ${{ vars.FORGEFLOW_URL }}
    token: ${{ secrets.FORGEFLOW_TOKEN }}
    step: start
    environment: production
- run: ./deploy.sh
- if: always()
  uses: <owner>/forgeflow/.github/actions/report-deployment@main
  with:
    forgeflow-url: ${{ vars.FORGEFLOW_URL }}
    token: ${{ secrets.FORGEFLOW_TOKEN }}
    step: finish
    deployment-id: ${{ steps.forgeflow.outputs.deployment-id }}
    status: ${{ job.status == 'success' && 'success' || 'failure' }}
```

`<owner>/forgeflow` là repository ForgeFlow mà bạn dùng; nên ghim vào một commit SHA thay vì `@main`.

### Gọi thẳng API

```sh
curl -X POST "$FORGEFLOW_URL/api/v1/deployments" \
  -H "Authorization: Bearer $FORGEFLOW_TOKEN" \
  -H "Idempotency-Key: deploy-$CI_JOB_ID" \
  -H "Content-Type: application/json" \
  -d '{"environment":"production","version":"v1.4.0","sha":"9fceb02"}'
# 201 {"data":{"id":"…","status":"in_progress",…}}

curl -X PATCH "$FORGEFLOW_URL/api/v1/deployments/<id>" \
  -H "Authorization: Bearer $FORGEFLOW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"success"}'
```

## Idempotency-Key: gọi lại không tạo bản trùng

Mạng chập chờn làm CI gửi lại lời gọi **bắt đầu**. Mỗi lời gọi bắt đầu phải có header `Idempotency-Key` (tối đa 200 ký tự `A–Z a–z 0–9 . _ : -`), giữ nguyên giữa các lần thử lại của cùng một lần deploy:

- Cùng key, cùng nội dung → `200` với **chính deployment đã tạo**, không tạo cái thứ hai.
- Cùng key, nội dung khác → `422 IDEMPOTENCY_KEY_REUSED`: key này đã dùng cho một deploy khác.

Script tự lấy key từ lần chạy CI (`GITHUB_RUN_ID` + lần thử, `CI_JOB_ID`, `BUILD_TAG`). Chạy lại cả job là một lần deploy mới, với key mới.

## Lỗi thường gặp

| Mã                           | Nguyên nhân                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`                        | Thiếu token, token sai, đã thu hồi hoặc hết hạn                                                                                                    |
| `400`                        | Thiếu `Idempotency-Key`; hoặc dữ liệu sai (tên environment rỗng, SHA không phải hex, URL không phải `http(s)`…): `error.details` chỉ ra trường sai |
| `404` (khi kết thúc)         | Id không phải deployment của project của token                                                                                                     |
| `422 IDEMPOTENCY_KEY_REUSED` | Key đã dùng cho một lần báo khác                                                                                                                   |
| `429`                        | Gọi quá nhiều trong thời gian ngắn; script tự thử lại 3 lần                                                                                        |
