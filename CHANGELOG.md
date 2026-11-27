# Changelog

Mọi thay đổi đáng chú ý của ForgeFlow được ghi ở đây. Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/).

## [v0.1] — 2026-11-27

Tài khoản và multi-tenant: người dùng đăng ký, tạo organization, mời đồng đội, phân quyền và tạo project; dữ liệu giữa các organization được cách ly ở cả tầng app lẫn PostgreSQL.

### Thêm

- **Xác thực JWT**: access token 15 phút (Bearer); refresh token xoay vòng trong cookie `HttpOnly` + `SameSite=Strict` (production: `Secure`, tên `__Secure-`), chỉ lưu hash; dùng lại token cũ thì thu hồi cả chuỗi đăng nhập. Chống CSRF bằng kiểm tra `Origin`.
- Đăng ký và đăng nhập bằng email + mật khẩu (argon2id); xác minh email; quên / đặt lại / đổi mật khẩu. Link trong email dùng một lần, có hạn, token nằm sau `#` và DB chỉ lưu hash.
- Đăng nhập bằng GitHub (OAuth + PKCE), liên kết tài khoản theo email đã xác minh.
- Danh sách thiết bị đăng nhập: đăng xuất từng thiết bị hoặc mọi thiết bị khác.
- Rate limit cho các endpoint auth (bộ đếm trong PostgreSQL) và khoá tạm khi đăng nhập sai nhiều lần; `TRUST_PROXY` cho reverse proxy.
- Email giao dịch qua SMTP; Mailpit giữ mọi email ở môi trường local.
- **Organization** với 4 vai trò (owner, admin, member, viewer): mời qua email (7 ngày, dùng một lần, phải đăng nhập đúng email được mời), đổi vai trò, xoá thành viên, rời org; org luôn còn ít nhất một owner. Ma trận quyền dùng chung cho api và web (`@forgeflow/contracts`).
- **Cách ly tenant bằng PostgreSQL Row-Level Security**: api kết nối bằng role `forgeflow_app` (không owner, không `BYPASSRLS`, api từ chối khởi động nếu sai); mọi bảng tenant bật `ENABLE` + `FORCE`; luồng chưa biết org (link mời) đi qua một hàm `SECURITY DEFINER` hẹp. Thành viên org khác nhận `404` ở mọi route.
- **Project và environment**: project mới có sẵn `development`, `staging`, `production` (production được bảo vệ); thêm, đổi tên, bật / tắt bảo vệ environment. Tên không trùng (không phân biệt hoa thường); composite FK không cho environment trỏ sang project của org khác.
- **Nhật ký hoạt động**: mọi thao tác nhạy cảm trong org được ghi cùng transaction với chính thao tác đó (người làm, đối tượng, chi tiết, IP, request id); bảng chỉ thêm, api không sửa / xoá được. API đọc có phân trang và trang xem cho owner / admin.
- **Giao diện web tiếng Việt** (Tailwind CSS v4, shadcn/ui): đăng ký, đăng nhập, xác minh email, đặt lại mật khẩu, tài khoản và thiết bị, chuyển organization, thành viên và lời mời, cài đặt org, project và environment, nhật ký hoạt động. Nút chỉ hiện theo quyền; api vẫn kiểm tra mọi request.
- File REST Client trong `apps/api/http/` để thử API bằng tay.
- **Staging trên một VPS** (`infra/staging/`): Docker Compose với Caddy (HTTPS tự động); CI đẩy image lên GHCR và deploy qua SSH bằng một lệnh bị khoá (forced command), kiểm tra `/api/v1/health` báo đúng phiên bản; script chuẩn bị server (tường lửa, SSH chỉ bằng key, Docker), backup DB hằng ngày, rollback bằng workflow.

### Thay đổi

- Api tổ chức theo NestJS MVC: mỗi module chỉ có controller / service / module; guard, decorator, type, hằng số nằm trong `src/common/`.
- **Cấu hình DB**: `DATABASE_URL` giờ là role `forgeflow_app`; migrate / reset / seed dùng biến mới `MIGRATION_DATABASE_URL` (owner). Với `.env` local cũ: chép hai dòng này từ `.env.example`, rồi chạy `npm run db:app-role` (`npm run dev` tự chạy).
- CI chạy cả trên nhánh `dev` (chỉ lint, build, test); build image cho `main` và pull request, deploy staging chỉ từ `main`.
- Biến môi trường để trống (`KEY=`) được coi như chưa đặt.

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

[v0.1]: https://github.com/angelmidnighttt/forgeflow/compare/v0.0...v0.1
[v0.0]: https://github.com/angelmidnighttt/forgeflow/tree/v0.0
