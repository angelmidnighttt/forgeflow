# ForgeFlow

ForgeFlow là control plane đa tenant nối các bước **deploy → giám sát → phát hiện sự cố → điều tra → người duyệt → khắc phục → xác minh hồi phục**. Nó làm việc trên các công cụ sẵn có của team (GitHub, Prometheus/Alertmanager, Argo CD) thay vì thay thế chúng.

**Trạng thái:** đang dựng nền móng — monorepo, API, web, database và môi trường chạy local. Chưa có bản production.

## Yêu cầu

| Công cụ                        | Phiên bản                    |
| ------------------------------ | ---------------------------- |
| Node.js                        | 22.12 trở lên (xem `.nvmrc`) |
| npm                            | 10 trở lên                   |
| Docker Desktop / Docker Engine | có Docker Compose v2         |

## Chạy local

```bash
npm install
npm run dev
```

`npm run dev` sẽ:

1. Tạo `.env` từ `.env.example` nếu chưa có (và bổ sung các biến mới thêm vào `.env.example`).
2. Bật PostgreSQL (pgvector) và Mailpit bằng Docker Compose, chờ healthy.
3. Build các package TypeScript, áp dụng migration.
4. Chạy song song: TypeScript watch, api (tự restart khi code đổi), web.

| Địa chỉ                             | Nội dung                                  |
| ----------------------------------- | ----------------------------------------- |
| http://localhost:3000               | Web dashboard (trang trạng thái hệ thống) |
| http://localhost:4000/api/v1/health | Liveness của api                          |
| http://localhost:4000/api/v1/ready  | Readiness (kiểm tra DB)                   |
| http://localhost:8025               | Mailpit: hộp thư nhận mọi email api gửi   |

Email ở local không đi ra ngoài: api gửi qua SMTP tới Mailpit (`SMTP_URL=smtp://localhost:1025`), mở http://localhost:8025 để đọc.

Nếu cổng đã bị chiếm, đặt cổng khác trước khi chạy và sửa `.env` cho khớp: `FORGEFLOW_DB_PORT` (mặc định 5432, sửa `DATABASE_URL`), `FORGEFLOW_SMTP_PORT` (1025, sửa `SMTP_URL`), `FORGEFLOW_MAILPIT_PORT` (8025, đặt `MAILPIT_URL` cho test).

## Script

| Lệnh                              | Việc làm                                                  |
| --------------------------------- | --------------------------------------------------------- |
| `npm run dev`                     | Chạy toàn bộ môi trường local                             |
| `npm run build`                   | Build packages, api và web                                |
| `npm run typecheck`               | Kiểm tra kiểu toàn repo, gồm cả code test                 |
| `npm run lint`                    | ESLint                                                    |
| `npm run format` / `format:check` | Prettier                                                  |
| `npm test`                        | Build rồi chạy Jest (unit + integration, cần `db:up`)     |
| `npm run test:unit`               | Chỉ chạy unit test, không cần dịch vụ ngoài               |
| `npm run db:up` / `db:down`       | Bật / tắt PostgreSQL và Mailpit local                     |
| `npm run db:generate`             | Sinh migration từ schema Drizzle (`drizzle-kit generate`) |
| `npm run db:migrate`              | Áp dụng migration (chạy lặp lại an toàn)                  |
| `npm run db:reset`                | Xoá sạch và migrate lại — chỉ chạy được với DB localhost  |
| `npm run db:seed`                 | Nạp dữ liệu mẫu                                           |

## Cấu trúc

```text
apps/
  api/          NestJS 12 — REST API, webhook ingress, health (xem "Cấu trúc api")
  web/          Next.js 16 — dashboard
    src/app/        Route (App Router)
    src/features/   Tính năng: component + cách nạp dữ liệu của nó
    src/lib/        Tiện ích dùng chung (api-client)
packages/
  config/       Nạp .env và validate biến môi trường bằng zod
  contracts/    Schema zod + kiểu dùng chung giữa api và web (envelope, health)
  database/     Drizzle: schema, migration, script migrate/reset/seed
infra/
  compose/      Docker Compose cho môi trường local
  docker/       Dockerfile của api và web
scripts/        Script tiện ích cho môi trường dev
```

