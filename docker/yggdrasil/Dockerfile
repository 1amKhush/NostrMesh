FROM alpine:3.20

RUN apk add --no-cache \
    curl \
    jq \
    iproute2

# Install yggdrasil from Alpine packages. The --no-scripts flag avoids
# post-install service hooks that are not needed in containers.
RUN apk add --no-cache --no-scripts yggdrasil || \
    apk add --no-cache --no-scripts \
      --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
      yggdrasil

RUN mkdir -p /etc/yggdrasil

COPY coordinator-entrypoint.sh /coordinator-entrypoint.sh
COPY storage-entrypoint.sh /storage-entrypoint.sh

RUN chmod +x /coordinator-entrypoint.sh /storage-entrypoint.sh
