import { Injectable } from '@nestjs/common';
import * as webpush from 'web-push';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The only code that talks to the browsers' push services. Replaced by a fake in tests. */
export abstract class PushSender {
  /** Rejects with an object that has `statusCode` when the push service refuses (404/410 = subscription is gone). */
  abstract send(target: PushTarget, payload: string): Promise<void>;
}

@Injectable()
export class WebPushSender extends PushSender {
  private configured = false;

  private configure() {
    if (this.configured) return;
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error('VAPID keys are not configured');
    webpush.setVapidDetails(VAPID_SUBJECT ?? 'mailto:admin@localhost.invalid', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    this.configured = true;
  }

  async send(target: PushTarget, payload: string): Promise<void> {
    this.configure();
    // The payload is encrypted end to end (RFC 8291): the push service sees only that something was sent.
    await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, payload, { TTL: 3600, urgency: 'normal', timeout: 10_000 });
  }
}
