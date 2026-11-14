// Клиентский помощник геолокации: экран сдачи работы (deals) и шаг адреса заявки (requests).
export { GeolocationError, requestLocation, type GeoErrorCode, type GeoFix, type RequestLocationOptions } from "@/features/delivery/request-location";
export { useGeolocation } from "./useGeolocation";
export type { GeolocationState } from "@/features/delivery/gps";
