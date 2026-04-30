import type { Policy } from "@/driver/loop";

export const noopPolicy: Policy = () => ({ kind: "wait" });
