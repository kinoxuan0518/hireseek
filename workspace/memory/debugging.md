# 调试经验记忆

记录常见错误和解决方案。

## 常见错误

_待自动学习记录_

## 解决方案

_待自动学习记录_

- AppleScript + BOSS直聘技巧：
1. 用 `execute tab_ javascript` 执行JS
2. 复杂JS存为独立 .js 文件，用 `do shell script "cat path/to/file.js"` 读取后注入
3. AppleScript 保留字不能用作变量名：log、tab、up、me、st、center
4. 推荐页 iframe 选择器：`document.querySelector('iframe')`
5. 推荐 tab 卡片：`.card-item`，最新 tab 卡片：`ul.recommend-card-list > li`
6. 打招呼按钮：`.btn-greet`
7. 筛选面板触发器：`.filter-label`，展开后 div.option 可点击选项
8. "应用上次"筛选：点击 div.recover（文本="应用"）
9. 附件简历按钮：`a` 标签文本="附件简历"
10. 发送消息：`document.querySelector('[contenteditable=true]')` 设置 innerHTML 后 dispatch input+keydown事件
11. 同页面切职位：点击包含职位文本的可见 DIV 打开下拉 → 点击 LI.job-item 或 LI 切换到目标职位
