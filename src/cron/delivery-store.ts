import { randomUUID } from "node:crypto";
import type { PendingCronDelivery } from "../scheduled-task/types.js";

const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

const pendingDeliveries = new Map<string, PendingCronDelivery>();

function isExpired(delivery: PendingCronDelivery, now: number = Date.now()): boolean {
  return now - delivery.createdAt > DELIVERY_TTL_MS;
}

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, delivery] of pendingDeliveries) {
    if (isExpired(delivery, now)) {
      pendingDeliveries.delete(id);
    }
  }
}

export function createDelivery(input: {
  taskId: string;
  prompt: string;
  resultText: string;
  runAt: string;
}): PendingCronDelivery {
  sweepExpired();
  const delivery: PendingCronDelivery = {
    deliveryId: randomUUID(),
    taskId: input.taskId,
    prompt: input.prompt,
    resultText: input.resultText,
    runAt: input.runAt,
    createdAt: Date.now(),
  };
  pendingDeliveries.set(delivery.deliveryId, delivery);
  return delivery;
}

export function consumeDelivery(deliveryId: string): PendingCronDelivery | null {
  const delivery = pendingDeliveries.get(deliveryId);
  if (!delivery) {
    return null;
  }
  pendingDeliveries.delete(deliveryId);
  if (isExpired(delivery)) {
    return null;
  }
  return delivery;
}

export function peekDelivery(deliveryId: string): PendingCronDelivery | null {
  const delivery = pendingDeliveries.get(deliveryId);
  if (!delivery) {
    return null;
  }
  if (isExpired(delivery)) {
    pendingDeliveries.delete(deliveryId);
    return null;
  }
  return delivery;
}

export function __resetForTests(): void {
  pendingDeliveries.clear();
}
