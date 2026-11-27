# ForgeFlow

ForgeFlow là control plane đa tenant nối các bước **deploy → giám sát → phát hiện sự cố → điều tra → người duyệt → khắc phục → xác minh hồi phục**. Nó làm việc trên các công cụ sẵn có của team (GitHub, Prometheus/Alertmanager, Argo CD) thay vì thay thế chúng.

**Trạng thái:** đang phát triển — đã có tài khoản, organization và phân quyền, project / environment, integration với secret mã hoá, theo dõi deployment từ GitHub và từ pipeline bất kỳ. Chưa có bản production.

Hướng dẫn cho người dùng: [theo dõi deployment từ GitHub](guides/github.md), [báo deploy từ pipeline](guides/report-api.md).

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
2. Bật PostgreSQL (pgvector) và Mailpit bằng Docker Compose, chờ healthy; tạo role `forgeflow_app` mà api dùng để kết nối (`npm run db:app-role`).
3. Build các package TypeScript, áp dụng migration.
4. Chạy song song: TypeScript watch, api (tự restart khi code đổi), worker (việc nền, xem "Worker và transactional outbox"), web.

| Địa chỉ                             | Nội dung                                       |
| ----------------------------------- | ---------------------------------------------- |
| http://localhost:3000               | Web: đăng nhập / đăng ký, tổng quan, tài khoản |
| http://localhost:4000/api/v1/health | Liveness của api                               |
| http://localhost:4000/api/v1/ready  | Readiness (kiểm tra DB)                        |
| http://localhost:8025               | Mailpit: hộp thư nhận mọi email api gửi        |

Email ở local không đi ra ngoài: api gửi qua SMTP tới Mailpit (`SMTP_URL=smtp://localhost:1025`), mở http://localhost:8025 để đọc.

Nếu cổng đã bị chiếm, đặt cổng khác trước khi chạy và sửa `.env` cho khớp: `FORGEFLOW_DB_PORT` (mặc định 5432, sửa `DATABASE_URL`), `FORGEFLOW_SMTP_PORT` (1025, sửa `SMTP_URL`), `FORGEFLOW_MAILPIT_PORT` (8025, đặt `MAILPIT_URL` cho test).

## Script

| Lệnh                                                                        | Việc làm                                                                                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                               | Chạy toàn bộ môi trường local                                                                                    |
| `npm run build`                                                             | Build packages, api và web                                                                                       |
| `npm run typecheck`                                                         | Kiểm tra kiểu toàn repo, gồm cả code test                                                                        |
| `npm run lint`                                                              | ESLint                                                                                                           |
| `npm run format` / `format:check`                                           | Prettier                                                                                                         |
| `npm test`                                                                  | Build rồi chạy Jest (unit + integration, cần `db:up`)                                                            |
| `npm run test:unit`                                                         | Chỉ chạy unit test, không cần dịch vụ ngoài                                                                      |
| `npm run db:up` / `db:down`                                                 | Bật / tắt PostgreSQL và Mailpit local                                                                            |
| `npm run db:app-role`                                                       | Tạo / cập nhật role `forgeflow_app` ở local (chạy lại an toàn)                                                   |
| `npm run db:generate`                                                       | Sinh migration từ schema Drizzle (`drizzle-kit generate`)                                                        |
| `npm run db:migrate`                                                        | Áp dụng migration (chạy lặp lại an toàn)                                                                         |
| `npm run db:reset`                                                          | Xoá sạch và migrate lại — chỉ chạy được với DB localhost                                                         |
| `npm run db:seed`                                                           | Nạp dữ liệu mẫu                                                                                                  |
| `npm run secrets:rewrap`                                                    | Chuyển mọi secret của integration sang khoá mã hoá mới nhất (xoay `SECRET_ENCRYPTION_KEYS`)                      |
| `npm run github:app -- --origin <url> --ssh <user@host> \| --env-file .env` | Tạo GitHub App bằng một cú bấm (App Manifest flow) và ghi 6 biến `GITHUB_APP_*` vào `.env` của server hoặc local |
| `npm run github:replay -- <event> <file>`                                   | Gửi một webhook GitHub có ký tới api local (thử GitHub App không cần GitHub)                                     |

## Cấu trúc

```text
apps/
  api/          NestJS 12 — REST API, webhook ingress, health (xem "Cấu trúc api")
  web/          Next.js 16 — dashboard (xem "Giao diện web")
    src/app/        Route (App Router): (auth)/ trang đăng nhập…, (app)/ trang cần đăng nhập
    src/features/   Tính năng: component + cách nạp dữ liệu của nó (auth, account, home…)
    src/components/ ui/ (shadcn/ui), header, logo
    src/lib/        Tiện ích dùng chung (api-client, cn)
packages/
  config/       Nạp .env và validate biến môi trường bằng zod
  contracts/    Schema zod + kiểu dùng chung giữa api và web (envelope, auth, organizations,
                RBAC, project, integration, GitHub, deployment, outbox, health)
  database/     Drizzle: schema, migration, script migrate/reset/seed
infra/
  compose/      Docker Compose cho môi trường local
  docker/       Dockerfile của api và web
scripts/        Script tiện ích cho môi trường dev (tạo .env, gửi lại webhook GitHub…)
tools/          Script người dùng chạy trong pipeline của họ (report-deployment.sh)
.github/actions/report-deployment/
                Composite action báo deploy cho workflow GitHub không dùng GitHub Deployments
```

## Cấu trúc api

`apps/api` dùng cấu trúc NestJS thông thường: mỗi tính năng là một module chỉ gồm controller, service và file module. Decorator, guard, type, hằng số… nằm trong `common/`, chia thư mục theo loại.

