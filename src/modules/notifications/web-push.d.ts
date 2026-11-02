// Типы пакета web-push (у него нет своих; @types/web-push не ставим — описано только то, что используем).
declare module "web-push" {
  export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
  export type RequestOptions = {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    timeout?: number;
  };
  export class WebPushError extends Error {
    statusCode: number;
    endpoint: string;
  }
  export function sendNotification(subscription: PushSubscription, payload: string, options: RequestOptions): Promise<{ statusCode: number }>;
  const webPush: { sendNotification: typeof sendNotification; WebPushError: typeof WebPushError };
  export default webPush;
}
