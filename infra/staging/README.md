# Staging trên một VPS

ForgeFlow chạy trên một server Ubuntu 24.04 bằng Docker Compose. Mỗi lần push lên `main`, CI build image, đẩy lên GitHub Container Registry, rồi deploy qua SSH. Cấu hình bám sát production (`NODE_ENV=production`, HTTPS, cookie `__Secure-`); khác production ở header `noindex` và ở việc chỉ có một server.

```text
Internet ──HTTPS──▶ Caddy :443 (chứng chỉ Let's Encrypt tự cấp và gia hạn)
                      ├── /api/*  → api:4000   (role DB forgeflow_app, chịu RLS)
                      └── còn lại → web:3000
                    postgres:5432 chỉ trong mạng nội bộ của Docker
```

| Đường dẫn trên server              | Nội dung                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `/opt/forgeflow/.env`              | Cấu hình và secret (mode 600, mẫu: [`.env.example`](.env.example)); không bao giờ commit  |
| `/opt/forgeflow/repo`              | Bản clone repo, checkout đúng commit đang chạy; deploy lấy `compose.yml` và script từ đây |
| `/opt/forgeflow/deployed-version`  | SHA của commit đang chạy                                                                  |
| `/opt/forgeflow/deploy.log`        | Log đầy đủ của mọi lần deploy                                                             |
| `/opt/forgeflow/backups`           | Bản dump DB hằng ngày, giữ 14 ngày                                                        |
| `/usr/local/bin/forgeflow-compose` | `docker compose` đã trỏ sẵn đúng project, `.env` và phiên bản                             |
| `/usr/local/bin/forgeflow-deploy`  | Lệnh duy nhất mà deploy key của CI được phép chạy                                         |

## Cài đặt lần đầu

Cần có: một VPS Ubuntu 24.04 (2 vCPU / 2–4 GB RAM là đủ), IP public, quyền root.

