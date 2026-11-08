// Package services — единый список сервисов платформы для инструментов стенда:
// devcerts (сертификаты), dbinit (базы и роли) и natsconf (учётные записи NATS).
// Конфиги, которые пишутся руками (deploy/compose/envoy/mesh.yaml, dev.vars),
// сверяет с этим списком тест пакета: новый сервис добавляется сюда, а тест
// показывает, что ещё забыто.
package services

// Go — Go-сервисы платформы. У каждого своя база и роли <svc>_owner/<svc>_app,
// сертификат внутреннего CA и учётная запись NATS.
var Go = []string{
	"identity", "deal", "marketplace", "documents", "files", "notify", "operator", "audit",
}

// Web — BFF на Next.js: клиент mesh; базы сервиса и учётной записи NATS у него нет.
const Web = "web"

// Mesh — Envoy mesh-gateway; его сертификат предъявляется сервисам как клиентский.
const Mesh = "mesh"

// NATS — сервер NATS; его сертификат — серверный для TLS клиентов (ADR-012).
const NATS = "nats"

// MeshClients — кому mesh разрешает вызывать сервисы (список SAN в mesh.yaml): web и
// Go-сервисы. edge сюда не входит.
func MeshClients() []string { return append([]string{Web}, Go...) }

// Certs — кому devcerts выпускает сертификат внутреннего CA. edge (Envoy на входе из
// браузера) его не получает: он говорит с web по HTTP внутри сети стенда и не звонит ни в
// mesh, ни в сервисы; лишний сертификат CA был бы обходом списков допущенных (ADR-011).
func Certs() []string { return append([]string{Mesh, NATS, Web}, Go...) }