## Cấu trúc api

`apps/api` dùng cấu trúc NestJS thông thường: mỗi tính năng là một module chỉ gồm controller, service và file module. Decorator, guard, type, hằng số… nằm trong `common/`, chia thư mục theo loại.

```text
apps/api/src/
  main.ts               Khởi động process
  app.module.ts         Module gốc: nạp các module, guard / filter / interceptor toàn cục
  app.factory.ts        Tạo app Nest (dùng chung cho main.ts và test)
  config/env.ts         Biến môi trường (zod)
  database/             DatabaseModule (pool + Drizzle)
  common/
    constants/          Hằng số: injection token, metadata key, API prefix, chính sách token,
                        cookie, rate limit
    decorators/         @Public(), @CurrentAuth(), @RateLimit()
    filters/            HttpExceptionFilter (bọc lỗi thành { error })
    guards/             JwtAuthGuard, OriginGuard (CSRF), RateLimitGuard
    interceptors/       EnvelopeInterceptor (bọc kết quả thành { data })
    pipes/              ZodValidationPipe
    templates/          Template email (layout chung, xác minh, đặt lại / đã đổi mật khẩu)
    types/              Kiểu dữ liệu dùng chung (AuthContext, ClientInfo, kết quả xoay token…)
    utils/              Hàm thuần: request id, clock, client info, secret token / PKCE,
                        xoay refresh token, escape HTML, link tới web app
  modules/
    auth/               Controller: Auth, EmailVerification, Password, Sessions, GithubAuth
                        Service: Auth, AccessToken, RefreshToken, Password, UserToken,
                        EmailVerification, PasswordReset, AuthMail, GithubOAuth,
                        GithubSignIn, RefreshCookie, OAuthStateCookie
    users/              UsersService (users, tài khoản OAuth liên kết)
    mail/               MailService (gửi email qua SMTP)
    rate-limit/         RateLimitService (bộ đếm cửa sổ cố định trong PostgreSQL)
    health/             HealthController (/health, /ready)
```

