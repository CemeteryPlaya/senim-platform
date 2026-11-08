// Package services — единый список сервисов платформы для инструментов стенда:
// devcerts (сертификаты) и dbinit (базы и роли).
// Конфиги, которые пишутся руками (deploy/compose/envoy/mesh.yaml, dev.vars),
// сверяет с этим списком тест пакета: новый сервис добавляется сюда, а тест
// показывает, что ещё забыто.
package services

// Go — Go-сервисы платформы. У каждого своя база и роли <svc>_owner/<svc>_app и
// сертификат внутреннего CA.
var Go = []string{
	"identity", "deal", "marketplace", "documents", "files", "notify", "operator", "audit",
}

// Web — BFF на Next.js: клиент mesh; базы сервиса (dbinit) у него нет.
const Web = "web"

// Mesh — Envoy mesh-gateway; его сертификат предъявляется сервисам как клиентский.
const Mesh = "mesh"

// MeshClients — кому mesh разрешает вызывать сервисы (список SAN в mesh.yaml): web и
// Go-сервисы. edge сюда не входит.
func MeshClients() []string { return append([]string{Web}, Go...) }

// Edge — Envoy на входе из браузера.
const Edge = "edge"

// Certs — кому devcerts выпускает сертификат внутреннего CA.
func Certs() []string { return append([]string{Edge, Mesh, Web}, Go...) }
