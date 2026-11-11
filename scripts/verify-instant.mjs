import { pushInstant } from "./src/server/instant.ts";
import { migrate } from "./src/server/db.ts";

migrate();
// 用不存在的 id，验证推送链路但不污染真实数据
const n = await pushInstant("linuxdo-welfare", [
  {
    id: 999999,
    title: "【链路验证】免费领取体验金，先到先得",
    url: "https://example.com/verify",
    score: 88,
    codes: ["VERIFY-TEST-9001"],
    expiresAt: null,
  },
]);
console.log("instant pushed:", n);
