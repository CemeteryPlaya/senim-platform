package server

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// metricInterval is how often metrics are pushed to the collector.
const metricInterval = 15 * time.Second

// InitTelemetry installs global OpenTelemetry trace and metric providers that export over
// OTLP/gRPC to endpoint. endpoint is a URL, as the standard OTEL_EXPORTER_OTLP_ENDPOINT
// requires: "http://otel-lgtm:4317" (plain, inside the trusted compose network) or
// "https://..." (TLS). A bare "host:port" is an error — the OTel SDKs (Go and, later,
// web) would read it differently. An empty endpoint leaves the default no-op providers
// in place. Call shutdown on exit to flush buffered data.
func InitTelemetry(ctx context.Context, service string, endpoint string) (shutdown func(context.Context) error, err error) {
	// Trace context must propagate even when nothing is exported.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	if endpoint == "" {
		return func(context.Context) error { return nil }, nil
	}
	if err := checkEndpointURL(endpoint); err != nil {
		return nil, err
	}
	host, _ := os.Hostname()
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		semconv.ServiceName(service), semconv.ServiceInstanceID(host)))
	if err != nil {
		return nil, fmt.Errorf("server: telemetry resource: %w", err)
	}
	traceExp, err := otlptracegrpc.New(ctx, otlptracegrpc.WithEndpointURL(endpoint))
	if err != nil {
		return nil, fmt.Errorf("server: trace exporter: %w", err)
	}
	metricExp, err := otlpmetricgrpc.New(ctx, otlpmetricgrpc.WithEndpointURL(endpoint))
	if err != nil {
		return nil, errors.Join(fmt.Errorf("server: metric exporter: %w", err), traceExp.Shutdown(ctx))
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(traceExp), sdktrace.WithResource(res))
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp, sdkmetric.WithInterval(metricInterval))),
		sdkmetric.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	return func(ctx context.Context) error {
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx))
	}, nil
}

// checkEndpointURL accepts only http(s)://host[:port]: the exporter silently falls back
// to its default for a URL it cannot parse.
func checkEndpointURL(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errors.New("server: OTLP endpoint must be a URL like http://otel-lgtm:4317")
	}
	return nil
}
