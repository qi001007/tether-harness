# headless-deb

该目录存放 Linux headless Node Debian 包使用的说明、systemd 配置和维护脚本。构建脚本会读取仓库 `version.json`，将版本替换进 Debian postinst 模板并组装发行包。
