# ForgeFlow demo app

Một service HTTP nhỏ (Node 22, không có dependency) để thử ForgeFlow trên một repository thật: deploy của nó hiện trong ForgeFlow, và ở các phase sau, sự cố giả lập trên nó (lỗi 500, chậm) sẽ thành incident.

Thư mục này là **mẫu** cho repository riêng `forgeflow-demo-app`: GitHub chỉ chạy workflow ở `.github/workflows` của chính repository đó, nên trong repo ForgeFlow chúng không chạy.

| Endpoint      | Trả về                                                        |
| ------------- | ------------------------------------------------------------- |
| `GET /`       | `200` kèm phiên bản, hoặc `500` khi bật lỗi giả lập           |
| `GET /health` | `200 { status, version }`, dùng cho healthcheck của container |

| Biến               | Ý nghĩa                                                |
| ------------------ | ------------------------------------------------------ |
| `APP_VERSION`      | Phiên bản (image build sẵn đặt 7 ký tự đầu của commit) |
| `PORT`             | Mặc định `8080`                                        |
| `FAULT_ERROR_RATE` | `0`–`1`: tỉ lệ request tới `/` trả `500`               |
| `FAULT_LATENCY_MS` | Thêm độ trễ cho `/`                                    |

```bash
npm test
npm start                                  # http://localhost:8080
docker build -t demo-app . && docker run --rm -p 8080:8080 -e FAULT_ERROR_RATE=0.2 demo-app
```

## Tạo repository và nối với ForgeFlow

1. **Tạo repository**, đứng ở thư mục gốc của repo ForgeFlow:

   ```bash
   gh repo create forgeflow-demo-app --public
   cp -r examples/demo-app ../forgeflow-demo-app && cd ../forgeflow-demo-app
   git init -b main && git add . && git commit -m "Demo app"
   git remote add origin "https://github.com/$(gh api user -q .login)/forgeflow-demo-app.git"
   git push -u origin main
   ```

2. **Trong ForgeFlow**: tạo project `demo-app`; ở **Tích hợp**, kết nối GitHub và cho App quyền với `forgeflow-demo-app` (hoặc thêm repository vào bản cài đặt sẵn có), rồi gắn repository vào project `demo-app`.

3. **Push một commit lên `main`**. Workflow [Build and deploy](.github/workflows/deploy.yml) chạy test, build image lên GHCR, rồi deploy lên `staging` và `production`. Trang **Deployment** của project hiện:
   - một dòng **CI** cho lần chạy workflow;
   - hai deployment, `staging` rồi `production`, đi từ Đang chạy tới Thành công, cùng thời lượng.

4. **Báo deploy bằng API token** (pipeline không dùng GitHub Deployments): tạo API token trên trang project, rồi

   ```bash
   gh variable set FORGEFLOW_URL --body https://<địa chỉ ForgeFlow>
   gh secret set FORGEFLOW_TOKEN          # dán token khi được hỏi
   gh workflow run reported-deploy.yml -f environment=demo -f outcome=failure
   ```

   Deployment `demo` hiện với trạng thái Thất bại, nguồn là API.

Workflow [Reported deploy](.github/workflows/reported-deploy.yml) dùng action `report-deployment` của repo ForgeFlow ở nhánh `main`; nên ghim vào một commit SHA.