```text
apps/api/src/
  main.ts               Khởi động api
  worker.ts             Khởi động worker (outbox, đối chiếu GitHub); worker.module.ts
  app.module.ts         Module gốc: nạp các module, guard / filter / interceptor toàn cục
  app.factory.ts        Tạo app Nest (dùng chung cho main.ts và test)
  config/env.ts         Biến môi trường (zod)
  database/             DatabaseModule (pool + Drizzle)
  common/
    constants/          Hằng số: injection token, metadata key, API prefix, chính sách token,
                        cookie, rate limit
    decorators/         @Public(), @CurrentAuth(), @RateLimit(), @RequirePermission(),
                        @CurrentMembership()
    filters/            HttpExceptionFilter (bọc lỗi thành { error })
    guards/             JwtAuthGuard, OriginGuard (CSRF), RateLimitGuard, OrgPermissionGuard,
                        ApiTokenGuard (report API)
    interceptors/       EnvelopeInterceptor (bọc kết quả thành { data })
    pipes/              ZodValidationPipe
    templates/          Template email (layout chung, xác minh, đặt lại / đã đổi mật khẩu, lời mời)
    types/              Kiểu dữ liệu dùng chung (AuthContext, ClientInfo, kết quả xoay token…)
    utils/              Hàm thuần: request id, clock, client info, secret token / PKCE,
                        xoay refresh token, escape HTML, link tới web app
  modules/
    auth/               Controller: Auth, EmailVerification, Password, Sessions, GithubAuth
                        Service: Auth, AccessToken, RefreshToken, Password, UserToken,
                        EmailVerification, PasswordReset, AuthMail, GithubOAuth,
                        GithubSignIn, RefreshCookie, OAuthStateCookie
    users/              UsersService (users, tài khoản OAuth liên kết)
    organizations/      Controller: Organizations, Members, Invitations, InvitationAcceptance
                        Service: Organizations, Memberships, Invitations
    mail/               MailService (gửi email qua SMTP)
    rate-limit/         RateLimitService (bộ đếm cửa sổ cố định trong PostgreSQL)
    projects/           Project, environment
    integrations/       Integration, secret mã hoá envelope
    audit/              AuditService, AuditController (nhật ký hoạt động)
    webhooks/           WebhooksController (nhận webhook, kiểm chữ ký), WebhooksService
    outbox/             OutboxService, OutboxController (việc dead), OutboxWorkerService (worker)
    github/             GitHub App: GithubAppService (API GitHub), GithubInstallations,
                        Repositories, GithubWebhooks (xử lý event), GithubReconcile
    deployments/        Deployments, Reports (report API), ApiTokens
    health/             HealthController (/health, /ready)
```

- **Controller** nhận request, gọi service, trả kết quả (interceptor bọc thành `{ data }`).
- **Service** chứa logic và truy vấn DB bằng Drizzle (`@forgeflow/database`).
- **Module** khai báo controller / service và export những gì module khác cần.
- Tên file theo hậu tố: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.guard.ts`, `*.decorator.ts`, `*.filter.ts`, `*.interceptor.ts`, `*.pipe.ts`, `*.template.ts`, `*.types.ts`, `*.constants.ts`, `*.util.ts`.
- Schema DB nằm ở `packages/database`, DTO dùng chung với web ở `packages/contracts`.

## Test

Test nằm trong `apps/api/test/` và `apps/web/test/`, cùng cấu trúc với `src/` (`test/modules/auth/…` ứng với `src/modules/auth/…`). Package dùng chung giữ test trong `packages/<tên>/test/`. Ở web mới có unit test cho các hàm thuần (thông báo, validate, chặn open redirect…).

- `*.test.ts`: unit test, không cần dịch vụ ngoài.
- `*.int.test.ts`: integration test, chạy với PostgreSQL và Mailpit thật (`npm run db:up`). Trước mỗi lần chạy, Jest tạo lại một database riêng tên `<tên DB>_test` (hoặc `TEST_DATABASE_URL`) và áp dụng migration; database dev không bị đụng tới. Test email gửi qua Mailpit rồi đọc lại bằng HTTP API của nó, mỗi test dùng một địa chỉ nhận riêng.
- Integration test dùng hai kết nối như production: api trong test chạy bằng role `forgeflow_app` (chịu RLS, `testDatabaseUrl()`); fixture ghi thẳng vào DB dùng owner (bỏ qua RLS, `testOwnerDatabaseUrl()`).

## Quy ước API

- Mọi endpoint nằm dưới `/api/v1`.
- Response thành công: `{ "data": ... }`. Lỗi: `{ "error": { "code", "message", "requestId", "details?" } }`, với `code` lấy từ `ErrorCode` trong `@forgeflow/contracts`.
- Mỗi request có `X-Request-Id` (dùng lại giá trị client gửi nếu hợp lệ, nếu không thì tự sinh); id này có trong log và trong body lỗi.
- Body / query được validate bằng `ZodValidationPipe` với schema từ `@forgeflow/contracts`.

## Giao diện web

`apps/web` dùng Next.js 16 (App Router), Tailwind CSS v4 và [shadcn/ui](https://ui.shadcn.com) (style `radix-nova`). Giao diện bằng tiếng Việt; font Inter có bộ ký tự tiếng Việt.

| Trang                                            | Nội dung                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `/login`                                         | Đăng nhập bằng email + mật khẩu hoặc GitHub (nút chỉ hiện khi đã cấu hình)                     |
| `/register`                                      | Tạo tài khoản                                                                                  |
| `/forgot-password`                               | Gửi link đặt lại mật khẩu                                                                      |
| `/reset-password`                                | Mở từ email: đặt mật khẩu mới                                                                  |
| `/verify-email`                                  | Mở từ email: xác minh email                                                                    |
| `/`                                              | Mở organization dùng gần nhất; chưa có org thì màn hình tạo org đầu tiên                       |
| `/orgs/new`                                      | Tạo organization                                                                               |
| `/orgs/[orgId]`                                  | Tổng quan organization (vai trò của bạn, trạng thái hệ thống)                                  |
| `/orgs/[orgId]/projects`                         | Các project và environment của chúng; owner / admin tạo project                                |
| `/orgs/[orgId]/projects/[projectId]`             | Một project: đổi tên; environment (thêm, đổi tên, bật / tắt bảo vệ); API token (owner / admin) |
| `/orgs/[orgId]/projects/[projectId]/deployments` | Deployment và lần chạy CI của project: lọc theo environment, loại, trạng thái                  |
| `/orgs/[orgId]/members`                          | Thành viên (đổi vai trò, xoá, rời) và lời mời (gửi, thu hồi)                                   |
| `/orgs/[orgId]/integrations`                     | GitHub App: kết nối, gắn repository vào project, webhook gần đây; việc nền lỗi                 |
| `/orgs/[orgId]/audit`                            | Nhật ký hoạt động (owner / admin)                                                              |
| `/orgs/[orgId]/settings`                         | Đổi tên, rời organization                                                                      |
| `/invitations/accept`                            | Mở từ email mời: xem và nhận lời mời                                                           |
| `/account`                                       | Tài khoản (cần đăng nhập): thông tin, đổi mật khẩu, thiết bị đăng nhập                         |

- **Phiên đăng nhập** (`src/features/auth/auth-provider.tsx`): access token chỉ nằm trong bộ nhớ của tab, không lưu vào storage. Khi tải trang, web gọi `POST /api/v1/auth/refresh` (refresh cookie `HttpOnly`) để lấy lại; tự refresh 1 phút trước khi token hết hạn, và refresh rồi thử lại một lần khi API trả `401`.
  - Mỗi lần refresh thay cookie, nên chỉ một lần refresh chạy tại một thời điểm: trong một tab nhờ promise dùng chung, giữa các tab nhờ Web Locks API.
  - Đăng xuất / đăng nhập ở một tab được báo cho các tab khác qua `BroadcastChannel`.
  - Trang cần đăng nhập nằm trong `(app)/`; `RequireAuth` chuyển khách chưa đăng nhập tới `/login?next=…` (chỉ nhận đường dẫn trong site, chống open redirect).
- **Link trong email**: trang đọc token sau `#`, xoá nó khỏi thanh địa chỉ và lịch sử rồi mới gọi API; các trang này đặt `Referrer-Policy: no-referrer`. Trang nhận lời mời giữ token trong `sessionStorage` của tab, nên token còn nguyên khi người được mời phải đăng nhập / đăng ký trước (trang đăng ký điền sẵn email được mời).
- **Project** (`src/features/projects/`): danh sách project, trang một project với bảng environment. Tắt bảo vệ một environment phải xác nhận; trùng tên hiện ngay dưới ô nhập (`409 NAME_TAKEN`).
- **Organization** (`src/features/organizations/`): danh sách org của user nạp một lần (`OrganizationsProvider`), header có ô chọn org; các trang `/orgs/[orgId]` chỉ hiện với thành viên (`OrganizationScope`). Nút và ô chọn vai trò chỉ hiện khi vai trò cho phép, theo cùng ma trận RBAC với api (`can`, `canManageMember`, `canAssignRole` trong `@forgeflow/contracts`); api vẫn kiểm tra mọi request.
- **Thông báo**: form validate bằng chính schema zod trong `@forgeflow/contracts` (cùng quy tắc với api), nhưng thông báo tiếng Việt được dựng từ loại lỗi và tên trường (`src/features/auth/validation.ts`). Lỗi từ api được hiển thị theo mã lỗi (`src/features/auth/messages.ts`), không dùng câu tiếng Anh của api.
- **Thêm component shadcn**: `cd apps/web && npx shadcn@latest add <tên>` (cấu hình ở `apps/web/components.json`), rồi chạy `npm run format`.

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
| `GET /api/v1/auth/providers`               | Không         | Cách đăng nhập nào đang bật (`{ github }`), cho trang đăng nhập               |
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

