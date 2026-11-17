/** Task 5.4: notifiers. Email over SMTP (decision 9). One message per event, with a cool-down per key. */
import { readSmtp, sendMail } from './smtp';

export interface Notifier { send(subject: string, text: string): Promise<void> }

/** Sends with the saved SMTP settings when "Send alert emails" is on; else does nothing. */
export const emailNotifier: Notifier = {
  async send(subject, text) {
    const cfg = await readSmtp();
    if (!cfg.enabled || !cfg.host || cfg.to.length === 0) return;
    await sendMail(subject, text);
  },
};

/** Remembers the last send per key. A flapping host sends at most one email per key per cool-down. */
export class Cooldown {
  private last = new Map<string, number>();
  allow(key: string, cooldownMs: number, now: number): boolean {
    const l = this.last.get(key);
    if (l !== undefined && now - l < cooldownMs) return false;
    this.last.set(key, now);
    return true;
  }
}
