import { type Dispatch, type SetStateAction, useCallback } from "react";
import { useSettings } from "@/hooks/useSettings";
import type { ConflictPick, SettingsSyncOutcome, SetupChoice } from "@/lib/settingsSync";
import {
  type ConnectRequest,
  chooseSettingsSyncSetup,
  clearSettingsSyncToken,
  connectSettingsSync,
  disconnectSettingsSync,
  resolveSettingsSync,
  runSettingsSync,
  setSettingsSyncToken,
} from "@/lib/settingsSyncCommands";

interface Options {
  /** Runs an action under the tab's busy and error state. */
  guarded: (action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  applyOutcome: (outcome: SettingsSyncOutcome) => void;
  forget: () => void;
  setTokenStored: Dispatch<SetStateAction<boolean>>;
}

/** The settings repo's operations, each followed by a fresh read of where the
 *  repo stands. Anything that exports writes this window's pending settings
 *  first, so a change made a moment ago goes out with it. */
export function useSettingsSyncActions({
  guarded,
  refresh,
  applyOutcome,
  forget,
  setTokenStored,
}: Options) {
  const { flushSettings } = useSettings();

  const settle = useCallback(
    async (outcome: SettingsSyncOutcome) => {
      applyOutcome(outcome);
      await refresh();
    },
    [applyOutcome, refresh],
  );

  const connect = useCallback(
    (request: ConnectRequest) =>
      guarded(async () => {
        await flushSettings();
        await settle(await connectSettingsSync(request));
        setTokenStored(Boolean(request.token));
      }),
    [guarded, flushSettings, settle, setTokenStored],
  );

  const choose = useCallback(
    (choice: SetupChoice) =>
      guarded(async () => {
        await flushSettings();
        await settle(await chooseSettingsSyncSetup(choice));
      }),
    [guarded, flushSettings, settle],
  );

  const syncNow = useCallback(
    () =>
      guarded(async () => {
        await flushSettings();
        await settle(await runSettingsSync());
      }),
    [guarded, flushSettings, settle],
  );

  const resolve = useCallback(
    (picks: ConflictPick[]) => guarded(async () => settle(await resolveSettingsSync(picks))),
    [guarded, settle],
  );

  const disconnect = useCallback(
    () =>
      guarded(async () => {
        await disconnectSettingsSync();
        forget();
      }),
    [guarded, forget],
  );

  const saveToken = useCallback(
    (token: string) =>
      guarded(async () => {
        await setSettingsSyncToken(token);
        setTokenStored(true);
      }),
    [guarded, setTokenStored],
  );

  const removeToken = useCallback(
    () =>
      guarded(async () => {
        await clearSettingsSyncToken();
        setTokenStored(false);
      }),
    [guarded, setTokenStored],
  );

  return { connect, choose, syncNow, resolve, disconnect, saveToken, removeToken };
}