| Giới hạn                                  | Mức                                           |
| ----------------------------------------- | --------------------------------------------- |
| Đăng nhập theo IP                         | 30 lần / 15 phút                              |
| Đăng nhập theo email (khoá tạm)           | 10 lần / 15 phút                              |
| Đăng ký theo IP                           | 10 lần / giờ                                  |
| Quên mật khẩu theo IP                     | 10 lần / giờ                                  |
| Email đặt lại mật khẩu theo địa chỉ       | 3 email / giờ (vượt thì vẫn `204`, không gửi) |
| Dùng link email theo IP                   | 30 lần / 15 phút                              |
| Gửi lại email xác minh theo user          | 3 lần / giờ                                   |
| Đổi mật khẩu theo user                    | 5 lần / 15 phút                               |
| GitHub OAuth theo IP                      | 30 lần / 15 phút                              |
| Mời thành viên theo user                  | 30 lời mời / giờ                              |
| Webhook theo IP                           | 3000 lần / phút                               |
| Report API theo IP (trước khi kiểm token) | 600 lần / phút                                |

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

## Organization và phân quyền

Mọi thứ ForgeFlow quản lý thuộc về một organization (tenant). Một user có thể ở nhiều org, mỗi org một vai trò.

| Endpoint                                              | Quyền cần             | Việc làm                                                 |
| ----------------------------------------------------- | --------------------- | -------------------------------------------------------- |
| `POST /api/v1/organizations`                          | email đã xác minh     | Tạo org; người tạo là owner                              |
| `GET /api/v1/organizations`                           | đăng nhập             | Các org của mình, kèm vai trò                            |
| `GET /api/v1/organizations/:orgId`                    | `organization.read`   | Xem org                                                  |
| `PATCH /api/v1/organizations/:orgId`                  | `organization.update` | Đổi tên                                                  |
| `GET /api/v1/organizations/:orgId/members`            | `members.read`        | Danh sách thành viên                                     |
| `PATCH /api/v1/organizations/:orgId/members/:userId`  | `members.manage`      | Đổi vai trò (theo thứ bậc bên dưới)                      |
| `DELETE /api/v1/organizations/:orgId/members/:userId` | `members.read`        | Xoá thành viên (theo thứ bậc); xoá chính mình là rời org |
| `POST /api/v1/organizations/:orgId/invitations`       | `invitations.manage`  | Mời qua email (người mời cần email đã xác minh)          |
| `GET /api/v1/organizations/:orgId/invitations`        | `invitations.manage`  | Lời mời đang chờ                                         |
| `DELETE /api/v1/organizations/:orgId/invitations/:id` | `invitations.manage`  | Thu hồi lời mời                                          |
| `POST /api/v1/invitations/lookup`                     | không                 | Xem lời mời từ token trong link                          |
| `POST /api/v1/invitations/accept`                     | đăng nhập             | Nhận lời mời (phải đăng nhập bằng đúng email được mời)   |

