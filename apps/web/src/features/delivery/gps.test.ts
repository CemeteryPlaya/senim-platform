import { describe, expect, it } from "vitest";
import { gpsVerdict, readyFarInfo, readyWait } from "./gps";
import { GeolocationError } from "./request-location";

describe("мягкая проверка GPS сдачи", () => {
  it("итог: без координат, у адреса, далеко", () => {
    expect(gpsVerdict({ distanceM: null, withinRadius: null, radiusM: 500 })).toEqual({ kind: "unknown" });
    expect(gpsVerdict({ distanceM: 120, withinRadius: true, radiusM: 500 })).toEqual({ kind: "ok", distanceM: 120 });
    expect(gpsVerdict({ distanceM: 1800, withinRadius: false, radiusM: 500 })).toEqual({ kind: "far", distanceM: 1800, radiusM: 500 });
  });

  it("предупреждение — только мастеру, в READY и дальше радиуса", () => {
    const ready = { distanceM: 1800, withinRadius: false, radiusM: 500 };
    expect(readyFarInfo({ viewer: "EXECUTOR", status: "READY", ready })).toEqual({ distanceM: 1800, radiusM: 500 });
    expect(readyFarInfo({ viewer: "CLIENT", status: "READY", ready })).toBeNull();
    expect(readyFarInfo({ viewer: "EXECUTOR", status: "ACCEPTED", ready })).toBeNull();
    expect(readyFarInfo({ viewer: "EXECUTOR", status: "READY", ready: { ...ready, withinRadius: true } })).toBeNull();
    expect(readyFarInfo({ viewer: "EXECUTOR", status: "READY", ready: null })).toBeNull();
  });

  it("чего ждём: фото сильнее места, ошибка места — с кодом", () => {
    const error = new GeolocationError("denied");
    expect(readyWait({ uploading: true, geo: { status: "locating" } })).toEqual({ kind: "photos" });
    expect(readyWait({ uploading: false, geo: { status: "locating" } })).toEqual({ kind: "locating" });
    expect(readyWait({ uploading: false, geo: { status: "failed", error } })).toEqual({ kind: "geoFailed", error });
    expect(readyWait({ uploading: false, geo: { status: "idle" } })).toEqual({ kind: "none" });
  });
});