**1. Tên miền.** Chưa có domain thì dùng [sslip.io](https://sslip.io): `203-0-113-10.sslip.io` tự trỏ về `203.0.113.10`, và Let's Encrypt cấp chứng chỉ cho tên đó. Dưới đây `<IP>` là IP của server, `<HOST>` là tên miền (ví dụ `203-0-113-10.sslip.io`).

**2. Đăng nhập root bằng SSH key** (chỉ nhập mật khẩu root của nhà cung cấp một lần ở bước này):

```bash
ssh-copy-id root@<IP>
ssh root@<IP> true   # phải chạy được mà không hỏi mật khẩu
```

**3. Tạo deploy key cho CI**, trên máy của bạn. Private key chỉ được đưa vào GitHub secret, không gửi đi đâu khác:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/forgeflow_deploy -N "" -C forgeflow-ci
```

**4. Chuẩn bị server.** Chạy từ thư mục gốc của repo; lệnh lấy script đi kèm từ nhánh `main` trên GitHub:

```bash
ssh root@<IP> "SITE_HOST=<HOST> DEPLOY_PUBLIC_KEY='$(cat ~/.ssh/forgeflow_deploy.pub)' bash -s" \
  < infra/staging/scripts/bootstrap.sh
```

[`bootstrap.sh`](scripts/bootstrap.sh) làm những việc sau (chạy lại vẫn an toàn):

- cập nhật hệ thống và bật tự động cài bản vá bảo mật;
- thêm swap 2 GB nếu server chưa có;
- cài Docker, với log container có xoay vòng;
- bật tường lửa ufw, chỉ mở SSH, 80 và 443;
- tắt đăng nhập SSH bằng mật khẩu (chỉ khi root đã có key);
- tạo user `deploy`;
- clone repo vào `/opt/forgeflow/repo`;
- tạo `.env` với `SITE_HOST` và secret ngẫu nhiên;
- cài cron backup hằng ngày.

Cuối output là fingerprint host key của server, dùng ở bước 6.

**5. Email.** Điền `SMTP_URL` và `MAIL_FROM` trong `/opt/forgeflow/.env` (`ssh root@<IP>` rồi `nano /opt/forgeflow/.env`). Thiếu hai giá trị này thì deploy dừng và báo đúng tên biến còn thiếu.

- **Chưa có domain:** dùng một tài khoản Gmail riêng cho server, với [app password](https://myaccount.google.com/apppasswords) (cần bật xác minh 2 bước). Ví dụ có sẵn trong file. Gmail giới hạn khoảng 500 email/ngày, đủ cho staging.
- **Có domain:** chuyển sang một dịch vụ gửi mail (Resend, Brevo, SES…) và cấu hình SPF + DKIM cho domain.

Muốn bật "Đăng nhập bằng GitHub" thì tạo một OAuth app riêng cho staging, callback `https://<HOST>/api/v1/auth/github/callback`, rồi điền `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

**6. Cấu hình GitHub** (bằng `gh`, đứng trong repo):

```bash
# Environment chỉ nhận deploy từ nhánh main
gh api -X PUT "repos/{owner}/{repo}/environments/staging" \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true" > /dev/null
gh api -X POST "repos/{owner}/{repo}/environments/staging/deployment-branch-policies" \
  -f name=main -f type=branch > /dev/null
gh secret set DEPLOY_SSH_KEY --env staging < ~/.ssh/forgeflow_deploy
ssh-keyscan -t ed25519 <IP> | gh secret set DEPLOY_SSH_KNOWN_HOSTS --env staging
gh variable set DEPLOY_SSH_HOST --env staging --body <IP>
gh variable set STAGING_URL --env staging --body https://<HOST>
gh variable set STAGING_DEPLOY --body true
```

- So fingerprint mà `ssh-keyscan` nhận được (`ssh-keyscan -t ed25519 <IP> | ssh-keygen -lf -`) với dòng ED25519 mà `bootstrap.sh` in ra. Hai chuỗi khớp nhau thì CI mới tin đúng server của bạn.
- SSH không chạy ở cổng 22 thì thêm `gh variable set DEPLOY_SSH_PORT --env staging --body <port>`.
- Có thể bật "Required reviewers" cho environment `staging` (Settings → Environments) nếu muốn duyệt tay trước mỗi lần deploy.

**7. Deploy lần đầu.** Chạy cho commit mới nhất trên `main`, vì image của nó đã có sẵn:

```bash
gh workflow run deploy-staging.yml -f version=$(git rev-parse origin/main)
```

Sau đó mở `https://<HOST>`. Lần đầu, Caddy mất vài giây để lấy chứng chỉ.

## Hằng ngày

- **Push lên `main`** chạy CI theo thứ tự: lint / build / test → image `ghcr.io/<owner>/forgeflow-{api,web}:<sha>` → job **Staging**. Bỏ biến `STAGING_DEPLOY` (hoặc đặt khác `true`) thì CI ngừng tự deploy.
- **Một lần deploy** ([`deploy.sh`](scripts/deploy.sh)) chạy các bước:
  1. pull image;
  2. đặt mật khẩu cho role `forgeflow_app`;
  3. chạy migration bằng role owner;
  4. thay container api / web / Caddy và chờ healthcheck.

  Lỗi ở bước nào thì dừng ở bước đó, bản đang chạy giữ nguyên. Khi thay container, site gián đoạn vài giây.

- **Kiểm tra:** cuối job, CI gọi `https://<HOST>/api/v1/health` và đợi đến khi `version` trả về đúng SHA vừa deploy.
- **Rollback:** chạy lại workflow với SHA cũ, `gh workflow run deploy-staging.yml -f version=<sha>`. Migration chỉ chạy tiến, không lùi, nên bản cũ phải chạy được với schema mới. Vì vậy migration nên theo kiểu expand / contract: thêm cột hoặc bảng trước, bỏ cột cũ ở một bản sau.
- **Đổi `.env`:** deploy lại đúng phiên bản đang chạy để container nhận cấu hình mới:

  ```bash
  ssh root@<IP> 'runuser -u deploy -- bash /opt/forgeflow/repo/infra/staging/scripts/deploy.sh $(cat /opt/forgeflow/deployed-version)'
  ```

## Vận hành (trên server, bằng root)

```bash
forgeflow-compose ps                         # trạng thái container
forgeflow-compose logs -f --since 1h api     # log api (JSON của pino)
tail -n 100 /opt/forgeflow/deploy.log        # các lần deploy gần đây
forgeflow-compose exec postgres psql -U forgeflow   # psql bằng role owner
```

**Backup.** Cron chạy [`backup.sh`](scripts/backup.sh) lúc 03:00 giờ server và giữ 14 ngày. Bản dump nằm cùng ổ đĩa với DB, nên hãy chép thêm ra ngoài: `scp root@<IP>:/opt/forgeflow/backups/<file>.dump .`. Khôi phục một bản dump:

```bash
forgeflow-compose stop api
forgeflow-compose exec -T postgres pg_restore -U forgeflow -d forgeflow --clean --if-exists \
  < /opt/forgeflow/backups/<file>.dump
forgeflow-compose start api
```

**Chuyển sang domain thật:**

1. Tạo bản ghi DNS `A` trỏ về `<IP>`.
2. Sửa `SITE_HOST` trong `.env`.
3. Chạy `gh variable set STAGING_URL --env staging --body https://<domain>`.
4. Sửa callback của GitHub OAuth app.
5. Deploy lại.

Caddy tự lấy chứng chỉ cho tên mới.

**Đổi secret:**

- `JWT_SECRET`: access token cũ hết hiệu lực, người dùng tự lấy token mới bằng refresh cookie.
- `APP_DB_PASSWORD`: deploy lại là xong, vì bước đặt role dùng mật khẩu mới trước khi api khởi động.
- `POSTGRES_PASSWORD`: giá trị này chỉ có tác dụng khi tạo volume. Muốn đổi thì chạy `ALTER ROLE forgeflow PASSWORD '…'` trong psql trước, rồi mới sửa `.env`.
- `SECRET_ENCRYPTION_KEYS` (khoá mã hoá secret của integration): **không được mất**, vì mất là mất mọi secret đã lưu; chép nó ra chỗ an toàn, tách khỏi bản backup DB. Đổi khoá:
  1. Thêm khoá mới với version cao hơn vào đầu: `SECRET_ENCRYPTION_KEYS=2:<openssl rand -base64 32>,1:<khoá cũ>`, rồi deploy lại.
  2. `forgeflow-compose run --rm rewrap-secrets`: mã hoá lại khoá dữ liệu của mọi secret bằng khoá 2 (bản mã giữ nguyên).
  3. Bỏ khoá 1 khỏi `.env`, deploy lại.

**Server dựng trước khi có biến này** (bootstrap cũ): thêm vào `/opt/forgeflow/.env` **trước khi** merge bản có integration lên `main`, nếu không deploy sẽ dừng với "set SECRET_ENCRYPTION_KEYS in .env":

```bash
ssh root@<IP> 'grep -q "^SECRET_ENCRYPTION_KEYS=" /opt/forgeflow/.env || echo "SECRET_ENCRYPTION_KEYS=1:$(openssl rand -base64 32)" >> /opt/forgeflow/.env'
```

## Bảo mật

- **Deploy key của CI** chỉ chạy được `forgeflow-deploy deploy <sha> <user>`, vì `authorized_keys` có `restrict,command=…`. Mọi lệnh khác đều bị từ chối, và key đó không mở được shell.
- **User `deploy`** thuộc nhóm `docker`, tức là ngang quyền root. Ai push được lên `main` thì deploy được, nên hãy bật branch protection cho `main`.
- **Token đọc registry:** CI gửi `GITHUB_TOKEN` của chính job qua stdin. Token này chỉ dùng cho lần pull đó, nằm trong một Docker config tạm, và hết hạn khi job kết thúc. Server không lưu credential nào của GitHub, nên image trên GHCR để private vẫn deploy được.
- **Cổng mở:** Docker mở cổng bằng iptables, đi vòng qua ufw. Vì vậy chỉ Caddy được publish cổng; Postgres không có cổng nào ra ngoài.
- **Đăng ký mở:** bất kỳ ai biết URL đều đăng ký được, giống production. Rate limit và khoá tạm theo email vẫn áp dụng, và header `noindex` giữ staging ngoài kết quả tìm kiếm.
- **Theo dõi:** nên thêm một monitor uptime (ví dụ UptimeRobot, miễn phí) gọi `https://<HOST>/api/v1/ready` để biết khi DB hoặc api ngừng chạy.