**Vai trò** (cao xuống thấp): `owner`, `admin`, `member`, `viewer`. Ma trận vai trò × quyền nằm ở `packages/contracts/src/rbac.ts` (`PERMISSIONS`, `can`), dùng chung cho api và web:

| Quyền                  | owner | admin | member | viewer |
| ---------------------- | ----- | ----- | ------ | ------ |
| `organization.read`    | ✓     | ✓     | ✓      | ✓      |
| `organization.update`  | ✓     | ✓     |        |        |
| `members.read`         | ✓     | ✓     | ✓      | ✓      |
| `members.manage`       | ✓     | ✓     |        |        |
| `invitations.manage`   | ✓     | ✓     |        |        |
| `projects.read`        | ✓     | ✓     | ✓      | ✓      |
| `projects.manage`      | ✓     | ✓     |        |        |
| `environments.protect` | ✓     | ✓     |        |        |
| `audit.read`           | ✓     | ✓     |        |        |
| `integrations.read`    | ✓     | ✓     | ✓      | ✓      |
| `integrations.manage`  | ✓     | ✓     |        |        |

- **Thứ bậc**: owner đổi vai trò / xoá / mời được mọi vai trò (kể cả owner khác). Admin chỉ quản lý và chỉ cấp được `member`, `viewer` — không đụng được admin khác hay owner. Ai cũng tự rời org được.
- **Luôn còn ít nhất 1 owner**: hạ quyền hay xoá owner cuối cùng → `409 LAST_OWNER`. Mỗi thay đổi khoá dòng org (`SELECT … FOR UPDATE`) và đọc lại vai trò người thực hiện trong transaction, nên hai owner hạ quyền nhau cùng lúc cũng không làm org mất owner.
- **Kiểm tra quyền** (`OrgPermissionGuard`, guard toàn cục cho route có `@RequirePermission`): org lấy từ `:orgId` trên URL, vai trò lấy từ bảng `memberships` ở **mỗi request** — không từ token, không từ body. Không phải thành viên (hoặc org không tồn tại, id sai định dạng) → `404` giống nhau; thiếu quyền → `403 ROLE_NOT_ALLOWED`. Bị xoá khỏi org là mất quyền ngay.
- **Lời mời**: link `<APP_ORIGIN>/invitations/accept#token=…` (token sau `#`, DB chỉ lưu hash), dùng một lần, hết hạn sau 7 ngày. Mỗi email chỉ có một lời mời đang chờ trong một org: mời lại thì link cũ hết hiệu lực. Không gửi được email → `503` và lời mời bị huỷ. Nhận lời mời đánh dấu email đã xác minh (link chứng minh hộp thư); người đã là thành viên giữ nguyên vai trò.
- Thử bằng REST Client: `apps/api/http/organizations.http`.

## Project và environment

Project là một ứng dụng / dịch vụ mà org vận hành; environment là nơi project chạy. Sau này deployment, incident đều gắn với project và environment.

| Endpoint (dưới `/api/v1/organizations/:orgId`)           | Quyền cần         | Việc làm                                                |
| -------------------------------------------------------- | ----------------- | ------------------------------------------------------- |
| `POST /projects`                                         | `projects.manage` | Tạo project, kèm `development`, `staging`, `production` |
| `GET /projects`                                          | `projects.read`   | Các project theo tên, mỗi project kèm environment       |
| `GET /projects/:projectId`                               | `projects.read`   | Xem một project                                         |
| `PATCH /projects/:projectId`                             | `projects.manage` | Đổi tên                                                 |
| `POST /projects/:projectId/environments`                 | `projects.manage` | Thêm environment (xếp sau các environment khác)         |
| `PATCH /projects/:projectId/environments/:environmentId` | `projects.manage` | Đổi tên và / hoặc bật tắt `protected`                   |

- **Protected**: environment được bảo vệ sẽ cần duyệt trước khi ForgeFlow thay đổi nó (Phase 6). `production` được bảo vệ ngay khi tạo project. Bật / tắt `protected` (kể cả khi thêm environment với `"protected": true`) cần thêm quyền `environments.protect`.
- **Tên** không trùng (không phân biệt hoa thường): project trong cùng org, environment trong cùng project. Trùng → `409 NAME_TAKEN` kèm `details.field = "name"`.
- **Thứ tự environment**: theo cột `position` (development → staging → production → các environment thêm sau). Thêm environment khoá dòng project trong transaction, nên thêm đồng thời vẫn không trùng vị trí.
- Chưa có xoá project / environment.
- Thử bằng REST Client: `apps/api/http/projects.http`.

## Integration và secret

Integration là một kết nối của org tới hệ thống bên ngoài (GitHub ở Phase 2; Alertmanager, webhook, Prometheus… ở các phase sau), có thể gắn với một project. Cấu hình không bí mật nằm trong `integrations.config`; secret (token, mật khẩu, khoá ký) nằm trong `integration_secrets`, **được mã hoá**.