- **Controller** nhận request, gọi service, trả kết quả (interceptor bọc thành `{ data }`).
- **Service** chứa logic và truy vấn DB bằng Drizzle (`@forgeflow/database`).
- **Module** khai báo controller / service và export những gì module khác cần.
- Tên file theo hậu tố: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.guard.ts`, `*.decorator.ts`, `*.filter.ts`, `*.interceptor.ts`, `*.pipe.ts`, `*.template.ts`, `*.types.ts`, `*.constants.ts`, `*.util.ts`.
- Schema DB nằm ở `packages/database`, DTO dùng chung với web ở `packages/contracts`.

## Test

Test nằm trong `apps/api/test/`, cùng cấu trúc với `src/` (`test/modules/auth/…` ứng với `src/modules/auth/…`). Package dùng chung giữ test trong `packages/<tên>/test/`.

- `*.test.ts`: unit test, không cần dịch vụ ngoài.
- `*.int.test.ts`: integration test, chạy với PostgreSQL và Mailpit thật (`npm run db:up`). Trước mỗi lần chạy, Jest tạo lại một database riêng tên `<tên DB>_test` (hoặc `TEST_DATABASE_URL`) và áp dụng migration; database dev không bị đụng tới. Test email gửi qua Mailpit rồi đọc lại bằng HTTP API của nó, mỗi test dùng một địa chỉ nhận riêng.

## Quy ước API

- Mọi endpoint nằm dưới `/api/v1`.
- Response thành công: `{ "data": ... }`. Lỗi: `{ "error": { "code", "message", "requestId", "details?" } }`, với `code` lấy từ `ErrorCode` trong `@forgeflow/contracts`.
- Mỗi request có `X-Request-Id` (dùng lại giá trị client gửi nếu hợp lệ, nếu không thì tự sinh); id này có trong log và trong body lỗi.
- Body / query được validate bằng `ZodValidationPipe` với schema từ `@forgeflow/contracts`.

## Xác thực

**Mặc định mọi route đều cần access token.** Route công khai phải gắn `@Public()`.

| Endpoint                                   | Cần đăng nhập | Việc làm                                                                      |
| ------------------------------------------ | ------------- | ----------------------------------------------------------------------------- |
| `POST /api/v1/auth/register`               | Không         | Tạo tài khoản email + mật khẩu, đăng nhập luôn (`201`), gửi email xác minh    |
| `POST /api/v1/auth/login`                  | Không         | Đăng nhập bằng email + mật khẩu                                               |
| `POST /api/v1/auth/refresh`                | Cookie        | Đổi refresh cookie lấy access token mới (xoay vòng)                           |
| `POST /api/v1/auth/logout`                 | Cookie        | Thu hồi lần đăng nhập của trình duyệt này, xoá cookie                         |
| `GET /api/v1/auth/me`                      | Có            | Người dùng của access token                                                   |
| `POST /api/v1/auth/verify-email`           | Không         | Xác minh email bằng `{ token }` từ link trong email                           |
| `POST /api/v1/auth/verify-email/resend`    | Có            | Gửi lại link xác minh (link cũ hết hiệu lực)                                  |
| `POST /api/v1/auth/password/forgot`        | Không         | Gửi link đặt lại mật khẩu nếu email có tài khoản; luôn `204`                  |
| `POST /api/v1/auth/password/reset`         | Không         | Đặt mật khẩu mới bằng `{ token, password }`, đăng xuất mọi thiết bị           |
| `POST /api/v1/auth/password/change`        | Có            | Đổi mật khẩu bằng `{ currentPassword, newPassword }`, đăng xuất thiết bị khác |
| `GET /api/v1/auth/sessions`                | Có            | Các thiết bị đang đăng nhập; `current` là thiết bị gọi request                |
| `DELETE /api/v1/auth/sessions/:id`         | Có            | Đăng xuất một thiết bị                                                        |
| `POST /api/v1/auth/sessions/revoke-others` | Có            | Đăng xuất mọi thiết bị trừ thiết bị này                                       |
| `GET /api/v1/auth/github`                  | Không         | Bắt đầu đăng nhập bằng GitHub (chuyển hướng sang GitHub)                      |
| `GET /api/v1/auth/github/callback`         | Không         | GitHub chuyển về đây; đăng nhập rồi chuyển về web app                         |

### Token và cookie

- **Access token**: JWT ký HS256 bằng `JWT_SECRET`, sống 15 phút, chỉ chứa user id (`sub`), `jti`, issuer `forgeflow`, audience `forgeflow-api`. Gửi qua header `Authorization: Bearer <token>`; server không tra DB khi kiểm tra. Hết hạn thì API trả `401` với mã `TOKEN_EXPIRED`.
- **Refresh token**: chuỗi ngẫu nhiên 32 byte trong cookie `ff_refresh` (`HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`). Khi `COOKIE_SECURE` bật (mặc định ở production), cookie có thêm `Secure` và tên `__Secure-ff_refresh`. DB (bảng `refresh_tokens`) chỉ lưu hash SHA-256.
- **Xoay vòng**: mỗi lần refresh, token cũ bị thay bằng token mới cùng "family" (một family là một lần đăng nhập, tức một thiết bị).
  - Token đã bị thay mà dùng lại sau 30 giây → coi như bị đánh cắp, cả family bị thu hồi.
  - Dùng lại trong vòng 30 giây (hai tab refresh cùng lúc) → `409 CONFLICT`, lần đăng nhập vẫn còn; client thử lại.
- Refresh token hết hạn sau 7 ngày không dùng; một lần đăng nhập kéo dài tối đa 30 ngày. Đăng nhập mới trên trình duyệt còn cookie cũ thì family cũ bị thu hồi.
- Đăng xuất, đổi / đặt lại mật khẩu hay thu hồi thiết bị chỉ chặn refresh token; access token đã phát vẫn dùng được tới khi hết hạn (tối đa 15 phút) — đánh đổi của token không trạng thái.

### Đăng ký, đăng nhập, mật khẩu

- Email được trim và chuyển chữ thường; email đã có tài khoản (không phân biệt hoa thường) → `409 EMAIL_TAKEN`.
- Sai mật khẩu, email không tồn tại hay tài khoản chỉ có OAuth đều trả cùng lỗi `401 INVALID_CREDENTIALS`, thời gian xử lý như nhau.
- Mật khẩu 8–128 ký tự, không bắt buộc kiểu ký tự; băm argon2id (`m=19456 KiB, t=2, p=1`), DB chỉ lưu chuỗi PHC. Hash tham số cũ được băm lại khi đăng nhập.
- Đổi mật khẩu cần mật khẩu hiện tại (sai → `400 INVALID_PASSWORD`); tài khoản chưa có mật khẩu → `409 PASSWORD_NOT_SET`, dùng "quên mật khẩu" để đặt.
- Mỗi lần đổi / đặt lại mật khẩu đều gửi email thông báo.

### Email xác minh và đặt lại mật khẩu

- Link trong email có dạng `<APP_ORIGIN>/verify-email#token=…` và `<APP_ORIGIN>/reset-password#token=…`. Token nằm sau `#` nên không bao giờ tới server của web hay header `Referer`; trang web đọc token rồi gọi API.
- Token 32 byte ngẫu nhiên, DB (bảng `user_tokens`) chỉ lưu hash SHA-256. Mỗi token dùng một lần, chỉ còn hiệu lực khi email của tài khoản vẫn là địa chỉ đã nhận link, và chỉ link mới nhất của mỗi loại dùng được.
- Link xác minh sống 24 giờ, link đặt lại mật khẩu 1 giờ. Link sai / hết hạn / đã dùng → `400 INVALID_TOKEN`.
- Đặt lại mật khẩu cũng đánh dấu email đã xác minh (link chứng minh quyền với hộp thư) và mở khoá đăng nhập nếu đang bị khoá.
- "Quên mật khẩu" luôn trả `204` và tạo token + gửi email ở nền, nên cả nội dung lẫn thời gian phản hồi đều không tiết lộ email có tài khoản hay không.

