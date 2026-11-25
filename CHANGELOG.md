# Changelog

Mọi thay đổi đáng chú ý của ForgeFlow được ghi ở đây. Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).

## [v0.0] — 2026-11-25

Walking skeleton: nền móng chạy được ở local và trên CI. Chưa có tính năng nghiệp vụ.

### Thêm

- Monorepo npm workspaces: ESM, TypeScript 6 với project references.
- `apps/api` (NestJS 12): prefix `/api/v1`, response `{ data }` và lỗi `{ error: { code, message, requestId } }`, header `X-Request-Id`, log pino có che header nhạy cảm, `ZodValidationPipe`.
- `GET /api/v1/health` (liveness) và `GET /api/v1/ready` (kiểm tra DB, trả 503 khi DB không với tới).
- `apps/web` (Next.js 16): trang trạng thái hệ thống, tự làm mới mỗi 10 giây.
- `packages/config` (nạp `.env`, validate biến môi trường bằng zod), `packages/contracts` (schema dùng chung), `packages/database` (Drizzle, migration, script migrate / reset / seed).
- PostgreSQL có pgvector qua Docker Compose; `npm run dev` bật toàn bộ môi trường bằng một lệnh.
- ESLint, Prettier, Jest ở chế độ ESM (`@swc/jest`); test nằm trong thư mục `test/` của từng package.
- Dockerfile multi-stage cho api và web; CI trên GitHub Actions (lint, typecheck, test, migration, build image).

[v0.0]: https://github.com/angelmidnighttt/forgeflow/tree/v0.0
