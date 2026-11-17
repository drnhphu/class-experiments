# Web app thí nghiệm hành vi trên lớp

Web app tĩnh (HTML, JavaScript, không công cụ dựng) chạy trên GitHub Pages, dùng Firebase gói Spark miễn phí (Firestore và đăng nhập ẩn danh). Đặc tả đầy đủ nằm trong tài liệu "Kế hoạch web app thí nghiệm trên lớp".

## Trạng thái: Giai đoạn 0, chốt và dựng nền

| Tệp | Vai trò |
|---|---|
| `firestore.rules` | Quy tắc bảo mật cho 5 đường dẫn trong kế hoạch |
| `js/firebase-config.js` | Cấu hình web của dự án Firebase (điền sau khi tạo dự án) |
| `js/firebase.js` | Nạp Firebase 13.3.0 từ CDN chính thức; phiên bản chỉ ghim ở tệp này |
| `js/room.js` | Mã phòng 6 ký tự, bỏ các ký tự dễ nhầm I, O, 0, 1 |
| `join.html` | Trang học viên tối thiểu: đăng nhập ẩn danh, vào phòng, ghi câu thử T00 |
| `control.html` | Trang giảng viên tối thiểu: đăng nhập Google, tạo phòng thử, mở và khóa phiên thu, xem câu trả lời |
| `tests/gate.html` | Kiểm thử điều kiện qua cửa trên dự án thật, mô phỏng hai điện thoại |

`T00` là câu thử kết nối của Giai đoạn 0, không phải thí nghiệm.

## Dựng nền (làm một lần)

### 1. Dự án Firebase, gói Spark

1. Vào console.firebase.google.com, tạo dự án mới. Tắt Google Analytics. Không nâng gói, không gắn thẻ thanh toán.
2. Build > Authentication > Get started > Sign-in method: bật **Anonymous** và **Google**.
3. Authentication > Settings > Authorized domains: thêm `drnhphu.github.io`.
4. Build > Firestore Database > Create database: chọn **Production mode**, vị trí `asia-southeast1` (Singapore). Vị trí không đổi được sau khi tạo.
5. Firestore > Rules: dán toàn bộ `firestore.rules`, bấm Publish.
6. Project settings > General > Your apps > biểu tượng Web: đặt tên, không chọn Hosting, chép khối `firebaseConfig` vào `js/firebase-config.js`.

### 2. Kho GitHub và GitHub Pages

1. Tạo kho công khai `class-experiments`, để trống.
2. Đẩy mã lên nhánh `main`.
3. Settings > Pages > Deploy from a branch > `main` / `(root)`.
4. App chạy ở `https://drnhphu.github.io/class-experiments/`.

### 3. Cấp quyền giảng viên

1. Mở `control.html`, đăng nhập Google bằng tài khoản giảng viên.
2. Trang báo chưa có quyền và hiện UID. Thay `REPLACE_WITH_INSTRUCTOR_UID` trong `firestore.rules` bằng UID đó, Publish lại.
3. Tải lại trang: dòng "Đã xác nhận quyền giảng viên" xuất hiện.

## Kiểm tra điều kiện qua cửa Giai đoạn 0

Điều kiện: một điện thoại vào phòng và ghi được một câu trả lời; điện thoại thứ hai không đọc được câu trả lời đó.

1. Laptop: `control.html` > Tạo phòng thử > Mở phiên thu.
2. Điện thoại 1: mở link cho điện thoại, chọn một số. Thấy "Đã ghi câu trả lời". Trên laptop, bảng câu trả lời tăng lên 1.
3. Điện thoại 2: mở link trang kiểm thử cửa, bấm Chạy kiểm thử. Kết quả phải là **Điều kiện qua cửa: ĐẠT** và mọi phép thử phụ đúng kỳ vọng. Phép thử 4 (liệt kê mọi câu trả lời) bao gồm cả câu trả lời thật của điện thoại 1.
4. Laptop: Khóa phiên thu. Điện thoại 2: chạy lại; phép thử ghi phải chuyển sang Bị chặn.

Đừng thử trang học viên trên chính laptop đang đăng nhập Google: cùng trình duyệt sẽ dùng tài khoản giảng viên thay vì tài khoản ẩn danh.

## Giới hạn gói miễn phí cần nhớ

- Firestore Spark: 50.000 lượt đọc và 20.000 lượt ghi mỗi ngày. Mỗi lần ghi câu trả lời tốn thêm 1 lượt đọc do quy tắc bảo mật đọc trạng thái phòng.
- Firebase Authentication: tối đa 100 tài khoản mới mỗi giờ từ cùng một địa chỉ IP. Cả lớp dùng chung Wi-Fi trường thường ra cùng một IP. Có thể đặt lịch nâng tạm hạn mức này trong Firebase console trước buổi đông người.