- **Mã hoá envelope**: mỗi phiên bản secret được mã hoá AES-256-GCM bằng một khoá dữ liệu (DEK) ngẫu nhiên riêng; DEK được mã hoá bằng một khoá chính (KEK) trong `SECRET_ENCRYPTION_KEYS` (`<version>:<base64 32 byte>`, cách nhau dấu phẩy, version cao nhất là khoá hiện hành). Bản mã gắn với org / integration / tên / phiên bản (AAD): chép sang dòng khác thì không giải mã được. api từ chối khoá dev của `.env.example` khi `NODE_ENV=production`.
- **Không bao giờ trả secret**: mọi API đọc chỉ trả metadata (tên, phiên bản, ai sinh ra, đang dùng hay đã thu hồi). Code nói chuyện với hệ thống ngoài đọc giá trị qua `IntegrationSecretsService.reveal()`.
- **Đổi secret**: thêm phiên bản mới, phiên bản cũ bị thu hồi. Secret ForgeFlow sinh (`generated`) có giá trị mới trả về **đúng một lần** trong câu trả lời (`Cache-Control: no-store`); secret người dùng nhập (`provided`) cần gửi giá trị mới. Thu hồi: không còn phiên bản nào dùng được cho tới lần đổi tiếp theo. Cả hai được ghi vào nhật ký hoạt động (không kèm giá trị).
- **Xoay khoá chính (KEK)**: thêm khoá mới với version cao hơn vào đầu `SECRET_ENCRYPTION_KEYS` (`2:<mới>,1:<cũ>`), deploy, chạy `npm run secrets:rewrap` (bằng role owner; chỉ mã hoá lại DEK, bản mã giữ nguyên), rồi bỏ khoá cũ. **Mất khoá là mất mọi secret**: sao lưu nó tách khỏi bản dump DB.
- Ở DB: RLS theo org cho cả hai bảng; role `forgeflow_app` không `DELETE` được secret và chỉ `UPDATE` được cột `revoked_at`, nên một bản mã đã lưu không bao giờ bị ghi đè.

| Endpoint (dưới `/api/v1/organizations/:orgId`) | Quyền cần             | Việc làm                                                    |
| ---------------------------------------------- | --------------------- | ----------------------------------------------------------- |
| `GET /integrations`, `GET /integrations/:id`   | `integrations.read`   | Integration kèm metadata secret                             |
| `POST /integrations/:id/secrets/:name/rotate`  | `integrations.manage` | Đổi secret (`{ "value": … }` với secret do người dùng nhập) |
| `DELETE /integrations/:id/secrets/:name`       | `integrations.manage` | Thu hồi secret                                              |

Tạo integration không có route chung: luồng kết nối của từng loại (cài GitHub App…) gọi `IntegrationsService.create()`.

## Worker và transactional outbox

Việc không nên chạy trong request (xử lý webhook, gọi GitHub, sau này gửi thông báo…) đi qua **transactional outbox**: code ghi một dòng vào `outbox_events` **trong cùng transaction** với thay đổi sinh ra nó, rồi process **worker** (`apps/api/src/worker.ts`, cùng image với api) lấy ra xử lý. Không có chuyện thay đổi đã lưu mà việc kèm theo bị mất, hay việc chạy cho một thay đổi đã rollback.

- **Lấy việc**: `FOR UPDATE SKIP LOCKED` theo topic, mỗi lần tối đa 10 việc, mỗi việc có một lease 60 giây (`locked_until`) và một fencing token (`lock_token`). Trong lúc xử lý batch, worker gia hạn lease của các việc còn cầm mỗi 20 giây (tối đa 30 phút, để handler bị treo không giữ việc mãi). Worker chết giữa chừng thì hết lease việc được lấy lại, và worker cũ không ghi đè được kết quả của worker mới. Nhiều worker chạy song song an toàn.
- **Đánh thức**: `LISTEN forgeflow_outbox` (`pg_notify` khi thêm việc), kèm quét mỗi 5 giây phòng khi mất thông báo.
- **Thử lại**: lỗi thì thử lại sau 10 giây, 20, 40… (tối đa 1 giờ, ±20% ngẫu nhiên); sau 8 lần, hoặc khi handler ném `PermanentOutboxError` (dữ liệu hỏng, thử lại vô ích), việc chuyển sang `dead` cùng lỗi cuối. Owner / admin xem và chạy lại việc `dead` ở trang **Tích hợp** (ghi `outbox_event.retried` vào nhật ký).
- **Sức khoẻ**: worker ghi `/tmp/forgeflow-worker.alive` mỗi vòng lặp và mỗi lần gia hạn lease; healthcheck của container kiểm tra file này mới hơn 1 phút. Dừng (`SIGTERM`) thì xử lý xong batch đang cầm rồi mới thoát (việc chưa xong khi container bị giết sẽ hết lease và được lấy lại).
- Ở DB: role `forgeflow_app` không `DELETE` được `outbox_events`; việc nhận / xong / lỗi đi qua các hàm `SECURITY DEFINER` hẹp (`forgeflow_claim_outbox_events`, `forgeflow_renew_outbox_leases`, `forgeflow_complete_outbox_event`, `forgeflow_fail_outbox_event`) vì worker làm việc cho mọi org.

| Endpoint (dưới `/api/v1/organizations/:orgId`) | Quyền cần             | Việc làm                                  |
| ---------------------------------------------- | --------------------- | ----------------------------------------- |
| `GET /events/dead`                             | `integrations.manage` | Việc nền đã dừng thử, mới nhất trước      |
| `POST /events/:eventId/retry`                  | `integrations.manage` | Chạy lại ngay (`204`), đếm lại số lần thử |

## GitHub App

