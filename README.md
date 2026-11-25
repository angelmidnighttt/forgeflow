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
| `npm run typecheck`               | Kiểm tra kiểu toàn repo                                   |
| `npm run lint`                    | ESLint                                                    |
| `npm run format` / `format:check` | Prettier                                                  |
| `npm test`                        | Build rồi chạy Vitest                                     |
| `npm run db:up` / `db:down`       | Bật / tắt PostgreSQL local                                |
| `npm run db:generate`             | Sinh migration từ schema Drizzle (`drizzle-kit generate`) |
| `npm run db:migrate`              | Áp dụng migration (chạy lặp lại an toàn)                  |
| `npm run db:reset`                | Xoá sạch và migrate lại — chỉ chạy được với DB localhost  |
| `npm run db:seed`                 | Nạp dữ liệu mẫu                                           |

## Cấu trúc

```text
apps/
  api/          NestJS 12 — REST API, webhook ingress, health
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

## Quy ước API

- Mọi endpoint nằm dưới `/api/v1`.
- Response thành công: `{ "data": ... }`. Lỗi: `{ "error": { "code", "message", "requestId", "details?" } }`, với `code` lấy từ `ErrorCode` trong `@forgeflow/contracts`.
- Mỗi request có `X-Request-Id` (dùng lại giá trị client gửi nếu hợp lệ, nếu không thì tự sinh); id này có trong log và trong body lỗi.
- Body / query được validate bằng `ZodValidationPipe` với schema từ `@forgeflow/contracts`.

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
- **Test api dùng Vitest + SWC** (`unplugin-swc`) vì NestJS cần decorator metadata mà transformer mặc định của Vite không sinh ra.
- **Package dùng chung được build ra `dist/`** bằng TypeScript project references; `npm run dev` giữ `tsc -b -w` chạy nên sửa package là api tự restart.
- **`.env` không bao giờ được commit.** Production nhận cấu hình từ môi trường deploy.

## Deploy

Chưa có bản production. Error tracking sẽ dùng Sentry.
