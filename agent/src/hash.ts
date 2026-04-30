import { createHash } from "node:crypto";

export function sha1(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}
