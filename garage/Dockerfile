# One-shot Garage bootstrap image: alpine (for a shell) + the static garage CLI.
# The garage runtime image has no shell, so we copy the binary into alpine and
# run init.sh against the node over RPC (network_mode: service:garage).
FROM dxflrs/garage:v1.0.1 AS garage
FROM alpine:3.19
COPY --from=garage /garage /usr/local/bin/garage
COPY init.sh /init.sh
RUN chmod +x /init.sh
ENTRYPOINT ["/bin/sh", "/init.sh"]
