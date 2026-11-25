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

1. Tạo `.env` từ `.env.example` nếu chưa có.
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
  api/          NestJS 12 — REST API, webhook ingress, health
    src/        Code
    test/       Test (Jest)
  web/          Next.js 16 — dashboard
packages/
  config/       Nạp .env và validate biến môi trường bằng zod
  contracts/    Schema zod + kiểu dùng chung giữa api và web (envelope, health)
  database/     Drizzle: schema, migration, script migrate/reset/seed
infra/
  compose/      Docker Compose cho môi trường local
  docker/       Dockerfile của api và web
scripts/        Script tiện ích cho môi trường dev
```

Mỗi app và package giữ code trong `src/` và test trong `test/`, import code cần test qua `../src/...`:

- `*.test.ts`: unit test, không cần dịch vụ ngoài.
- `*.int.test.ts`: integration test, chạy với PostgreSQL thật. Trước mỗi lần chạy, Jest tạo lại một database riêng tên `<tên DB>_test` (hoặc `TEST_DATABASE_URL`) và áp dụng migration; database dev không bị đụng tới.

## Quy ước API

- Mọi endpoint nằm dưới `/api/v1`.
- Response thành công: `{ "data": ... }`. Lỗi: `{ "error": { "code", "message", "requestId", "details?" } }`, với `code` lấy từ `ErrorCode` trong `@forgeflow/contracts`.
- Mỗi request có `X-Request-Id` (dùng lại giá trị client gửi nếu hợp lệ, nếu không thì tự sinh); id này có trong log và trong body lỗi.
- Body / query được validate bằng `ZodValidationPipe` với schema từ `@forgeflow/contracts`.

## Session và CSRF

- **Mặc định mọi route đều cần đăng nhập.** Route công khai phải gắn `@Public()` (ví dụ `/health`, `/ready`).
- Session lưu trong bảng `sessions`. Cookie chỉ chứa một token ngẫu nhiên; DB chỉ lưu hash SHA-256 của token.
- Session hết hạn sau 7 ngày không dùng (được gia hạn khi dùng) và tối đa 30 ngày kể từ lúc đăng nhập.
- Cookie session: `HttpOnly`, `SameSite=Lax`, `Path=/`. Khi `COOKIE_SECURE` bật (mặc định ở production), cookie có thêm `Secure` và tên có tiền tố `__Host-`.
- Request thay đổi dữ liệu (`POST`, `PUT`, `PATCH`, `DELETE`):
  - Bị từ chối nếu trình duyệt đánh dấu `Sec-Fetch-Site: cross-site` hoặc `Origin` khác `APP_ORIGIN`.
  - Khi đã đăng nhập, phải gửi header `X-CSRF-Token` bằng giá trị cookie `ff_csrf` (hoặc trường `csrfToken` của `GET /api/v1/auth/session`).
  - `@SkipCsrf()` chỉ dành cho route không bao giờ dùng cookie (webhook có chữ ký, gọi bằng API token).
- `GET /api/v1/auth/session` trả về người dùng hiện tại; `POST /api/v1/auth/logout` xoá session và cookie.

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
