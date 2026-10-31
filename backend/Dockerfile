# Go API image for Railway. Migrations are embedded; replay recordings ship next to the binary.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/api /app/api
COPY replay /app/replay
ENV HTTP_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/app/api"]
