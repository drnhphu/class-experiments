# Web app thí nghiệm hành vi trên lớp

Web app tĩnh (HTML, JavaScript, không công cụ dựng) chạy trên GitHub Pages, dùng Firebase gói Spark miễn phí (Firestore và đăng nhập ẩn danh). Đặc tả đầy đủ nằm trong tài liệu "Kế hoạch web app thí nghiệm trên lớp".

App: `https://drnhphu.github.io/class-experiments/`

## Cấu trúc

| Tệp | Vai trò |
|---|---|
| `join.html` | Trang học viên (điện thoại 360 px): vào phòng, đồng ý (nếu bật), phiên thu theo nhịp từng người, trò chơi bốn pha, kiểm tra nhanh, kết quả cá nhân |
| `control.html` | Trang giảng viên: tạo hoặc tiếp tục phiên, mở và khóa phiên thu, mở kết quả, điều khiển trò chơi, kiểm tra nhanh, xuất CSV, đóng phiên, xóa dữ liệu thô |
| `present.html` | Màn chiếu, cửa sổ thứ hai của laptop; không nối Firestore, nhận dữ liệu từ trang điều khiển qua BroadcastChannel |
| `engines/` | Bốn động cơ: A (lựa chọn trong chủ thể), B (chia điều kiện giữa các nhóm), C (đo và chấm cá nhân), D (trò chơi trực tiếp, ghép cặp và chia vai) |
| `experiments/` | Mỗi thí nghiệm một tệp JSON; `index.json` liệt kê các tệp được nạp |
| `quizzes/` | Bộ kiểm tra nhanh cuối buổi; liệt kê trong `experiments/index.json` |
| `lang/vi.json`, `lang/en.json` | Mọi chuỗi chữ giao diện |
| `js/` | Mô-đun dùng chung: Firebase, ngôn ngữ, danh mục và kiểm tra cấu trúc khóa, phiên và thứ tự phiên thu, mã phòng, `viz.js` (thống kê, gộp ô dưới 3 người, bảng ba cột, biểu đồ) |
| `firestore.rules` | Quy tắc bảo mật; bản trên Firebase console phải khớp tệp này |
| `tests/` | Động cơ thử T và TD, danh mục thử, `rules.html` (kiểm thử quy tắc), `load.html` (thử tải), `sim.html` (máy giả lập trả lời phiên thu), `games.html` (máy giả lập chơi trò chơi) |

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
- `renderStudent` nhận bước đặc biệt `__result` để hiện kết quả cá nhân hoặc kết quả của cặp; trả về `null` nếu không có. Động cơ A cũng dùng `scoreLocal` để điện thoại hiện điểm chuyển giá (E01) hoặc cặp lựa chọn (E02) theo kế hoạch.
- `ctx` của `renderStudent`: `lang`, `t`, `uid`, `exp`, `step`, `assignment`, `myAnswers`, `myTimes`, `startedAt` (lúc bước hiện lần đầu), `submit(answers, times)`; thêm `round`, `result` trong trò chơi và `score` khi mở kết quả.
- `renderPresenter` nhận thêm `ctx` (`lang`, `t`, `round`), vì giao diện song ngữ.
- `assign` của động cơ có `assign` khác `null` trả về đối tượng có `byUid: { uid: nhãn }` để CSV và kho so sánh ghi được điều kiện của từng người.

## Thí nghiệm đã có (Giai đoạn 2, 3 và 5)

| Mã | Động cơ, thiết kế | Bước trong phiên thu | Khóa câu trả lời trong CSV |
|---|---|---|---|
| E01 | A, `pricelist` | `list` (12 dòng), `peter` | `row01` đến `row12` = `sure` hoặc `gamble`; `peter` = giá sẵn lòng trả |
| E02 | A, `pair`, quy tắc `allais` | `p1`, `p2` đặt cách nhau | `p1`, `p2` = chỉ số phương án (0 hoặc 1) |
| E03 | A, `pair`, quy tắc `ellsberg` | `p1` (cược màu thứ nhất), `p2` (cược màu thứ hai), hai màn liền nhau | `p1`, `p2` = 0 (hộp biết tỷ lệ) hoặc 1 (hộp chưa biết) |
| E04 | A, `pair`, quy tắc `presentbias` | `p1` (hôm nay hay sau một tuần), `p2` (cùng cặp lùi xa ít nhất 26 tuần) | `p1`, `p2` = 0 (nhận sớm) hoặc 1 (chờ thêm) |
| E05 | B, `anchor`, điều kiện `low` hoặc `high` | `cmp` (câu so sánh với mốc), `est` | `cmp` = `more` hoặc `less`; `est` = ước lượng; cột `assignment` = mốc đã nhận |
| E06 | B, `framing`, điều kiện `gain` hoặc `loss` | `choice` | `choice` = 0 (phương án A, không rủi ro) hoặc 1; cột `assignment` = phiên bản đã đọc |
| E07 | B, `decoy`, điều kiện `base` (hai phương án) hoặc `decoy` (thêm mồi) | `choice` | `choice` = `target`, `competitor` hoặc `decoy`; cột `assignment` = phiên bản đã thấy |
| E08 | B, `default`, điều kiện `optin` (ô để trống) hoặc `optout` (ô đánh dấu sẵn) | `join` | `join` = 1 (tham gia) hoặc 0; cột `assignment` = phiên bản đã thấy |
| E09 | C, `calibration` | `a` (câu 1 đến 5), `b` (câu 6 đến 10) | `q01_lo`, `q01_hi`, ... |
| E10 | C, `lossaversion` | `gain` | `gain` = mức thắng tối thiểu; λ = `gain` / khoản thua |
| E11 | C, `bayes` | `r1` (dạng phần trăm), `r2` (dạng tần suất) | `r1`, `r2` = chỉ số phương án |
| E12 | C, `crt` | `q1`, `q2`, `q3`, mỗi câu có đồng hồ | `q1`... = số trả lời; ô trống = hết giờ |
| S12 | C, `stroop` (bài Stroop đi kèm E12, tệp riêng, đứng sau E12) | `trials` | `trials` = mọi lượt dạng `khớp,mực,chữ,bấm,ms` nối bằng `;` (ms trống nếu rời màn hình); `rtC`, `rtI` = trung vị ms lượt khớp và lệch; `errC`, `errI` = số lần bấm sai |