ForgeFlow theo dõi deployment qua một **GitHub App** (không phải OAuth app đăng nhập): org cài App vào tài khoản / organization GitHub của họ, chọn repository, ForgeFlow nhận webhook và đọc API của GitHub bằng token của bản cài đặt đó. App chỉ cần quyền **đọc**. Đăng ký App và đặt biến môi trường: `npm run github:app` (tạo App bằng một cú bấm trên GitHub rồi ghi các biến; xem [infra/staging/README.md](infra/staging/README.md#github-app)). Không đặt 6 biến `GITHUB_APP_*` thì tính năng tắt (`GET /github/app` trả `configured: false`, nút kết nối không hiện).

- **Kết nối** (owner / admin, trang **Tích hợp**): `POST …/integrations/github/install` trả link cài App kèm `state` (JWT ngắn hạn) và đặt cookie `ff_github` cho cùng trình duyệt. GitHub đưa trình duyệt về `GET /api/v1/github/setup`, api kiểm tra: `state` và cookie khớp; đổi `code` (App bật "Request user authorization during installation") lấy token của người dùng GitHub và xác nhận bản cài đặt nằm trong `/user/installations` của **chính người đó** (không thể nhận bản cài đặt của người khác bằng cách đoán `installation_id`); người bấm vẫn còn quyền `integrations.manage`. Rồi mới tạo integration và nạp danh sách repository. Lỗi nào cũng quay về trang Tích hợp với `?github_error=<mã>`.
- **Một bản cài đặt thuộc một org** (`unique (kind, external_id)`); kết nối lại cùng tài khoản GitHub thì dùng lại integration cũ.
- **Repository → project**: mỗi repository của bản cài đặt được gắn với tối đa một project (`PATCH /repositories/:id`, ghi `repository.mapped`). Repository chưa gắn thì deployment của nó bị bỏ qua.
- **Webhook GitHub** được theo dõi: `installation` (gỡ / tạm ngưng → integration `disabled`, mở lại → `active`), `installation_repositories`, `deployment`, `deployment_status`, `workflow_run`.
- **Đối chiếu**: GitHub không hứa giao đủ webhook, nên mỗi 10 phút worker đọc lại 30 deployment và 30 lần chạy Actions mới nhất của mọi repository đã gắn và ghi chúng như webhook (idempotent, không đếm trùng). Status chỉ được đọc cho deployment chưa biết hoặc chưa kết thúc, nên mỗi repository tốn khoảng 2 request mỗi lượt, xa giới hạn 5000 request / giờ của một bản cài đặt.
- Private key của App chỉ nằm trong biến môi trường; token cài đặt (1 giờ) được giữ trong bộ nhớ tới 5 phút trước khi hết hạn.

### Webhook

`POST /api/v1/webhooks/github` (công khai, rate limit theo IP):

1. Kiểm tra chữ ký `X-Hub-Signature-256` (HMAC-SHA256 trên **đúng byte** GitHub gửi, so sánh thời gian hằng) bằng `GITHUB_APP_WEBHOOK_SECRET`. Sai → `401 INVALID_SIGNATURE`.
2. Ghi `webhook_deliveries` và một việc `github.webhook` vào outbox trong một transaction, khử trùng theo `X-GitHub-Delivery`: GitHub gửi lại cùng delivery thì không xử lý lần hai.
3. Trả `202` ngay (GitHub chỉ chờ 10 giây); worker xử lý sau.

Owner / admin xem các delivery gần đây của một bản cài đặt ở trang Tích hợp.

**Thử ở local**: GitHub không gọi được `localhost`, nên hoặc:

- Tạo một App dev riêng, webhook qua tunnel: `npm run github:app -- --origin http://localhost:3000 --env-file .env --webhook-url https://smee.io/<kênh>` (tạo kênh ở https://smee.io), rồi khởi động lại `npm run dev`. Script ghi 6 biến vào `.env` và in lệnh chạy tunnel. Hoặc tự mở tunnel tới api và đặt webhook URL của App là địa chỉ tunnel + `/api/v1/webhooks/github`: `npx smee-client --url https://smee.io/<kênh> --target http://localhost:4000/api/v1/webhooks/github`, hoặc `cloudflared tunnel --url http://localhost:4000`. Callback URL của App vẫn là `http://localhost:3000/api/v1/github/setup` (trình duyệt của bạn mở nó, không cần tunnel).
- Hoặc không cần GitHub: gửi lại payload mẫu có ký bằng `GITHUB_APP_WEBHOOK_SECRET` trong `.env`: `npm run github:replay -- deployment apps/api/test/fixtures/github/deployment.created.json --installation <id>` (`--times 3` gửi cùng một delivery ba lần để xem khử trùng).

| Endpoint                                                         | Quyền cần             | Việc làm                                   |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------ |
| `GET /api/v1/github/app`                                         | đăng nhập             | App đã cấu hình chưa, slug của nó          |
| `POST /api/v1/organizations/:orgId/integrations/github/install`  | `integrations.manage` | Link cài App (đặt cookie `state`)          |
| `GET /api/v1/github/setup`                                       | công khai (cookie)    | GitHub đưa trình duyệt về; redirect về web |
| `GET /api/v1/organizations/:orgId/integrations/:id/repositories` | `integrations.read`   | Repository của bản cài đặt                 |
| `GET /api/v1/organizations/:orgId/integrations/:id/deliveries`   | `integrations.read`   | 20 webhook gần nhất                        |
| `PATCH /api/v1/organizations/:orgId/repositories/:id`            | `integrations.manage` | `{ "projectId": … \| null }`: gắn / bỏ gắn |
| `POST /api/v1/webhooks/github`                                   | chữ ký HMAC           | Nhận webhook                               |

## Deployment

Mỗi deployment là một lần đưa một phiên bản lên một environment của project (`kind = deployment`), hoặc một lần chạy CI (`kind = workflow_run`, không có environment). Chúng đến từ hai nguồn:

- **GitHub** (`source = github`): `deployment` / `deployment_status` của GitHub Deployments (job Actions có `environment:` tạo ra chúng tự động) và `workflow_run` của Actions, trên repository đã gắn vào project.
- **Report API** (`source = api`): pipeline bất kỳ (GitLab CI, Jenkins, script…) báo bằng API token của project.

Quy tắc chung:

- **Idempotent**: một deployment là duy nhất theo `(project, source, kind, external_id)`; mỗi status của GitHub ghi một lần theo id của nó. Webhook đến lại, đến trễ, hay đối chiếu đọc lại đều không tạo bản trùng.
- **Không lùi trạng thái**: status mang thời điểm của nó (`status_at`); status cũ đến sau status mới chỉ được thêm vào lịch sử (`deployment_events`), không ghi đè trạng thái hiện tại.
- **Trạng thái**: `queued`, `in_progress`, `success`, `failure`, `error`, `cancelled`, `inactive` (GitHub: bản này đã bị bản sau thay). `started_at` / `finished_at` cho ra thời lượng.
- **Environment**: theo tên (không phân biệt hoa thường); tên chưa có trong project thì environment được tạo (ghi `environment.created` với người thực hiện `system`).
- **Phiên bản**: `version` báo lên, hoặc ref (tag / nhánh), hoặc 7 ký tự đầu của commit.

`GET /api/v1/organizations/:orgId/projects/:projectId/deployments` (`projects.read`), lọc `environmentId`, `kind`, `status`, phân trang `cursor` như nhật ký. Web: nút **Deployment** trên trang project.

### Report API

Hướng dẫn cho người dùng, có ví dụ GitLab CI / Jenkins / GitHub Actions: [guides/report-api.md](guides/report-api.md).

Owner / admin tạo **API token** trên trang project (`api_tokens.manage`): token `ffp_…` hiện **một lần**; DB chỉ giữ SHA-256 của nó. Token chỉ báo được deploy cho project của nó, có thể đặt hạn (30 / 90 / 365 ngày) và thu hồi; `last_used_at` cập nhật tối đa mỗi phút một lần. Tạo / thu hồi được ghi vào nhật ký.

```bash
curl -X POST "$FORGEFLOW_URL/api/v1/deployments" \
  -H "Authorization: Bearer $FORGEFLOW_TOKEN" \
  -H "Idempotency-Key: $CI_JOB_ID" \
  -H "Content-Type: application/json" \
  -d '{"environment":"production","version":"v1.4.0","sha":"9fceb02","url":"https://ci.example.com/jobs/1"}'
# → 201 { "data": { "id": "…", "status": "in_progress", … } }

curl -X PATCH "$FORGEFLOW_URL/api/v1/deployments/<id>" \
  -H "Authorization: Bearer $FORGEFLOW_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"success","environmentUrl":"https://app.example.com"}'
```

- **`Idempotency-Key` bắt buộc** với `POST`: gửi lại cùng key và cùng body → `200` với deployment đã tạo; cùng key mà body khác → `422 IDEMPOTENCY_KEY_REUSED`. Dùng id của lần chạy CI để pipeline chạy lại bước báo không tạo deploy thứ hai.
- `url` / `environmentUrl` chỉ nhận `http(s)`. Pipeline không báo được `inactive`.
- Sẵn dùng: `tools/report-deployment.sh` (chỉ cần `sh` và `curl`; lệnh `start` in ra id, `finish <id>`; key lấy từ `GITHUB_RUN_ID` / `CI_JOB_ID` / `BUILD_TAG`), và composite action `.github/actions/report-deployment` cho workflow GitHub không dùng GitHub Deployments.

| Endpoint                                           | Quyền cần           | Việc làm                                    |
| -------------------------------------------------- | ------------------- | ------------------------------------------- |
| `GET …/projects/:projectId/api-tokens`             | `api_tokens.manage` | Token của project (không có secret)         |
| `POST …/projects/:projectId/api-tokens`            | `api_tokens.manage` | `{ name, expiresInDays? }` → secret một lần |
| `DELETE …/projects/:projectId/api-tokens/:tokenId` | `api_tokens.manage` | Thu hồi                                     |
| `POST /api/v1/deployments`                         | API token           | Báo một deployment bắt đầu                  |
| `PATCH /api/v1/deployments/:deploymentId`          | API token           | Status sau đó (chỉ deployment của project)  |

## Nhật ký hoạt động (audit log)

Mỗi thao tác nhạy cảm trong một org được ghi vào bảng `audit_logs` **trong cùng transaction** với chính thao tác đó: không thể có thay đổi mà thiếu nhật ký, hay nhật ký mà thay đổi không xảy ra. Ghi nhật ký lỗi thì thao tác bị huỷ theo (`500`).

| Hành động                                                                         | Khi nào                                                                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `organization.created`, `organization.renamed`                                    | Tạo org; đổi tên (chỉ khi tên thật sự đổi)                                                   |
| `member.role_changed`, `member.removed`, `member.left`                            | Đổi vai trò (khi khác vai trò cũ); xoá người khác; rời                                       |
| `invitation.created`, `invitation.revoked`, `invitation.accepted`                 | Mời; thu hồi (kể cả khi gửi email lỗi); nhận lời mời                                         |
| `project.created`, `project.renamed`                                              | Tạo, đổi tên project                                                                         |
| `integration.created`, `integration.secret_rotated`, `integration.secret_revoked` | Kết nối integration; đổi, thu hồi secret                                                     |
| `environment.created`, `environment.renamed`, `environment.(un)protected`         | Thêm, đổi tên, bật / tắt bảo vệ environment (kể cả `system` tạo environment theo deployment) |
| `integration.enabled`, `integration.disabled`                                     | GitHub App được mở lại; bị gỡ / tạm ngưng trên GitHub (`system`)                             |
| `repository.mapped`                                                               | Gắn / bỏ gắn repository với project                                                          |
| `api_token.created`, `api_token.revoked`                                          | Tạo, thu hồi API token của project                                                           |
| `outbox_event.retried`                                                            | Chạy lại một việc nền đã dừng thử                                                            |

- Mỗi entry có: người thực hiện (`actor_user_id`, hoặc `system` cho việc worker làm), đối tượng (`target_type` + `target_id`), chi tiết đủ để đọc lại sau (`metadata`: tên, email, vai trò trước / sau — **không bao giờ có secret**), IP client và `X-Request-Id` của request (để tìm log).
- **Chỉ thêm, không sửa / xoá**: role `forgeflow_app` có `INSERT` và `SELECT` trên `audit_logs`, không có `UPDATE` / `DELETE` (migration 0012), cộng RLS theo org như mọi bảng tenant.
- Ghi từ code: `AuditService.record(tx, entry)` với `tx` là transaction của thao tác; người thực hiện lấy bằng `@CurrentActor()` trong controller.
- `GET /api/v1/organizations/:orgId/audit-logs?limit=50&cursor=…` (quyền `audit.read`: owner, admin): mới nhất trước, phân trang bằng `nextCursor` (theo vị trí `created_at, id`, nên thêm entry mới không làm lệch trang). Web: trang **Nhật ký** (`/orgs/[orgId]/audit`).

## Cơ sở dữ liệu và cách ly tenant (RLS)

Dữ liệu tenant được cách ly hai lớp: tầng app kiểm tra membership (`OrgPermissionGuard`), và PostgreSQL Row-Level Security chặn cả khi một truy vấn quên lọc `organization_id` (thiết kế: ADR-0002 trong `docs/`, chỉ có ở local).

| Role                | Biến môi trường          | Dùng bởi               | Quyền                                                             |
| ------------------- | ------------------------ | ---------------------- | ----------------------------------------------------------------- |
| `forgeflow_app`     | `DATABASE_URL`           | api                    | chỉ `SELECT/INSERT/UPDATE/DELETE`; không owner, không `BYPASSRLS` |
| `forgeflow` (owner) | `MIGRATION_DATABASE_URL` | migrate / reset / seed | sở hữu bảng, bỏ qua RLS                                           |

- api **từ chối khởi động** nếu `DATABASE_URL` là superuser hoặc role có `BYPASSRLS`.
- Migration cấp quyền cho `forgeflow_app` nhưng không đặt mật khẩu. Ở local, role đăng nhập được tạo bởi `infra/compose/postgres/init/01-app-role.sql` (Postgres chạy khi tạo volume; volume cũ: `npm run db:app-role`); CI chạy cùng file đó; trên server (`infra/staging`), mỗi lần deploy chạy lại file này với mật khẩu lấy từ `APP_DB_PASSWORD` (biến `FORGEFLOW_APP_DB_PASSWORD` của psql; không đặt thì mặc định là `forgeflow_app`).
- **Truy vấn bảng tenant phải chạy trong `database.withTenant({ organizationId, userId }, (tx) => …)`**: mở transaction và đặt `app.organization_id` / `app.user_id` (chỉ trong transaction). Không có context thì policy không khớp dòng nào.
- Policy hiện có: `organizations`, `memberships`, `invitations`, `projects`, `environments`, `integrations`, `integration_secrets`, `repositories`, `deployments`, `deployment_events`, `api_tokens`, `idempotency_keys`, `outbox_events` đọc / ghi theo org trong context (`audit_logs`: chỉ đọc và thêm; `integration_secrets`: không xoá, chỉ sửa `revoked_at`; `webhook_deliveries`: tenant chỉ đọc; `api_tokens`, `outbox_events`: không xoá); user trong context đọc được membership của chính mình và các org mình thuộc về (để liệt kê org). `users` và các bảng identity không thuộc tenant nên không bật RLS.
- Luồng chưa biết org dùng hàm `SECURITY DEFINER` hẹp (`SET search_path = pg_catalog`, chỉ `forgeflow_app` được `EXECUTE`) chỉ làm đúng một việc, rồi chạy phần còn lại trong `withTenant`: xem / nhận lời mời theo token (`forgeflow_invitation_organization`), ghi webhook (`forgeflow_record_webhook_delivery`: tìm org theo installation), xác thực API token (`forgeflow_api_token_context`), worker (`forgeflow_claim_outbox_events`…, `forgeflow_enqueue_github_reconcile`). Test RLS liệt kê đủ các hàm này: thêm hàm mới mà không thêm vào test thì test đỏ.
- **Thêm bảng tenant mới**: cột `organization_id NOT NULL`; trong một migration viết tay (`cd packages/database && npx drizzle-kit generate --custom --name <tên>`): `ENABLE` + `FORCE ROW LEVEL SECURITY` và policy theo `forgeflow_current_organization_id()`; composite FK `(organization_id, …)` tới bảng cha (bảng cha có `UNIQUE (organization_id, id)`; ví dụ `environments` → `projects`). Test catalog sẽ đỏ nếu quên bật RLS.

## Docker image

```bash
docker build -f infra/docker/api.Dockerfile -t forgeflow-api .
docker build -f infra/docker/web.Dockerfile -t forgeflow-web .

# Migration chạy như một bước riêng, bằng role owner, trước khi bản mới nhận traffic
docker run --rm -e MIGRATION_DATABASE_URL=postgres://... forgeflow-api node packages/database/dist/scripts/migrate.js

# Worker: cùng image với api, khác lệnh
docker run --rm --env-file .env forgeflow-api node --enable-source-maps apps/api/dist/worker.js
```

CI build cả hai image cho mọi pull request; trên `main` thì đẩy thêm lên `ghcr.io/<owner>/forgeflow-{api,web}:<commit sha>`.

## Ghi chú kỹ thuật

- **ESM toàn repo** (`"type": "module"`): NestJS 12 chỉ hỗ trợ ESM. Import tương đối phải có đuôi `.js`.
- **TypeScript ghim ở 6.0.x**: `typescript-eslint` hiện chỉ hỗ trợ TypeScript < 6.1, nên chưa lên TypeScript 7.
- **Test dùng Jest ở chế độ ESM**: `npm test` chạy Node với `--experimental-vm-modules`. TypeScript được dịch bằng `@swc/jest` vì NestJS cần decorator metadata. Cấu hình ở `jest.config.js`; code test được type-check qua `tsconfig.test.json`.
- **Package dùng chung được build ra `dist/`** bằng TypeScript project references; `npm run dev` giữ `tsc -b -w` chạy nên sửa package là api tự restart.
- **`.env` không bao giờ được commit.** Production nhận cấu hình từ môi trường deploy.

## Deploy

Staging chạy trên một VPS bằng Docker Compose, với Caddy (HTTPS tự động) đứng trước web và api. Mỗi lần push lên `main` mà CI xanh thì job **Staging** tự deploy commit đó qua SSH. Server chạy api, worker và web. Muốn rollback thì chạy workflow **Deploy to staging** với SHA cũ. Cách cài server, cấu hình GitHub, backup và vận hành: [infra/staging/README.md](infra/staging/README.md).

Chưa có bản production. Error tracking sẽ dùng Sentry.
