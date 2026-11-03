import type { Dispatch, SetStateAction } from "react";
import type { AccountData, AccountMode } from "@/lib/types";

export type ToastTone = "success" | "error" | "info" | "warn";

export type Notify = (message: string, tone?: ToastTone) => void;

export interface PanelProps {
  data: AccountData;
  mode: AccountMode;
  onData: Dispatch<SetStateAction<AccountData>>;
  notify: Notify;
}