Thứ tự mặc định trong phiên thu nằm ở `defaultOrder` của `experiments/index.json` (theo kế hoạch: E05, E01, E06, E02 bài 1, E09, E10, E07, E11, E03, E02 bài 2, E04, E08, E12), lọc theo các thí nghiệm được chọn. Thí nghiệm có `separate` (như E02) được chia thành từng phần riêng trong thứ tự; trang điều khiển chặn tạo phòng nếu hai phần không cách nhau đủ `minGap` thí nghiệm khác. Kho so sánh chỉ cộng dồn các lớp có cùng thứ tự đến từng bước.

Chia điều kiện (động cơ B): khi mở phiên thu, trang điều khiển chia những người đã vào phòng xen kẽ theo một thứ tự ngẫu nhiên (`js/assign.js`), nên hai nhóm chênh nhau tối đa một người; mỗi thí nghiệm chia riêng. Người vào sau được xếp vào nhóm đang ít người hơn. Mở lại phiên thu không chia lại. Điện thoại chờ đến khi có điều kiện của mình mới hiện câu hỏi. Điều kiện ghi trong `assignments/{thí nghiệm}` và cột `assignment` của CSV.

Rời màn hình (tệp có `"noLookup": true`, hiện là E09, E11, E12): điện thoại báo trước là không tra cứu, ghi số lần và tổng thời gian rời màn hình ở từng bước (kể cả khi đóng tab hoặc tải lại) vào `times` dưới khóa `away:<bước>` và `leaves:<bước>`. CSV có thêm cột `leaves`, `away_ms`, `flag`; `flag` = `roi_man_hinh_tren_5_giay` khi tổng thời gian rời của thí nghiệm đó quá 5 giây. Trang điều khiển tô vàng số người như vậy theo từng thí nghiệm. Đồng hồ của câu có giới hạn thời gian tính theo giờ thật từ lúc câu hiện lần đầu, nên rời trang hay tải lại không làm đồng hồ chạy lại.

Mở kết quả một thí nghiệm thì máy chủ không nhận thêm câu trả lời cho thí nghiệm đó (`revealed` trong tài liệu phiên).

Trên màn chiếu, mọi số liệu hiện dạng tỷ lệ; biểu đồ phân bố gộp nhóm kề nhau đến khi mỗi cột có ít nhất 3 người.

Giai đoạn 5 (thí nghiệm P2) chỉ thêm thiết kế mới vào động cơ, không đổi giao diện chung và không đổi các thiết kế đã qua cửa (quyết định của Kane ngày 18/11/2026). Quy tắc kiểm tra của các thiết kế mới:
- `ellsberg`: hai hộp cùng số phiếu, số chẵn; hộp biết tỷ lệ chia đúng 50/50 và chữ mô tả nêu rõ số phiếu từng màu; hai câu cược hai màu khác nhau, cùng giải; hộp biết tỷ lệ là phương án thứ nhất ở cả hai câu.
- `presentbias`: mỗi câu là khoản nhỏ nhận sớm so với khoản lớn nhận muộn; hai câu cùng hai số tiền và cùng khoảng chờ; câu một bắt đầu hôm nay, câu hai lùi xa ít nhất 26 tuần.
- `decoy`: đúng hai thuộc tính bằng số, mỗi thuộc tính ghi rõ cao hơn hay thấp hơn là tốt; phương án mục tiêu và đối thủ đánh đổi nhau; mồi bị mục tiêu trội ở cả hai thuộc tính và không bị đối thủ trội; không dùng hình ảnh.
- `default`: hai phiên bản dùng chung một đoạn mô tả và một nhãn ô, chỉ khác ô đánh dấu sẵn hay để trống; đổi lựa chọn tốn đúng một chạm ở cả hai.
- `stroop` (S12, Kane chọn đặt thành tệp riêng ngày 19/11/2026 để không đổi E12): 3 đến 6 màu, mỗi màu có mã mực và chữ khác nhau; số lượt chữ khớp màu bằng số lượt chữ lệch màu, tổng 16 đến 60; không có hai lượt liền nhau cùng màu mực; chỉ tính lượt bấm đúng trong khoảng `rtMin` đến `rtMax` ms và không rời màn hình.