### Rate limit

Vượt giới hạn → `429 RATE_LIMITED` kèm header `Retry-After` (giây). Bộ đếm cửa sổ cố định nằm trong PostgreSQL (bảng `rate_limit_counters`, chuyển sang Redis ở Phase 11). Giới hạn nằm ở `common/constants/rate-limit.constants.ts`:

| Giới hạn                            | Mức                                           |
| ----------------------------------- | --------------------------------------------- |
| Đăng nhập theo IP                   | 30 lần / 15 phút                              |
| Đăng nhập theo email (khoá tạm)     | 10 lần / 15 phút                              |
| Đăng ký theo IP                     | 10 lần / giờ                                  |
| Quên mật khẩu theo IP               | 10 lần / giờ                                  |
| Email đặt lại mật khẩu theo địa chỉ | 3 email / giờ (vượt thì vẫn `204`, không gửi) |
| Dùng link email theo IP             | 30 lần / 15 phút                              |
| Gửi lại email xác minh theo user    | 3 lần / giờ                                   |
| Đổi mật khẩu theo user              | 5 lần / 15 phút                               |
| GitHub OAuth theo IP                | 30 lần / 15 phút                              |

- **Khoá tạm**: đếm số lần thử của một email kể từ lần đăng nhập thành công gần nhất; quá giới hạn thì email bị khoá tới hết cửa sổ, kể cả khi nhập đúng mật khẩu. Áp dụng cả với email không có tài khoản nên không dò được. Đặt lại mật khẩu mở khoá.
- **Sau reverse proxy phải đặt `TRUST_PROXY`** (số hop, ví dụ `1`, hoặc địa chỉ proxy). Không đặt thì `X-Forwarded-For` bị bỏ qua — an toàn, nhưng sau proxy mọi người dùng sẽ chung IP của proxy và chung bộ đếm. Ở local, `.env.example` đặt `loopback` vì web dev server proxy `/api`.

