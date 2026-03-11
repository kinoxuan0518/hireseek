# Commit

> 自动提交代码更改到 git 仓库

## 参数

- 提交信息（可选）：如"feat: add new feature"
- 文件列表（可选）：要提交的文件，不填则提交所有更改

## 执行流程

1. 检查 git 状态
2. 如果有未提交的更改：
   - 自动生成提交信息（如果未提供）
   - 提交更改
3. 返回提交 SHA 和分支信息

## 示例

```
用户: /commit
AI: 检查 git 状态...
    发现 3 个已修改文件

    生成提交信息：feat: add auto memory and skill system

    提交成功！
    SHA: a1b2c3d4
    分支: main
```
