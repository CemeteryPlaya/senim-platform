# Контекст сборки — корень репозитория: docker build -f services/identity/Dockerfile .
FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY pkg ./pkg
COPY gen ./gen
COPY services/identity ./services/identity
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/identity ./services/identity/cmd/identity

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/identity /identity
EXPOSE 8443 8081
ENTRYPOINT ["/identity"]
CMD ["serve"]
