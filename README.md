# Web app thí nghiệm hành vi trên lớp

Web app tĩnh (HTML, JavaScript, không công cụ dựng) chạy trên GitHub Pages, dùng Firebase gói Spark miễn phí (Firestore và đăng nhập ẩn danh). Đặc tả đầy đủ nằm trong tài liệu "Kế hoạch web app thí nghiệm trên lớp".

App: `https://drnhphu.github.io/class-experiments/`

## Cấu trúc

| Tệp | Vai trò |
|---|---|
| `join.html` | Trang học viên (điện thoại 360 px): vào phòng, đồng ý (nếu bật), phiên thu theo nhịp từng người, trò chơi bốn pha, kiểm tra nhanh, kết quả cá nhân |
| `control.html` | Trang giảng viên: tạo hoặc tiếp tục phiên, mở và khóa phiên thu, mở kết quả, điều khiển trò chơi, kiểm tra nhanh, xuất CSV, đóng phiên, xóa dữ liệu thô |
| `present.html` | Màn chiếu, cửa sổ thứ hai của laptop; không nối Firestore, nhận dữ liệu từ trang điều khiển qua BroadcastChannel |
| `engines/` | Bốn động cơ A, B, C, D (Giai đoạn 2 đến 4) |
| `experiments/` | Mỗi thí nghiệm một tệp JSON; `index.json` liệt kê các tệp được nạp |
| `quizzes/` | Bộ kiểm tra nhanh cuối buổi; liệt kê trong `experiments/index.json` |
| `lang/vi.json`, `lang/en.json` | Mọi chuỗi chữ giao diện |
| `js/` | Mô-đun dùng chung: Firebase, ngôn ngữ, danh mục và kiểm tra cấu trúc khóa, phiên, mã phòng |
| `firestore.rules` | Quy tắc bảo mật; bản trên Firebase console phải khớp tệp này |
| `tests/` | Động cơ thử T và TD, danh mục thử, `rules.html` (kiểm thử quy tắc tự động) |

## Giao diện chung của động cơ

```js
export default {
  id: "B",                                   // A | B | C | D
  mode: "collect",                           // "collect": phiên thu theo nhịp; "live": trò chơi bốn pha
  validate(config) {},                       // trả về mảng lỗi cấu trúc khóa
  assign(participants, config) {},           // B: chia điều kiện; D: cặp hoặc vai; A và C: null
  renderStudent(step, config, ctx) {},       // trả về phần tử DOM cho một bước trên điện thoại
  scoreLocal(answers, config) {},            // C: kết quả cá nhân tính trên điện thoại
  aggregate(responses, config) {},           // chạy trên laptop giảng viên
  renderPresenter(result, config, history, ctx) {} // trả về phần tử DOM cho màn chiếu
};
```

Quy ước khung lõi thêm vào giao diện:
- `config.steps` (tùy chọn): danh sách bước của thí nghiệm trong phiên thu; không có thì một bước `main`. Thứ tự phiên thu lưu dạng `EXP#bước`.
- `renderStudent` nhận bước đặc biệt `__result` để hiện kết quả cá nhân hoặc kết quả của cặp; trả về `null` nếu không có.
- `ctx` của `renderStudent`: `lang`, `t`, `uid`, `exp`, `step`, `assignment`, `myAnswers`, `submit(answers, times)`; thêm `round`, `result` trong trò chơi và `score` khi mở kết quả.
- `renderPresenter` nhận thêm `ctx` (`lang`, `t`, `round`), vì giao diện song ngữ.
- `assign` của động cơ có `assign` khác `null` trả về đối tượng có `byUid: { uid: nhãn }` để CSV và kho so sánh ghi được điều kiện của từng người.

## Dữ liệu trên Firestore

| Đường dẫn | Ai ghi | Ai đọc |
|---|---|---|
| `sessions/{mã phòng}` | Giảng viên | Ai đăng nhập và biết mã |
| `sessions/{mã}/participants/{uid}` | Chính người đó, khi phòng nhận người mới | Giảng viên |
| `sessions/{mã}/responses/{uid}_{thí nghiệm}` | Chính người đó, đã vào phòng, khi phần tương ứng đang mở | Giảng viên |
| `sessions/{mã}/assignments/{thí nghiệm}` | Giảng viên | Người đã đăng nhập |
| `sessions/{mã}/results/{thí nghiệm}` | Giảng viên | Người đã đăng nhập |
| `archive/{ngày}_{mã}` | Giảng viên | Giảng viên |

Kiểm tra nhanh cuối buổi ghi vào `responses` với mã thí nghiệm cố định `Q00`. Câu phản tư tự do có trong CSV nhưng không vào kho so sánh.

## Thử khung lõi bằng danh mục thử

- `control.html?catalog=test` dùng danh mục `tests/experiments/` (T01, T02 thu theo nhịp; T03 trò chơi; T09 sai cố ý để thấy bước chặn) và bộ `quiz-test`.
- `tests/load.html`: thử tải (điều kiện qua cửa Giai đoạn 1). Mở trên trình duyệt đã đăng nhập giảng viên; trang tạo N máy giả lập ẩn danh (mặc định 60, dùng lại cùng tài khoản ở các lần sau), đổi trạng thái 10 lần, đo thời gian tới từng máy, đếm lại mọi câu trả lời, rồi xóa phòng thử.
- `tests/rules.html`: mở trên trình duyệt đã đăng nhập giảng viên, bấm Chạy kiểm thử. Trang tự tạo một phòng thử, đi qua mọi trạng thái, chạy các phép thử quy tắc bằng ba người dùng ẩn danh, rồi xóa phòng thử.

## Giới hạn gói miễn phí cần nhớ

- Firestore Spark: 50.000 lượt đọc và 20.000 lượt ghi mỗi ngày. Mỗi lần ghi câu trả lời tốn thêm 2 lượt đọc do quy tắc kiểm tra trạng thái phòng và bản ghi người tham gia.
- Firebase Authentication: tối đa 100 tài khoản mới mỗi giờ từ cùng một địa chỉ IP. Cả lớp dùng chung Wi-Fi trường thường ra cùng một IP.
