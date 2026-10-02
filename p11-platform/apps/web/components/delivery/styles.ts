import type { DeliveryInput } from "@/utils/delivery/contracts";
export type Save = (input: DeliveryInput) => Promise<boolean>;
export const button =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40";
export const primary =
  button + " border-[#a53212] bg-[#a53212]! text-white! hover:bg-[#86280e]!";
export const field =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900";
export const panel = "rounded-xl border border-slate-200 bg-white p-5 sm:p-6";
