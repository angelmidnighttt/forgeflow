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
2. Bật PostgreSQL (pgvector) bằng Docker Compose và chờ healthy.
3. Build các package TypeScript, áp dụng migration.
4. Chạy song song: TypeScript watch, api (tự restart khi code đổi), web.

| Địa chỉ                             | Nội dung                                  |
| ----------------------------------- | ----------------------------------------- |
| http://localhost:3000               | Web dashboard (trang trạng thái hệ thống) |
| http://localhost:4000/api/v1/health | Liveness của api                          |
| http://localhost:4000/api/v1/ready  | Readiness (kiểm tra DB)                   |

Nếu cổng 5432 đã bị chiếm, đặt `FORGEFLOW_DB_PORT=5434` (hoặc cổng khác) trước khi chạy và sửa `DATABASE_URL` trong `.env` cho khớp.

## Script

| Lệnh                              | Việc làm                                                  |
| --------------------------------- | --------------------------------------------------------- |
| `npm run dev`                     | Chạy toàn bộ môi trường local                             |
| `npm run build`                   | Build packages, api và web                                |
| `npm run typecheck`               | Kiểm tra kiểu toàn repo, gồm cả code test                 |
| `npm run lint`                    | ESLint                                                    |
| `npm run format` / `format:check` | Prettier                                                  |
| `npm test`                        | Build rồi chạy Jest (unit + integration, cần PostgreSQL)  |
| `npm run test:unit`               | Chỉ chạy unit test, không cần PostgreSQL                  |
| `npm run db:up` / `db:down`       | Bật / tắt PostgreSQL local                                |
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
    constants/          Hằng số: injection token, metadata key, API prefix, chính sách token, cookie
    decorators/         @Public(), @CurrentAuth()
    filters/            HttpExceptionFilter (bọc lỗi thành { error })
    guards/             JwtAuthGuard, OriginGuard (CSRF)
    interceptors/       EnvelopeInterceptor (bọc kết quả thành { data })
    pipes/              ZodValidationPipe
    types/              Kiểu dữ liệu dùng chung (AuthContext, ClientInfo, kết quả xoay token…)
    utils/              Hàm thuần: request id, clock, client info, băm / xoay refresh token
  modules/
    auth/               AuthController, AuthService, AccessTokenService,
                        RefreshTokenService, RefreshCookieService
    users/              UsersService
    health/             HealthController (/health, /ready)
```

- **Controller** nhận request, gọi service, trả kết quả (interceptor bọc thành `{ data }`).
- **Service** chứa logic và truy vấn DB bằng Drizzle (`@forgeflow/database`).
- **Module** khai báo controller / service và export những gì module khác cần.
- Tên file theo hậu tố: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.guard.ts`, `*.decorator.ts`, `*.filter.ts`, `*.interceptor.ts`, `*.pipe.ts`, `*.types.ts`, `*.constants.ts`, `*.util.ts`.
- Schema DB nằm ở `packages/database`, DTO dùng chung với web ở `packages/contracts`.

## Test

Test nằm trong `apps/api/test/`, cùng cấu trúc với `src/` (`test/modules/auth/…` ứng với `src/modules/auth/…`). Package dùng chung giữ test trong `packages/<tên>/test/`.

- `*.test.ts`: unit test, không cần dịch vụ ngoài.
- `*.int.test.ts`: integration test, chạy với PostgreSQL thật. Trước mỗi lần chạy, Jest tạo lại một database riêng tên `<tên DB>_test` (hoặc `TEST_DATABASE_URL`) và áp dụng migration; database dev không bị đụng tới.

## Quy ước API

- Mọi endpoint nằm dưới `/api/v1`.
- Response thành công: `{ "data": ... }`. Lỗi: `{ "error": { "code", "message", "requestId", "details?" } }`, với `code` lấy từ `ErrorCode` trong `@forgeflow/contracts`.
- Mỗi request có `X-Request-Id` (dùng lại giá trị client gửi nếu hợp lệ, nếu không thì tự sinh); id này có trong log và trong body lỗi.
- Body / query được validate bằng `ZodValidationPipe` với schema từ `@forgeflow/contracts`.

## Xác thực (JWT)

- **Mặc định mọi route đều cần access token.** Route công khai phải gắn `@Public()` (ví dụ `/health`, `/ready`, `/auth/refresh`).
- **Access token**: JWT ký HS256 bằng `JWT_SECRET`, sống 15 phút, chỉ chứa user id (`sub`), `jti`, issuer `forgeflow`, audience `forgeflow-api`. Gửi qua header `Authorization: Bearer <token>`; server không tra DB khi kiểm tra. Hết hạn thì API trả `401` với mã `TOKEN_EXPIRED`.
- **Refresh token**: chuỗi ngẫu nhiên 32 byte trong cookie `ff_refresh` (`HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`). Khi `COOKIE_SECURE` bật (mặc định ở production), cookie có thêm `Secure` và tên `__Secure-ff_refresh`. DB (bảng `refresh_tokens`) chỉ lưu hash SHA-256.
- **Xoay vòng**: mỗi lần `POST /api/v1/auth/refresh`, refresh token cũ bị thay bằng token mới cùng "family".
  - Token đã bị thay mà dùng lại sau 30 giây → coi như bị đánh cắp, cả family bị thu hồi, người dùng phải đăng nhập lại.
  - Dùng lại trong vòng 30 giây (hai tab refresh cùng lúc) → `409 CONFLICT`, sign-in vẫn còn; client thử lại.
- Refresh token hết hạn sau 7 ngày không dùng; một lần đăng nhập kéo dài tối đa 30 ngày.
- `POST /api/v1/auth/logout` thu hồi cả family và xoá cookie. Access token đã phát vẫn dùng được tới khi hết hạn (tối đa 15 phút) — đó là đánh đổi của token không trạng thái.
- `GET /api/v1/auth/me` trả về người dùng của access token.
- **CSRF**: access token không nằm trong cookie nên request API thường không thể bị giả mạo. Thêm vào đó, mọi request `POST`/`PUT`/`PATCH`/`DELETE` bị từ chối (`403 ORIGIN_NOT_ALLOWED`) nếu trình duyệt đánh dấu `Sec-Fetch-Site: cross-site` hoặc `Origin` khác `APP_ORIGIN`.
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
