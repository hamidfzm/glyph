import { invoke } from "@tauri-apps/api/core";

/**
 * Frontend surface of the secret manager: secrets live in the OS keychain
 * (macOS Keychain, Windows Credential Manager, Linux Secret Service), never in
 * settings.json. The backend allowlists the account names the webview may
 * touch; today that is the AI provider keys (see aiKeys.ts), with room for
 * future integrations.
 */

/** Read a secret from the OS keychain ("" when none is stored). */
export async function getSecret(name: string): Promise<string> {
  return (await invoke<string | null>("secret_get", { name })) ?? "";
}

/** Store a secret in the OS keychain; "" deletes the entry. */
export function setSecret(name: string, value: string): Promise<void> {
  return invoke("secret_set", { name, value });
}

/** Whether a secret is stored, without pulling the value into the webview. */
export function hasSecret(name: string): Promise<boolean> {
  return invoke("secret_has", { name });
}