### Đăng nhập bằng GitHub

1. Tạo OAuth app tại https://github.com/settings/developers với callback `<APP_ORIGIN>/api/v1/auth/github/callback` (local: `http://localhost:3000/api/v1/auth/github/callback`), rồi đặt `GITHUB_CLIENT_ID` và `GITHUB_CLIENT_SECRET` (đặt cả hai hoặc không đặt; không đặt thì hai route trả `404`).
2. Web app mở `/api/v1/auth/github`. API lưu `state` + PKCE verifier trong cookie `ff_oauth` (`HttpOnly`, `SameSite=Lax`, 10 phút) và chuyển sang GitHub (scope `read:user user:email`).
3. GitHub chuyển về callback. API kiểm tra `state`, đổi code lấy profile, chọn email chính đã được GitHub xác minh, rồi:
   - tài khoản GitHub đã liên kết → đăng nhập user đó;
   - có user cùng email → liên kết. Nếu email của user đó **chưa xác minh**, mật khẩu, mọi lần đăng nhập và link đang chờ của nó bị xoá trước (chống chiếm trước tài khoản — ai đó đăng ký bằng email của người khác);
   - chưa có → tạo user mới, email đã xác minh, không có mật khẩu.
4. Thành công: đặt refresh cookie, chuyển về `<APP_ORIGIN>/` (web gọi `/auth/refresh` để lấy access token). Thất bại: chuyển về `<APP_ORIGIN>/login?error=<mã>` với mã trong `OAuthError` của `@forgeflow/contracts` (`oauth_denied`, `oauth_state`, `github_email_unverified`, `github_account_conflict`, `oauth_failed`).

Access token của GitHub chỉ dùng để đọc profile rồi bỏ, không lưu.

### CSRF và production

- Access token không nằm trong cookie nên request API thường không thể bị giả mạo. Thêm vào đó, mọi request `POST`/`PUT`/`PATCH`/`DELETE` bị từ chối (`403 ORIGIN_NOT_ALLOWED`) nếu trình duyệt đánh dấu `Sec-Fetch-Site: cross-site` hoặc `Origin` khác `APP_ORIGIN`. Callback GitHub được bảo vệ bằng `state`.
- Ở production, api từ chối khởi động nếu `JWT_SECRET` ngắn hơn 32 ký tự hoặc là giá trị dev trong `.env.example`.

## Docker image

```bash
docker build -f infra/docker/api.Dockerfile -t forgeflow-api .
docker build -f infra/docker/web.Dockerfile -t forgeflow-web .

# Migration chạy như một bước riêng trước khi bản mới nhận traffic
docker run --rm -e DATABASE_URL=postgres://... forgeflow-api node packages/database/dist/scripts/migrate.js
```

## Ghi chú kỹ thuật

- **ESM toàn repo** (`"type": "module"`): NestJS 12 chỉ hỗ trợ ESM. Import tương đối phải có đuôi `.js`.
- **TypeScript ghim ở 6.0.x**: `typescript-eslint` hiện chỉ hỗ trợ TypeScript < 6.1, nên chưa lên TypeScript 7.
- **Test dùng Jest ở chế độ ESM**: `npm test` chạy Node với `--experimental-vm-modules`. TypeScript được dịch bằng `@swc/jest` vì NestJS cần decorator metadata. Cấu hình ở `jest.config.js`; code test được type-check qua `tsconfig.test.json`.
- **Package dùng chung được build ra `dist/`** bằng TypeScript project references; `npm run dev` giữ `tsc -b -w` chạy nên sửa package là api tự restart.
- **`.env` không bao giờ được commit.** Production nhận cấu hình từ môi trường deploy.

## Deploy

Chưa có bản production. Error tracking sẽ dùng Sentry.
