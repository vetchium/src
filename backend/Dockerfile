FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:latest
WORKDIR /
COPY --from=build /out/server /server
EXPOSE 8080 8081
ENTRYPOINT ["/server"]