Mọi chữ học viên đọc nằm trong tệp cấu hình; sửa chữ hoặc số thì tăng `version`. Bộ 10 câu của E09 có nguồn kiểm chứng trong từng câu (`source`).

## Trò chơi (Giai đoạn 4, động cơ D)

| Mã | Thiết kế | Khóa câu trả lời trong CSV |
|---|---|---|
| E13 | `beauty`: chọn số 0 đến 100, gần 2/3 trung bình nhất thì thắng; cả lớp cùng chơi, không ghép cặp | `r1` = số đã chọn |
| E14 | `pd`: song tù theo cặp, 1 vòng hoặc lặp đến 5 vòng với cùng người cùng cặp | `r<k>` = `C` (giữ giá) hoặc `D` (giảm giá); cột `assignment` = ghế, ví dụ `c03.A` |
| E15 | `ultimatum`: Người chia đề nghị, Người nhận nêu mức thấp nhất chấp nhận cùng lúc; sau đó Người chia chơi bản độc tài cùng tổng | Người chia: `r1` = đề nghị, `r1d` = phần cho ở bản độc tài; Người nhận: `r1` = mức thấp nhất; cột `assignment` = ghế, ví dụ `c02.proposer` |

- Ghép cặp: trang điều khiển ghép khi mở lượt chọn đầu tiên và giữ nguyên ghế qua các vòng, kể cả khi lùi pha hoặc kết thúc rồi chọn lại trò chơi đó. Người vào sau nhận ghế ở vòng kế: trước hết là ghế trống cạnh người đang chơi với máy, sau đó ghép với nhau. Người lẻ chơi với máy.
- Máy: mọi lựa chọn đều đồng thời nên không ai phải chờ bạn chơi. Khi khóa lượt, máy chọn thay cho ghế không có lựa chọn (người lẻ, hoặc người cùng cặp không chọn kịp) theo quy tắc cố định trong tệp cấu hình (`bot`): E14 ăn miếng trả miếng, E15 đề nghị và mức chấp nhận cố định. Lựa chọn của máy không tính vào kết quả của lớp; luật chơi trên điện thoại và màn chiếu báo trước điều này (`botNote`).
- Điện thoại nhận ghế và kết quả của cặp qua trình nghe (listener) tài liệu `assignments` và `results`, nên khi mạng chập chờn hay bản lưu ngoại tuyến đã cũ, màn hình tự cập nhật khi bản trên máy chủ tới.
- Quy tắc bảo mật: trong trò chơi, một lần ghi chỉ được thêm khóa của vòng hiện tại (`r<k>`, `r<k>d`), và lựa chọn đã ghi không đổi được.
- `tests/games.html?room=MÃ`: N máy giả lập vào một phòng thật và chơi các trò chơi mà trang điều khiển đang chạy, qua chính màn hình điện thoại của động cơ; tùy chọn cho một số máy không chọn ở một vòng (`3@E14r1`) và thêm người vào muộn.

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
- `tests/load.html`: thử tải (điều kiện qua cửa Giai đoạn 1). Mở trên trình duyệt đã đăng nhập giảng viên; trang tạo N máy giả lập ẩn danh (mặc định 60, dùng lại cùng tài khoản ở các lần sau), đổi trạng thái 9 lần, đo thời gian tới từng máy, đếm lại mọi câu trả lời, rồi xóa phòng thử.
- `tests/sim.html?room=MÃ`: nút "Chỉ vào phòng" cho máy giả lập vào trước khi mở phiên thu (để thử chia điều kiện lúc mở), nút còn lại cho N máy giả lập (mặc định 12, dùng lại tài khoản của `load.html`) vào một phòng đang mở phiên thu và trả lời qua chính màn hình điện thoại của động cơ, với câu trả lời sinh từ hạt giống cố định. Dùng để đối chiếu màn chiếu với CSV.
- `tests/rules.html`: mở trên trình duyệt đã đăng nhập giảng viên, bấm Chạy kiểm thử. Trang tự tạo một phòng thử, đi qua mọi trạng thái, chạy các phép thử quy tắc bằng ba người dùng ẩn danh, rồi xóa phòng thử.

## Giới hạn gói miễn phí cần nhớ

- Firestore Spark: 50.000 lượt đọc và 20.000 lượt ghi mỗi ngày. Mỗi lần ghi câu trả lời tốn thêm 2 lượt đọc do quy tắc kiểm tra trạng thái phòng và bản ghi người tham gia.
- Firebase Authentication: tối đa 100 tài khoản mới mỗi giờ từ cùng một địa chỉ IP. Cả lớp dùng chung Wi-Fi trường thường ra cùng một IP.
