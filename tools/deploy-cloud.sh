#!/usr/bin/env bash
# 小满AI客服工作台 —— 一键部署/更新到腾讯云香港服务器
# 用法（Git Bash / Linux / macOS）：
#   bash tools/deploy-cloud.sh
# 默认会交互式询问服务器密码；想免密可先做 SSH 密钥登录：
#   ssh-copy-id root@43.128.31.244
set -e

HOST="${DEPLOY_HOST:-43.128.31.244}"
USER="${DEPLOY_USER:-root}"
DIR="${DEPLOY_DIR:-/opt/xiaoman-workbench}"
SERVICE="${DEPLOY_SERVICE:-xiaoman.service}"

cd "$(dirname "$0")/.."
echo "==> 上传代码到 ${USER}@${HOST}:${DIR}"
tar czf - --exclude=node_modules --exclude=.git --exclude=data --exclude='*.log' . \
  | ssh -o StrictHostKeyChecking=no "$USER@$HOST" \
    "tar xzf - -C $DIR \
     && cd $DIR \
     && npm install --omit=dev --registry=https://registry.npmmirror.com \
     && sudo systemctl restart $SERVICE \
     && sleep 4 \
     && curl -s -o /dev/null -w '服务状态: %{http_code}\n' http://127.0.0.1:8787/login \
     && systemctl is-active $SERVICE"

echo "==> 完成：https://kefu.zhimengxuan.com"
