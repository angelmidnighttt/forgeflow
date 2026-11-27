# Theo dõi deployment từ GitHub

ForgeFlow đọc deployment và lần chạy CI từ GitHub qua **GitHub App ForgeFlow**. App chỉ có quyền **đọc** (Deployments, Actions, Metadata): nó không push code, không chạy workflow và không đọc nội dung repository.

Cần: vai trò **owner** hoặc **admin** trong organization ForgeFlow, và quyền cài App lên tài khoản hoặc organization GitHub (owner của organization GitHub, hoặc admin của repository).

## 1. Kết nối GitHub

1. Mở **Tích hợp** trên thanh điều hướng, bấm **Kết nối GitHub**.
2. GitHub hỏi cài App lên tài khoản nào và cho repository nào. Chọn **Only select repositories** nếu chỉ muốn theo dõi một vài repository.
3. GitHub hỏi bạn cho phép App xác nhận tài khoản GitHub của bạn: ForgeFlow dùng bước này để chắc chắn bản cài đặt là của bạn. Nó không giữ token này.
4. Bạn quay về trang **Tích hợp**, với bản cài đặt vừa tạo và danh sách repository.

Mỗi bản cài đặt GitHub chỉ kết nối được với một organization ForgeFlow. Muốn thêm hay bớt repository thì vào **Cài đặt trên GitHub** (link trên thẻ bản cài đặt). ForgeFlow tự cập nhật danh sách.

## 2. Gắn repository vào project

Ở mỗi dòng repository, chọn project nhận deployment của nó. Repository chưa gắn thì ForgeFlow bỏ qua deployment của nó. Mỗi repository chỉ gắn vào một project; một project có thể nhận từ nhiều repository.

## 3. Những gì hiện trong ForgeFlow

Mở project rồi bấm **Deployment**.

- **Deploy** (cột "Nơi deploy" là một environment): mỗi GitHub Deployment của repository. Job GitHub Actions có `environment:` tự tạo deployment, không cần thêm gì:

  ```yaml
  jobs:
    deploy:
      runs-on: ubuntu-latest
      environment:
        name: production
        url: https://app.example.com
      steps:
        - run: ./deploy.sh
  ```

  Environment được so theo tên, không phân biệt hoa thường. Tên chưa có trong project (ví dụ `preview`) thì ForgeFlow tự thêm environment đó.

- **CI** (cột "Nơi deploy" ghi `CI · <tên workflow>`): mỗi lần chạy GitHub Actions của repository.

Trạng thái đi theo GitHub: Đang chờ, Đang chạy, Thành công, Thất bại, Lỗi, Đã huỷ, Đã thay thế (một deploy sau đã thay bản này). Thời lượng tính từ lúc bắt đầu chạy tới lúc kết thúc.

## Khi có gì đó không như mong đợi

| Hiện tượng                                                     | Nguyên nhân thường gặp                                                                                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Không có nút **Kết nối GitHub**                                | Server ForgeFlow chưa cấu hình GitHub App, hoặc vai trò của bạn không phải owner / admin.                                                                                          |
| "Phiên kết nối đã hết hạn…"                                    | Bạn mở link cài đặt ở trình duyệt khác, hoặc để quá 15 phút. Bấm **Kết nối GitHub** lại.                                                                                           |
| "Bản cài đặt GitHub này đã được kết nối với organization khác" | Mỗi bản cài đặt thuộc một organization ForgeFlow. Gỡ nó ở organization kia trước, hoặc cài App lên tài khoản GitHub khác.                                                          |
| Repository không có trong danh sách                            | Bản cài đặt chưa được cấp quyền cho repository đó: thêm ở **Cài đặt trên GitHub**.                                                                                                 |
| Deployment không hiện                                          | Repository chưa gắn vào project; hoặc job không có `environment:` (khi đó chỉ có dòng CI). Webhook GitHub đôi khi đến trễ hoặc mất: ForgeFlow tự đối chiếu với GitHub mỗi 10 phút. |
| Thẻ bản cài đặt ghi **Đã tắt**                                 | App đã bị gỡ hoặc tạm ngưng trên GitHub. Bấm **Kết nối GitHub** để cài lại; repository nào vẫn được chọn thì giữ nguyên project đã gắn.                                            |

Thẻ bản cài đặt có danh sách webhook gần đây; mục **Việc nền lỗi** ở cuối trang **Tích hợp** liệt kê các xử lý đã dừng thử lại, có nút **Chạy lại**.

## Ngắt kết nối

Gỡ App trên GitHub (Settings → Applications → Installed GitHub Apps → ForgeFlow → Uninstall). ForgeFlow chuyển bản cài đặt sang **Đã tắt** và ngừng nhận dữ liệu; lịch sử deployment vẫn còn.

Pipeline không dùng GitHub, hoặc deploy không qua GitHub Deployments: xem [Báo deploy từ pipeline](report-api.md).
