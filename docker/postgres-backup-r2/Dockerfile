FROM alpine:3.20
RUN apk add --no-cache aws-cli dcron tzdata
COPY entrypoint.sh /entrypoint.sh
# Windows checkout może dać CRLF — bez tego: exec /entrypoint.sh: no such file or directory
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
