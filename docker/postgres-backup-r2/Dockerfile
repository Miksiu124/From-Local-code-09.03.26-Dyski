FROM alpine:3.20
# dcron wywołuje setpgid() — na wielu hostach domyślny seccomp Dockera zwraca EPERM i kontener się restartuje w pętli.
# supercronic jest do cronów w kontenerach (bez tego problemu).
RUN apk add --no-cache aws-cli tzdata wget \
  && ARCH=$(uname -m) \
  && case "$ARCH" in \
       x86_64) SARCH=amd64 ;; \
       aarch64) SARCH=arm64 ;; \
       armv7l) SARCH=arm ;; \
       *) echo "unsupported arch: $ARCH"; exit 1 ;; \
     esac \
  && wget -qO /usr/local/bin/supercronic \
       "https://github.com/aptible/supercronic/releases/download/v0.2.33/supercronic-linux-${SARCH}" \
  && chmod +x /usr/local/bin/supercronic
COPY entrypoint.sh /entrypoint.sh
# Windows checkout może dać CRLF — bez tego: exec /entrypoint.sh: no such file or directory
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
