import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionToken,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from "./session";

function stubCredentials() {
  vi.stubEnv("ADMIN_USER", "admin");
  vi.stubEnv("ADMIN_PASSWORD", "secret");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("createSessionToken / verifySessionToken", () => {
  it("発行したトークンは検証を通る", () => {
    stubCredentials();
    const token = createSessionToken();
    expect(token).not.toBeNull();
    expect(verifySessionToken(token!)).toBe(true);
  });

  it("TTLを過ぎたトークンは弾く", () => {
    stubCredentials();
    vi.useFakeTimers();
    const token = createSessionToken()!;
    vi.advanceTimersByTime((SESSION_TTL_SECONDS + 1) * 1000);
    expect(verifySessionToken(token)).toBe(false);
  });

  it("期限だけ書き換えたトークンは弾く(署名が期限を保護している)", () => {
    stubCredentials();
    const token = createSessionToken()!;
    const signature = token.slice(token.indexOf(".") + 1);
    const forged = `${Date.now() + 10 * SESSION_TTL_SECONDS * 1000}.${signature}`;
    expect(verifySessionToken(forged)).toBe(false);
  });

  it("署名を書き換えたトークンは弾く", () => {
    stubCredentials();
    const token = createSessionToken()!;
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifySessionToken(tampered)).toBe(false);
  });

  it("パスワードを変えると既存トークンは無効になる", () => {
    stubCredentials();
    const token = createSessionToken()!;
    vi.stubEnv("ADMIN_PASSWORD", "rotated");
    expect(verifySessionToken(token)).toBe(false);
  });

  it("形式が不正なトークンは弾く", () => {
    stubCredentials();
    expect(verifySessionToken("")).toBe(false);
    expect(verifySessionToken("garbage")).toBe(false);
    expect(verifySessionToken("notanumber.sig")).toBe(false);
  });

  it("認証情報が未設定なら発行も検証もしない(fail closed)", () => {
    vi.stubEnv("ADMIN_USER", "");
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(createSessionToken()).toBeNull();
    expect(verifySessionToken(`${Date.now() + 1000}.sig`)).toBe(false);
  });
});
