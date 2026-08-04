import { describe, expect, it, vi } from "vitest";
import { readConnectorCredential, updateConnectorCredential, writeConnectorCredential } from "./credentials";

/**
 * These tests pin the RPC *names*, which is the whole point of them.
 *
 * The previous version mocked `rpc` to resolve `{ data: ref }` no matter what it
 * was called with, so it passed from the module's first commit (2026-06-23)
 * while the code called `create_secret` — a function that does not exist in
 * `public` — and then retried through a `vault` schema PostgREST does not
 * expose. Every connector connect died at `store_failed`, `vault.secrets` held
 * zero rows on prod, and this file was green throughout (BSR-733).
 *
 * A mock that answers to any name cannot detect calling the wrong one. Assert
 * the name, or the test is only checking that the code awaits something.
 */

type RpcMock = ReturnType<typeof vi.fn>;

function clientWithRpc(impl: RpcMock) {
  return { rpc: impl } as unknown as Parameters<typeof writeConnectorCredential>[0];
}

describe("writeConnectorCredential", () => {
  it("creates the secret through the public arc_ wrapper, not vault.create_secret", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "ref-123", error: null });
    const ref = await writeConnectorCredential(clientWithRpc(rpc), {
      workspaceId: "ws-1",
      connectorKey: "gemini-research",
      plaintext: "secret-key",
    });

    expect(ref).toBe("ref-123");
    expect(rpc).toHaveBeenCalledWith(
      "arc_create_vault_secret",
      expect.objectContaining({ new_secret: "secret-key", new_name: "connector_gemini-research_ws-1" }),
    );
  });

  it("accepts a row-shaped return as well as a bare uuid", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "ref-row" }, error: null });
    const ref = await writeConnectorCredential(clientWithRpc(rpc), {
      workspaceId: "ws-1",
      connectorKey: "higgsfield",
      plaintext: "k",
    });
    expect(ref).toBe("ref-row");
  });

  it("reports why the write failed instead of throwing a bare message", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied for function" } });
    await expect(
      writeConnectorCredential(clientWithRpc(rpc), { workspaceId: "ws-1", connectorKey: "higgsfield", plaintext: "k" }),
    ).rejects.toThrow(/permission denied for function/);
  });
});

describe("readConnectorCredential", () => {
  it("decrypts through the public arc_ wrapper", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "secret-key", error: null });
    expect(await readConnectorCredential(clientWithRpc(rpc), "ref-123")).toBe("secret-key");
    expect(rpc).toHaveBeenCalledWith("arc_read_vault_secret", { secret_id: "ref-123" });
  });

  it("falls back to the vault schema when the wrapper is unavailable", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { decrypted_secret: "secret-key" }, error: null });
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "no function" } }),
      schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }),
    } as never;
    expect(await readConnectorCredential(client, "ref-123")).toBe("secret-key");
  });

  it("returns null for a missing ref", async () => {
    expect(await readConnectorCredential({} as never, null)).toBeNull();
  });
});

describe("updateConnectorCredential", () => {
  it("rotates in place through the public arc_ wrapper", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await updateConnectorCredential(clientWithRpc(rpc), "ref-123", "rotated")).toBe(true);
    expect(rpc).toHaveBeenCalledWith("arc_update_vault_secret", { secret_id: "ref-123", new_secret: "rotated" });
  });

  it("is best-effort — a failed rotation returns false rather than throwing", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await updateConnectorCredential(clientWithRpc(rpc), "ref-123", "rotated")).toBe(false);
  });

  it("returns false without a ref", async () => {
    expect(await updateConnectorCredential({} as never, null, "rotated")).toBe(false);
  });
});
